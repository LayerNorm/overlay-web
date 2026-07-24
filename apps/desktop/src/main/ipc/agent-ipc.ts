import { BrowserWindow } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  runUnifiedBrowserAgent,
  type BrowserAgentEvent,
  type BrowserAgentMessage,
  type BrowserAgentMode,
  type AgentTokenUsage
} from '../services/agent/unified-browser-agent'
import {
  runChatAgentV2,
  type ChatAgentEvent,
  type AgentHistoryMessage
} from '../services/agent/chat-agent-v2'
import { resolveUserInputRequest } from '../services/agent/unified-tools'
import { showNotification } from './notification-ipc'
import { subscriptionService } from '../services/subscription-service'
import { calculateTokenCost } from '../services/model-pricing'
import { extractAgentRunMemories } from '../services/memory/MemoryExtractor'
import { keyCacheService } from '../services/key-cache-service'
import { AgentTaskSecuritySession } from '../services/security/agent-policy/agent-task-security-session'

interface ToolTraceEntry {
  tool: string
  input: string
  result: string
}

// Re-export types for compatibility
export type {
  BrowserAgentEvent,
  BrowserAgentMessage,
  AgentTokenUsage,
  ChatAgentEvent,
  AgentHistoryMessage
}

// Track active agent streams
const activeStreams = new Map<string, { cancel: () => Promise<void> }>()

/**
 * Check whether a relevant renderer window (main or browser panel) is currently
 * visible. When it is, the browser agent result is already shown in the UI, so
 * a native notification is unnecessary.
 */
function isMainOrBrowserPanelVisible(): boolean {
  return BrowserWindow.getAllWindows().some((win) => {
    if (win.isDestroyed() || win.isMinimized() || !win.isVisible()) return false
    try {
      const url = new URL(win.webContents.getURL())
      const windowType = url.searchParams.get('window')
      return windowType === 'main' || windowType === 'browser'
    } catch {
      return false
    }
  })
}

/**
 * Extract agent run memories and emit them to the renderer as candidates.
 * Called after a successful agent run completes.
 */
async function extractAndEmitAgentMemories(
  command: string,
  toolTrace: ToolTraceEntry[],
  streamId: string,
  webContents: Electron.WebContents
): Promise<void> {
  try {
    const groqKey = await keyCacheService.getKey('groq')
    if (!groqKey) {
      console.log('[AgentMemory] No Groq key available — skipping memory extraction')
      return
    }

    const tier = subscriptionService.getEntitlements()?.tier ?? 'free'
    const openrouterKey =
      tier === 'free' ? ((await keyCacheService.getKey('openrouter')) ?? undefined) : undefined

    const taskId = crypto.randomUUID()
    const result = await extractAgentRunMemories(command, toolTrace, groqKey, tier, openrouterKey)

    if (result.memories.length > 0 && !webContents.isDestroyed()) {
      console.log(`[AgentMemory] Emitting ${result.memories.length} memory candidates`)
      webContents.send('agent:memory-candidates', {
        streamId,
        taskId,
        candidates: result.memories
      })
    }
  } catch (error) {
    console.error('[AgentMemory] Failed to extract and emit memories:', error)
  }
}

