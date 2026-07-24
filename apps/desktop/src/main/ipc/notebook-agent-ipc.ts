import { BrowserWindow } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import {
  runNotebookAgentStreaming,
  NotebookAgentEvent
} from '../services/agent/unified-notebook-agent'
import { subscriptionService } from '../services/subscription-service'
import { calculateTokenCost } from '../services/model-pricing'
import type { AgentTokenUsage } from '../services/agent/unified-browser-agent'
import { AgentTaskSecuritySession } from '../services/security/agent-policy/agent-task-security-session'

const activeStreams = new Map<string, { cancel: () => Promise<void> }>()

export function registerNotebookAgentIPC(): void {
  ipcMain.handle(
    'notebook-agent:run',
    async (
      event,
      {
        noteContent,
        noteTitle,
        command,
        modelId,
        mode,
        streamId
      }: {
        noteContent: string
        noteTitle: string
        command: string
        modelId: string
        mode: 'ask' | 'write'
        streamId: string
      }
    ): Promise<{ success: boolean; error?: string }> => {
      const webContents = event.sender
      const window = BrowserWindow.fromWebContents(webContents)
      if (!window) return { success: false, error: 'Window not found' }

      // Pre-request subscription check
      // Map 'write' mode to 'write' action, 'ask' mode to 'ask' action
      const actionType = mode === 'write' ? 'write' : 'ask'
      const canPerform = subscriptionService.canPerformAction(actionType, modelId)
      if (!canPerform.allowed) {
        if (!webContents.isDestroyed()) {
          webContents.send('notebook-agent:event', {
            streamId,
            type: 'error',
            error: canPerform.reason || 'Action not allowed'
          })
        }
        return { success: false, error: canPerform.reason }
      }

      let cancelled = false
      const securityTask = new AgentTaskSecuritySession()
      activeStreams.set(streamId, {
        cancel: async () => {
          cancelled = true
          await securityTask.cancel()
        }
      })

      try {
        const onEvent = (agentEvent: NotebookAgentEvent): void => {
          if (cancelled || webContents.isDestroyed()) return
          webContents.send('notebook-agent:event', { streamId, ...agentEvent })
        }

        const result = await runNotebookAgentStreaming(
          noteContent,
          noteTitle,
          command,
          modelId,
          mode,
          onEvent,
          () => cancelled,
          securityTask.taskId
        )

        if (!cancelled && !webContents.isDestroyed()) {
          webContents.send('notebook-agent:event', { streamId, type: 'done' })
        }

        // Record usage after successful completion with actual token costs
        const usage = result.usage as AgentTokenUsage
        const cost = calculateTokenCost(
          modelId || '',
          usage.inputTokens,
          usage.cachedTokens,
          usage.outputTokens
        )

        console.log(
          `[NotebookAgent] Recording usage - cost: $${cost.toFixed(6)}, model: ${modelId}`
        )
        console.log(
          `[NotebookAgent] Token usage: ${usage.inputTokens} input, ${usage.outputTokens} output, ${usage.cachedTokens} cached`
        )

        if (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cachedTokens > 0 || cost > 0) {
          subscriptionService.recordUsage(actionType, cost, modelId, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: usage.cachedTokens
          })
        } else {
          console.log(
            `[NotebookAgent] Skipping usage recording: 0 tokens reported for model ${modelId}`
          )
        }

        return { success: true }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error('[NotebookAgentIPC] Error:', error)
        if (!webContents.isDestroyed()) {
          webContents.send('notebook-agent:event', { streamId, type: 'error', error })
        }
        return { success: false, error }
      } finally {
        activeStreams.delete(streamId)
        await securityTask.finish()
      }
    }
  )

  ipcMain.handle('notebook-agent:cancel', async (_event, { streamId }: { streamId: string }) => {
    const stream = activeStreams.get(streamId)
    if (stream) {
      await stream.cancel()
      activeStreams.delete(streamId)
      return { success: true }
    }
    return { success: false, error: 'Stream not found' }
  })
}