export function registerAgentIPC(): void {
  // Start agent with streaming
  ipcMain.handle(
    'agent:run-stream',
    async (
      event,
      {
        command,
        streamId,
        modelId,
        history,
        imageDataArray,
        workingFolder,
        searchEnabled,
        memoryEnabled,
        sandboxEnabled
      }: {
        command: string
        streamId: string
        modelId?: string
        history?: AgentHistoryMessage[]
        imageDataArray?: string[]
        workingFolder?: string
        searchEnabled?: boolean
        memoryEnabled?: boolean
        sandboxEnabled?: boolean
      }
    ): Promise<{ success: boolean; error?: string }> => {
      const webContents = event.sender
      const window = BrowserWindow.fromWebContents(webContents)
      if (!window) {
        return { success: false, error: 'Window not found' }
      }

      // Pre-request subscription check for agent
      const effectiveModelId = modelId || 'claude-haiku-4-5'
      const canPerform = subscriptionService.canPerformAction('agent', effectiveModelId)
      if (!canPerform.allowed) {
        if (!webContents.isDestroyed()) {
          webContents.send('agent:stream-event', {
            streamId,
            type: 'error',
            error: canPerform.reason || 'Action not allowed'
          })
        }
        return { success: false, error: canPerform.reason }
      }

      let cancelled = false
      const securityTask = new AgentTaskSecuritySession()

      // Register cancel handler
      activeStreams.set(streamId, {
        cancel: async () => {
          cancelled = true
          await securityTask.cancel()
        }
      })

      try {
        // Collect tool trace for memory extraction
        const toolTrace: ToolTraceEntry[] = []
        const pendingToolInputs = new Map<string, string>()

        const onEvent = (agentEvent: ChatAgentEvent): void => {
          if (cancelled || webContents.isDestroyed()) return
          // Track tool calls for agent memory extraction
          if (agentEvent.type === 'tool_start' && agentEvent.tool) {
            const inputStr = JSON.stringify(agentEvent.toolInput || {})
            pendingToolInputs.set(agentEvent.tool, inputStr)
          } else if (agentEvent.type === 'tool_result' && agentEvent.tool) {
            const input = pendingToolInputs.get(agentEvent.tool) || '{}'
            pendingToolInputs.delete(agentEvent.tool)
            toolTrace.push({ tool: agentEvent.tool, input, result: agentEvent.toolResult || '' })
          }
          webContents.send('agent:stream-event', { streamId, ...agentEvent })
        }

        // Use dedicated Chat Agent for ChatPanel Act mode (not browser agent)
        const modeLabel = workingFolder ? `ACT+CODE (workingFolder=${workingFolder})` : 'ACT'
        console.log(`[AgentIPC] Running chat agent | mode=${modeLabel} | model=${effectiveModelId}`)
        console.log(
          `[AgentIPC] includeCodingTools=${!!workingFolder} | searchEnabled=${!!searchEnabled} | memoryEnabled=${memoryEnabled !== false} | sandboxEnabled=${!!sandboxEnabled}`
        )
        if (workingFolder) {
          console.log(
            `[AgentIPC] ACT MODE + coding tools — code_edit_file, code_git_*, code_run_tests tools are ENABLED`
          )
        } else {
          console.log(`[AgentIPC] ACT MODE — standard unified tools, NO coding-specific tools`)
        }

        const result = await runChatAgentV2(
          command,
          onEvent,
          () => cancelled,
          securityTask.taskId,
          effectiveModelId,
          history || [],
          imageDataArray || [],
          workingFolder,
          searchEnabled,
          memoryEnabled !== false,
          sandboxEnabled
        )
        const usage = result.usage || { inputTokens: 0, outputTokens: 0 }

        const cost = calculateTokenCost(
          effectiveModelId,
          usage.inputTokens,
          0, // No cached tokens
          usage.outputTokens
        )
        if (usage.inputTokens > 0 || usage.outputTokens > 0 || cost > 0) {
          console.log(
            `[AgentIPC] Recording usage - cost: $${cost.toFixed(6)}, model: ${effectiveModelId}`
          )
          console.log(
            `[AgentIPC] Token usage: ${usage.inputTokens} input, ${usage.outputTokens} output`
          )
          subscriptionService.recordUsage('agent', cost, effectiveModelId, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: 0
          })
        } else {
          console.log(
            `[AgentIPC] Skipping usage recording: 0 tokens reported for model ${effectiveModelId}`
          )
        }

        // Track web search tool call costs ($0.005 per call)
        const searchCallCount = toolTrace.filter((t) => t.tool === 'web_search_tool').length
        if (searchCallCount > 0) {
          const searchCost = searchCallCount * 0.005
          console.log(
            `[AgentIPC] Web search calls: ${searchCallCount}, cost: $${searchCost.toFixed(4)}`
          )
          subscriptionService.recordUsage('agent', searchCost, 'web-search', {
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0
          })
        }

        // Send done event
        if (!cancelled && !webContents.isDestroyed()) {
          webContents.send('agent:stream-event', {
            streamId,
            type: 'done'
          })
          // Notify all renderers to refresh (picks up any in-chat auth)
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.webContents.isDestroyed()) {
              win.webContents.send('composio:toolkits-synced')
            }
          }

          // Extract agent memories from the run (fire-and-forget, non-blocking)
          if (memoryEnabled !== false && toolTrace.length > 0) {
            extractAndEmitAgentMemories(command, toolTrace, streamId, webContents).catch((err) => {
              console.error('[AgentIPC] Memory extraction error:', err)
            })
          }
        }

        return { success: true }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        if (!webContents.isDestroyed()) {
          webContents.send('agent:stream-event', {
            streamId,
            type: 'error',
            error
          })
        }
        return { success: false, error }
      } finally {
        activeStreams.delete(streamId)
        await securityTask.finish()
      }
    }
  )

  // Cancel agent stream
  ipcMain.handle('agent:cancel-stream', async (_event, { streamId }: { streamId: string }) => {
    const stream = activeStreams.get(streamId)
    if (stream) {
      await stream.cancel()
      activeStreams.delete(streamId)
      return { success: true }
    }
    return { success: false, error: 'Stream not found' }
  })

  // Resolve a pending user-input request (user clicked "Continue")
  ipcMain.handle(
    'agent:user-input-continue',
    async (_event, { requestId }: { requestId: string }) => {
      const resolved = resolveUserInputRequest(requestId)
      return { success: resolved }
    }
  )

  // Browser agent with streaming - prioritizes browser tools
  ipcMain.handle(
    'browser-agent:run-stream',
    async (
      event,
      {
        command,
        streamId,
        history,
        modelId,
        mode
      }: {
        command: string
        streamId: string
        history?: BrowserAgentMessage[]
        modelId?: string
        mode?: BrowserAgentMode
      }
    ): Promise<{ success: boolean; error?: string; messages?: BrowserAgentMessage[] }> => {
      const webContents = event.sender
      const window = BrowserWindow.fromWebContents(webContents)
      if (!window) {
        return { success: false, error: 'Window not found' }
      }

      // Pre-request subscription check for browser agent
      const canPerform = subscriptionService.canPerformAction('agent', modelId || '')
      if (!canPerform.allowed) {
        if (!webContents.isDestroyed()) {
          webContents.send('browser-agent:stream-event', {
            streamId,
            type: 'error',
            error: canPerform.reason || 'Action not allowed'
          })
        }
        return { success: false, error: canPerform.reason }
      }

      let cancelled = false
      const securityTask = new AgentTaskSecuritySession()

      // Register cancel handler
      activeStreams.set(streamId, {
        cancel: async () => {
          cancelled = true
          await securityTask.cancel()
        }
      })

      try {
        // Collect tool trace for memory extraction
        const toolTrace: ToolTraceEntry[] = []
        const pendingToolInputs = new Map<string, string>()

        const onEvent = (agentEvent: BrowserAgentEvent): void => {
          if (cancelled || webContents.isDestroyed()) return
          // Track tool calls for agent memory extraction
          if (agentEvent.type === 'tool_start' && agentEvent.tool) {
            const inputStr = JSON.stringify(agentEvent.toolInput || {})
            pendingToolInputs.set(agentEvent.tool, inputStr)
          } else if (agentEvent.type === 'tool_result' && agentEvent.tool) {
            const input = pendingToolInputs.get(agentEvent.tool) || '{}'
            pendingToolInputs.delete(agentEvent.tool)
            toolTrace.push({ tool: agentEvent.tool, input, result: agentEvent.toolResult || '' })
          }
          webContents.send('browser-agent:stream-event', { streamId, ...agentEvent })
        }

        // Use unified Gateway agent for ALL models (Vercel AI SDK)
        const effectiveModel = modelId || 'claude-haiku-4-5'
        console.log(`[BrowserAgent] Using unified Gateway agent for model: ${effectiveModel}`)

        const result = await runUnifiedBrowserAgent(
          command,
          onEvent,
          () => cancelled,
          securityTask.taskId,
          history || [],
          effectiveModel,
          mode || 'act'
        )

        // history_update and done events are emitted by the agent itself (before returning)
        // so the renderer captures them while the listener is still active.

        if (!cancelled && !webContents.isDestroyed()) {
          // Only show a native notification if the user isn't already looking at
          // the result in the main or browser panel.
          if (!isMainOrBrowserPanelVisible()) {
            await showNotification({
              id: `browser-agent-${Date.now()}`,
              type: 'success',
              title: 'Browser Agent Complete',
              summary: 'Task completed successfully',
              trace: []
            })
          }

          // Extract agent memories from the run (fire-and-forget, non-blocking)
          if (toolTrace.length > 0) {
            extractAndEmitAgentMemories(command, toolTrace, streamId, webContents).catch((err) => {
              console.error('[BrowserAgent] Memory extraction error:', err)
            })
          }
        }

        // Record usage after successful completion with actual token costs
        const usage = result.usage as AgentTokenUsage
        const cost = calculateTokenCost(
          modelId || '',
          usage.inputTokens,
          usage.cachedTokens,
          usage.outputTokens
        )

        if (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cachedTokens > 0 || cost > 0) {
          console.log(
            `[BrowserAgent] Recording usage - cost: $${cost.toFixed(6)}, model: ${modelId}`
          )
          console.log(
            `[BrowserAgent] Token usage: ${usage.inputTokens} input, ${usage.outputTokens} output, ${usage.cachedTokens} cached`
          )

          // For premium models, record actual cost; for free models, cost will be 0
          subscriptionService.recordUsage('agent', cost, modelId, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: usage.cachedTokens
          })
        } else {
          console.log(
            `[BrowserAgent] Skipping usage recording: 0 tokens reported for model ${modelId}`
          )
        }

        return { success: true }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        if (!webContents.isDestroyed()) {
          webContents.send('browser-agent:stream-event', {
            streamId,
            type: 'error',
            error
          })

          // Show error notification for browser agent
          await showNotification({
            id: `browser-agent-${Date.now()}`,
            type: 'error',
            title: 'Browser Agent Failed',
            summary: error,
            trace: []
          })
        }
        return { success: false, error }
      } finally {
        activeStreams.delete(streamId)
        await securityTask.finish()
      }
    }
  )

  // ── Workspace file listing (for project file tree sidebar) ──────────────────
  const EXCLUDED_DIRS = new Set([
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    '__pycache__',
    '.cache',
    'coverage',
    '.turbo',
    '.vercel',
    'out',
    '.svelte-kit'
  ])

  function walkDir(dir: string, rootDir: string, depth: number, maxDepth: number): string[] {
    if (depth > maxDepth) return []
    const results: string[] = []
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return results
    }
    for (const entry of entries) {
      if (entry.startsWith('.') && depth === 0) continue
      if (EXCLUDED_DIRS.has(entry)) continue
      const full = join(dir, entry)
      const rel = full.slice(rootDir.length + 1)
      try {
        const stat = statSync(full)
        results.push(rel)
        if (stat.isDirectory()) {
          results.push(...walkDir(full, rootDir, depth + 1, maxDepth))
        }
      } catch {
        // skip unreadable entries
      }
    }
    return results
  }

  ipcMain.handle(
    'workspace:list-files',
    async (
      _event,
      { workingFolder, maxDepth = 4 }: { workingFolder: string; maxDepth?: number }
    ) => {
      try {
        if (!workingFolder || !existsSync(workingFolder)) {
          return { success: false, error: 'Working folder not found', paths: [] }
        }
        const paths = walkDir(workingFolder, workingFolder, 0, maxDepth)
        return { success: true, paths }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          paths: []
        }
      }
    }
  )

  ipcMain.handle(
    'workspace:read-file',
    async (_event, { path: filePath, maxBytes = 200000 }: { path: string; maxBytes?: number }) => {
      try {
        if (!filePath || !existsSync(filePath)) {
          return { success: false, error: 'File not found', content: '' }
        }
        const stat = statSync(filePath)
        if (!stat.isFile()) {
          return { success: false, error: 'Path is not a file', content: '' }
        }
        const buffer = readFileSync(filePath)
        const truncated = buffer.length > maxBytes
        const content = buffer.slice(0, maxBytes).toString('utf8')
        return { success: true, content, truncated, size: stat.size }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          content: ''
        }
      }
    }
  )
}
