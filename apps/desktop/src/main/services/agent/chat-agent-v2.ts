/**
 * Chat Agent V2 - Using ToolLoopAgent
 *
 * Uses the AI SDK's ToolLoopAgent for cleaner agent loop management.
 * Supports conversation history, context compaction, and all Composio integrations.
 */

import { ToolLoopAgent, stepCountIs, hasToolCall, generateText } from 'ai'
import {
  getGateway,
  mapModelId,
  getGenerationDetails,
  isOpenRouterModel
} from '../ai/gateway-provider'
import {
  estimateTokenUsageFromGenerateResult,
  extractGenerateResultUsage,
  extractGenerationIdsFromResult,
  hasTokenUsage,
  recoverUsageFromGenerationIds
} from './token-usage'
import { syncConnectedToolkits, getConnectedToolkits } from './composio-service'
import { createUnifiedTools } from './unified-tools'
import { runOpenRouterChatAgent } from './openrouter-agent-service'
import type { ChatMessage } from '../chat-service'
import { getCloudMemoryService } from '../memory/CloudMemoryService'
import { getUnifiedKnowledgeService } from '../memory/UnifiedKnowledgeService'
import { getSkillMatcherService } from '../memory/SkillMatcherService'

const DEFAULT_MODEL_ID = 'anthropic/claude-haiku-4-5'
const MAX_STEPS = 40
const CHECKPOINT_INTERVAL = 10
const COMPACTION_CHAR_THRESHOLD = 80_000 // ~20K tokens
const COMPACTION_MODEL = 'anthropic/claude-haiku-4-5'
const TOOL_LOG_PREVIEW_CHARS = 2000

export interface AgentHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatAgentEvent {
  type:
    | 'step'
    | 'tool_start'
    | 'tool_result'
    | 'text'
    | 'error'
    | 'done'
    | 'checkpoint'
    | 'max_steps_reached'
  step?: number
  maxSteps?: number
  stepsCompleted?: number
  tool?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  text?: string
  error?: string
  summary?: string
  checkpointStep?: number
  checkpointMessage?: string
}

export interface ChatAgentResult {
  success: boolean
  text?: string
  error?: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

function getCurrentDateTimeString(): string {
  const now = new Date()
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  }
  return now.toLocaleDateString('en-US', options)
}

function getSystemPrompt(connectedToolkits: string[] = []): string {
  const dateTime = getCurrentDateTimeString()

  const preConnectedSection =
    connectedToolkits.length > 0
      ? `
## ALREADY CONNECTED TOOLKITS — NO AUTH REQUIRED
The following toolkits are 100% authenticated and ready. You MUST NOT call COMPOSIO_MANAGE_CONNECTIONS for these:
${connectedToolkits.map((t) => `  - ${t}`).join('\n')}

MANDATORY workflow for the above toolkits:
1. COMPOSIO_SEARCH_TOOLS (find the right action, e.g. "create google calendar event")
2. COMPOSIO_MULTI_EXECUTE_TOOL (execute it immediately)
3. done (signal completion)

**NEVER ask the user to authenticate or click a link for the toolkits listed above.**
If COMPOSIO_MANAGE_CONNECTIONS returns "already_connected", skip it and go straight to COMPOSIO_MULTI_EXECUTE_TOOL.
If a tool response says "No active connection found ... in this session", call COMPOSIO_MANAGE_CONNECTIONS with the SAME session_id to bind the session.
`
      : ''

  const manageConnectionsRule =
    connectedToolkits.length > 0
      ? `2. **COMPOSIO_MANAGE_CONNECTIONS** — for toolkits not listed above, OR to re-bind an existing toolkit when a tool reports "No active connection found ... in this session".`
      : `2. **COMPOSIO_MANAGE_CONNECTIONS** — call when the toolkit is not yet connected to get an auth link for the user.`

  return `You are Overlay, a helpful AI assistant with access to tools for completing tasks.

## CRITICAL: Current Date and Time
**Today is: ${dateTime}**
Use this date for ALL calendar, scheduling, and time-related tasks.

## Your Capabilities
- **Memory**: Search and store information in the user's personal memory system
- **Web Search**: Use web_search_tool to find current information, news, research, and articles from the web. Use this for any question requiring up-to-date information.
- **Overlay Browser**: Open URLs, search the web, and interact with web pages in Overlay's built-in browser. The browser runs in the background — it stays hidden unless you explicitly call request_user_input.
- **1000+ Integrations**: Gmail, Google Calendar, Notion, GitHub, Slack, and more via Composio meta tools
- **macOS Actions**: Launch apps, run AppleScript, use reminders/iMessage/contact tools, AX automation, file downloads, and Shortcuts
${preConnectedSection}
## Browser Tools
Use these for any web task:
- **fetch_url_content** — fetch the text content of a specific URL silently (use when the user asks about a URL or webpage)
- **open_browser_url** — load a URL silently in Overlay browser (panel stays hidden)
- **search_web** — Google search in Overlay browser
- **browser_get_page_content** — read current page text + interactive elements
- **browser_click** / **browser_type** / **browser_scroll** — interact with the page
- **navigate_browser** — navigate to a new URL
- **browser_screenshot** — capture the current page
- **request_user_input** — show the browser to the user and pause until they complete an action (login, captcha, confirmation). Use ONLY when human interaction is required.

**Browser priority rule**: For ANY task involving the web (opening a website, searching, reading a page), ALWAYS use Overlay browser tools. Do NOT use launch_app or AppleScript to open Safari/Chrome unless the user explicitly requests a specific external browser.

## Script Execution
- **script_run** — run Python or JavaScript code. Python has a shared persistent environment with common libraries pre-installed: pandas, pymupdf, openpyxl, beautifulsoup4, Pillow, requests, python-docx, python-pptx, lxml, chardet, pyyaml. You do NOT need to install these — just import them. For extra packages, pass them in the \`packages\` parameter and they will be auto-installed and persist across sessions.
- **install_packages** — pre-install Python packages into the shared environment if needed before running scripts.
- If the user has a working folder with its own venv (.venv or venv), that project venv is used automatically instead of the shared env.

## Integration Tools (Composio)
1. **COMPOSIO_SEARCH_TOOLS** — search for the right tool first (e.g., "send gmail email", "create github issue")
${manageConnectionsRule}
3. **COMPOSIO_MULTI_EXECUTE_TOOL** — execute the discovered tools with the right arguments

## Guidelines
1. ALWAYS search memory first to personalize your response
2. For questions about current events, news, or real-time information: use web_search_tool
3. For web tasks: use Overlay browser tools; for integration tasks: search tools → (check connection if not pre-connected) → execute
4. For calendar events, use the current date/time context
5. Be concise in your responses
6. If a tool fails, explain what went wrong
7. Reuse one consistent Composio session across all COMPOSIO_* calls in this workflow
8. Never claim success for an external action unless a tool call explicitly succeeded
9. For destructive actions (delete/remove/cancel), verify with a follow-up read/check tool whenever possible
10. Call the 'done' tool when task is complete
11. **Step budget**: You have a maximum of ${MAX_STEPS} steps per cycle. Use them wisely. If you are running low on steps and cannot finish, call 'done' with a clear partial summary so the user can ask you to continue.`
}

function estimateCharCount(history: AgentHistoryMessage[]): number {
  return history.reduce((sum, m) => sum + m.content.length, 0)
}

async function compactHistory(
  history: AgentHistoryMessage[],
  model: any
): Promise<AgentHistoryMessage[]> {
  if (history.length <= 4) return history

  const olderMessages = history.slice(0, -4)
  const recentMessages = history.slice(-4)

  const olderText = olderMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n')

  try {
    const result = await generateText({
      model,
      system: 'You are a helpful assistant that summarizes conversations concisely.',
      messages: [
        {
          role: 'user',
          content: `Summarize the following conversation history in 2-3 sentences, preserving key facts and context:\n\n${olderText}`
        }
      ]
    })

    console.log(`[ChatAgentV2] Compacted ${olderMessages.length} messages into summary`)
    return [
      { role: 'assistant', content: `[Previous conversation summary: ${result.text}]` },
      ...recentMessages
    ]
  } catch (err) {
    console.warn('[ChatAgentV2] Compaction failed, using recent messages only:', err)
    return recentMessages
  }
}

function buildPromptWithHistory(command: string, history: AgentHistoryMessage[]): string {
  if (history.length === 0) return command

  const historyText = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `## Conversation History\n${historyText}\n\n---\n\n## Current Task\n${command}`
}

// ── Pre-fetch Context ─────────────────────────────────────────────────────────

async function prefetchAgentContext(
  command: string,
  options: { includeMemory?: boolean } = {}
): Promise<{ memorySnippet: string; notesSnippet: string; skillsSnippet: string }> {
  const memoryLines: string[] = []
  const notesLines: string[] = []
  const skillsLines: string[] = []
  const includeMemory = options.includeMemory ?? true
  const prefetchTasks: Array<Promise<void>> = []

  if (includeMemory) {
    prefetchTasks.push(
      (async () => {
        try {
          const memoryService = getCloudMemoryService()
          const results = await memoryService.search(command, 5)
          for (const r of results) {
            if (r.score >= 0.75) {
              memoryLines.push(`- [${r.type}] ${r.content}`)
            }
          }
        } catch (err) {
          console.warn('[ChatAgentV2] Pre-fetch memory failed:', err)
        }
      })()
    )
  }

  prefetchTasks.push(
    (async () => {
      try {
        const knowledgeService = getUnifiedKnowledgeService()
        const results = await knowledgeService.search({
          query: command,
          includeMemories: false,
          includeDocuments: true,
          includeNotes: false,
          includeChats: false,
          limit: 5
        })
        for (const r of results.documents) {
          notesLines.push(`- **${r.title || 'Knowledge'}**: ${r.content.slice(0, 200)}`)
        }
      } catch (err) {
        console.warn('[ChatAgentV2] Pre-fetch knowledge failed:', err)
      }
    })(),
    (async () => {
      try {
        const skillService = getSkillMatcherService()
        const skills = await skillService.matchSkills(command, 3)
        for (const skill of skills) {
          skillsLines.push(`### ${skill.title}\n${skill.content}`)
        }
        if (skills.length > 0) {
          console.log(`[ChatAgentV2] Pre-fetched ${skills.length} relevant skill(s)`)
        }
      } catch (err) {
        console.warn('[ChatAgentV2] Pre-fetch skills failed:', err)
      }
    })()
  )

  await Promise.allSettled(prefetchTasks)

  return {
    memorySnippet: memoryLines.length > 0 ? memoryLines.join('\n') : '',
    notesSnippet: notesLines.length > 0 ? notesLines.join('\n') : '',
    skillsSnippet: skillsLines.length > 0 ? skillsLines.join('\n\n---\n\n') : ''
  }
}

function buildSystemPromptWithContext(
  basePrompt: string,
  context: { memorySnippet: string; notesSnippet: string; skillsSnippet: string }
): string {
  const sections: string[] = []
  if (context.skillsSnippet) {
    sections.push(
      `## Relevant Skills\nFollow these step-by-step procedures for this task:\n\n${context.skillsSnippet}`
    )
  }
  if (context.memorySnippet) {
    sections.push(`## Pre-loaded Memory Context\n${context.memorySnippet}`)
  }
  if (context.notesSnippet) {
    sections.push(`## Pre-loaded Notes Context\n${context.notesSnippet}`)
  }
  if (sections.length === 0) return basePrompt
  return `${basePrompt}\n\n${sections.join('\n\n')}`
}

function truncateForLog(value: string, max = TOOL_LOG_PREVIEW_CHARS): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`
}

function toLogPreview(value: unknown, max = TOOL_LOG_PREVIEW_CHARS): string {
  if (typeof value === 'string') return truncateForLog(value, max)
  try {
    return truncateForLog(JSON.stringify(value), max)
  } catch {
    return truncateForLog(String(value), max)
  }
}

/**
 * Create all tools for the chat agent from the unified registry.
 */
async function createChatAgentTools(
  onToolStart: (name: string, input: Record<string, unknown>) => void,
  onToolResult: (name: string, result: string) => void,
  command: string,
  securityTaskId: string,
  workingFolder?: string,
  searchEnabled?: boolean,
  searchModelId?: string,
  memoryEnabled = true,
  sandboxEnabled = false
) {
  const tools = await createUnifiedTools({
    surface: 'chat',
    securityTaskId,
    hooks: { onToolStart, onToolResult },
    composio: {
      includeMetaTools: true,
      command
    },
    workingFolder,
    includeScriptTools: !!workingFolder || sandboxEnabled,
    includeMemoryTools: memoryEnabled,
    searchEnabled,
    searchModelId
  })
  const toolNames = Object.keys(tools)
  console.log(`[ChatAgentV2] Available tools: ${toolNames.join(', ')}`)
  return tools
}

/**
 * Create and run the chat agent using ToolLoopAgent
 */
export async function runChatAgentV2(
  command: string,
  onEvent: (event: ChatAgentEvent) => void,
  isCancelled: () => boolean,
  securityTaskId: string,
  modelId: string = DEFAULT_MODEL_ID,
  history: AgentHistoryMessage[] = [],
  imageDataArray: string[] = [],
  workingFolder?: string,
  searchEnabled?: boolean,
  memoryEnabled = true,
  sandboxEnabled = false
): Promise<ChatAgentResult> {
  const gatewayModelId = mapModelId(modelId)
  const freeOpenRouterModel = isOpenRouterModel(gatewayModelId)

  console.log(`[ChatAgentV2] ═══════════════════════════════════════════════════════`)
  console.log(`[ChatAgentV2] Starting with ToolLoopAgent`)
  console.log(`[ChatAgentV2]   Model: ${gatewayModelId}`)
  console.log(`[ChatAgentV2]   OpenRouter routed: ${freeOpenRouterModel}`)
  console.log(`[ChatAgentV2]   Command: ${command.substring(0, 80)}...`)
  console.log(`[ChatAgentV2]   History messages: ${history.length}`)
  console.log(`[ChatAgentV2]   Attached images: ${imageDataArray.length}`)
  console.log(`[ChatAgentV2] ═══════════════════════════════════════════════════════`)

  const onToolStart = (name: string, input: Record<string, unknown>): void => {
    console.log(`[ChatAgentV2] Tool start: ${name} | input=${toLogPreview(input)}`)
    onEvent({ type: 'tool_start', tool: name, toolInput: input })
  }

  const onToolResult = (name: string, result: string): void => {
    console.log(`[ChatAgentV2] Tool result: ${name} | output=${toLogPreview(result)}`)
    onEvent({ type: 'tool_result', tool: name, toolResult: result })
  }

  try {
    // Compact history if it exceeds the threshold
    let effectiveHistory = history
    if (!freeOpenRouterModel && estimateCharCount(history) > COMPACTION_CHAR_THRESHOLD) {
      console.log(
        `[ChatAgentV2] History too large (${estimateCharCount(history)} chars), compacting...`
      )
      const gateway = await getGateway()
      const compactionModel = gateway(mapModelId(COMPACTION_MODEL))
      effectiveHistory = await compactHistory(history, compactionModel)
    }

    // Sync connected toolkits and pre-fetch context in parallel
    const [, prefetchedContext] = await Promise.all([
      syncConnectedToolkits().catch((err) =>
        console.warn('[ChatAgentV2] Pre-run toolkit sync failed:', err)
      ),
      prefetchAgentContext(command, { includeMemory: memoryEnabled })
    ])
    const connectedToolkits = getConnectedToolkits()
    const baseInstructions = getSystemPrompt(connectedToolkits)
    const withWorkingFolder = workingFolder
      ? `${baseInstructions}\n\n## Working Folder\nThe user has selected a working folder: **${workingFolder}**\nAll file system operations and script execution should default to this folder. When the user refers to "this folder", "the folder", "here", or similar, they mean this path. You have full read/write access to it.\n\n## Coding Tool Preference\nWhen editing **existing files**, strongly prefer \`code_edit_file\` (surgical find-and-replace) over \`fs_write_file\` (full-file overwrite). Surgical edits are safer, preserve formatting, and avoid accidental data loss. Only use \`fs_write_file\` for creating new files or when the entire file content needs to be replaced.`
      : baseInstructions
    const instructions = buildSystemPromptWithContext(withWorkingFolder, prefetchedContext)
    const promptWithHistory = buildPromptWithHistory(command, effectiveHistory)

    if (freeOpenRouterModel) {
      const openRouterMessages: ChatMessage[] = [
        {
          role: 'system',
          content: instructions
        },
        {
          role: 'user',
          content: promptWithHistory,
          ...(imageDataArray.length > 0 ? { imageDataArray } : {})
        }
      ]

      const result = await runOpenRouterChatAgent(
        gatewayModelId,
        openRouterMessages,
        command,
        onEvent,
        isCancelled,
        securityTaskId,
        MAX_STEPS
      )

      return {
        success: result.success,
        text: result.text,
        error: result.error,
        usage: result.usage
      }
    }

    const gateway = await getGateway()
    const model = gateway(gatewayModelId)
    const tools = await createChatAgentTools(
      onToolStart,
      onToolResult,
      command,
      securityTaskId,
      workingFolder,
      searchEnabled,
      gatewayModelId,
      memoryEnabled,
      sandboxEnabled
    )

    // Create the ToolLoopAgent
    const agent = new ToolLoopAgent({
      model,
      instructions,
      tools,
      stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('done')],
      toolChoice: 'auto',
      prepareStep: async ({ stepNumber, messages }) => {
        if (isCancelled()) {
          throw new Error('Agent cancelled')
        }
        onEvent({ type: 'step', step: stepNumber, maxSteps: MAX_STEPS })
        if (stepNumber > 0 && stepNumber % CHECKPOINT_INTERVAL === 0) {
          onEvent({
            type: 'checkpoint',
            checkpointStep: stepNumber,
            checkpointMessage: `Completed ${stepNumber} steps — still working...`
          })
        }
        if (stepNumber === 0) {
          const activeTools = memoryEnabled
            ? ['memory_search', 'overlay_notes_search']
            : ['overlay_notes_search']
          return {
            activeTools,
            toolChoice: 'required'
          }
        }
        const stepsRemaining = MAX_STEPS - stepNumber
        if (stepsRemaining <= 5 && stepsRemaining > 0) {
          return {
            messages: [
              ...messages,
              {
                role: 'user' as const,
                content: `[SYSTEM REMINDER: You have ${stepsRemaining} step${stepsRemaining === 1 ? '' : 's'} remaining (${stepNumber}/${MAX_STEPS} used). If you cannot complete the task, call 'done' now with a clear partial summary of what you did and what still needs to be done. The user can ask you to continue.]`
              }
            ]
          }
        }
        return {}
      },
      onStepFinish: async (step: any) => {
        const usage = step?.usage
        const usageInput = usage?.inputTokens ?? usage?.promptTokens ?? 0
        const usageOutput = usage?.outputTokens ?? usage?.completionTokens ?? 0
        const toolCalls = Array.isArray(step?.toolCalls) ? step.toolCalls : []
        const toolResults = Array.isArray(step?.toolResults) ? step.toolResults : []

        console.log(
          `[ChatAgentV2] Step finish #${step?.stepNumber ?? '?'} | finishReason=${step?.finishReason ?? 'unknown'} | usage=${usageInput} in / ${usageOutput} out | toolCalls=${toolCalls.length} | toolResults=${toolResults.length}`
        )

        const stepGenerationIds = extractGenerationIdsFromResult({
          response: step?.response,
          providerMetadata: step?.providerMetadata
        })
        if (stepGenerationIds.length > 0) {
          console.log(
            `[ChatAgentV2] Step #${step?.stepNumber ?? '?'} Gateway generation IDs: ${stepGenerationIds.join(', ')}`
          )
        }

        toolCalls.forEach(
          (toolCall: { toolName?: string; toolCallId?: string; input?: unknown }) => {
            console.log(
              `[ChatAgentV2] Step #${step?.stepNumber ?? '?'} toolCall ${toolCall.toolName || 'unknown'} (${toolCall.toolCallId || 'no-id'}) input=${toLogPreview(toolCall.input)}`
            )
          }
        )

        toolResults.forEach(
          (toolResult: {
            toolName?: string
            toolCallId?: string
            output?: unknown
            input?: unknown
          }) => {
            console.log(
              `[ChatAgentV2] Step #${step?.stepNumber ?? '?'} toolResult ${toolResult.toolName || 'unknown'} (${toolResult.toolCallId || 'no-id'}) input=${toLogPreview(toolResult.input)} output=${toLogPreview(toolResult.output)}`
            )
          }
        )
      }
    })

    // Run the agent with history-encoded prompt (multimodal when images are attached)
    const promptInput =
      imageDataArray.length > 0
        ? [
            {
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: promptWithHistory },
                ...imageDataArray.map((image) => ({ type: 'image' as const, image }))
              ]
            }
          ]
        : promptWithHistory
    const result = await agent.generate({ prompt: promptInput })

    // Sync connected toolkits (picks up any in-chat auth)
    await syncConnectedToolkits().catch((err) => console.error('[ChatAgentV2] Sync failed:', err))

    // Prefer AI SDK aggregate usage (totalUsage), then step-level, then last-step usage.
    let extractedUsage = extractGenerateResultUsage(result)
    if (!hasTokenUsage(extractedUsage)) {
      const generationIds = extractGenerationIdsFromResult(result)
      if (generationIds.length > 0) {
        console.log(
          `[ChatAgentV2] Attempting Gateway usage recovery from generation IDs: ${generationIds.join(', ')}`
        )
        const recoveredUsage = await recoverUsageFromGenerationIds(generationIds, async (id) => {
          try {
            const details = await getGenerationDetails(id)
            return {
              inputTokens: details.tokens_prompt || 0,
              outputTokens: details.tokens_completion || 0,
              cachedTokens: 0
            }
          } catch (err) {
            console.warn(`[ChatAgentV2] Failed to fetch usage for generation ${id}:`, err)
            return null
          }
        })
        if (hasTokenUsage(recoveredUsage)) {
          extractedUsage = recoveredUsage
          console.log(
            `[ChatAgentV2] Recovered usage from Gateway generations: ${extractedUsage.inputTokens} in, ${extractedUsage.outputTokens} out`
          )
        }
      }
    }

    if (!hasTokenUsage(extractedUsage)) {
      extractedUsage = estimateTokenUsageFromGenerateResult(result)
      if (hasTokenUsage(extractedUsage)) {
        console.log(
          `[ChatAgentV2] Estimated usage fallback: ${extractedUsage.inputTokens} in, ${extractedUsage.outputTokens} out`
        )
      }
    }

    const usage = {
      inputTokens: extractedUsage.inputTokens,
      outputTokens: extractedUsage.outputTokens
    }
    console.log(
      `[ChatAgentV2] Usage: ${usage.inputTokens} in, ${usage.outputTokens} out (${result.steps?.length ?? 0} steps)`
    )

    // Check if done tool was called
    const doneToolCall = result.steps
      ?.flatMap((s) => s.toolCalls || [])
      .find((tc) => tc.toolName === 'done')
    const doneToolSummary = (doneToolCall as any)?.args?.summary as string | undefined
    const stepsCompleted = result.steps?.length ?? 0
    const hitMaxSteps = stepsCompleted >= MAX_STEPS && !doneToolCall

    let finalText: string
    if (hitMaxSteps) {
      // Max steps reached without calling done — synthesize a fallback summary
      let fallbackSummary = result.text?.trim()
      if (!fallbackSummary) {
        try {
          const toolNames =
            result.steps
              ?.flatMap((s) => s.toolCalls || [])
              .map((tc) => (tc as any).toolName as string)
              .filter(Boolean) ?? []
          const uniqueTools = [...new Set(toolNames)].slice(0, 10).join(', ')
          const fallbackResult = await generateText({
            model: gateway(mapModelId(COMPACTION_MODEL)),
            system: 'You are a concise summarizer. Reply in 2-3 sentences maximum.',
            messages: [
              {
                role: 'user',
                content: `An AI agent ran for ${stepsCompleted} steps on the task: "${command.slice(0, 200)}". It used these tools: ${uniqueTools || 'none'}. Write a brief summary of what was likely attempted and note the task is incomplete because the step limit was reached.`
              }
            ]
          })
          fallbackSummary = fallbackResult.text?.trim()
        } catch {
          // ignore synthesis errors
        }
      }
      finalText = fallbackSummary
        ? `${fallbackSummary}\n\nThe task is incomplete — the ${MAX_STEPS}-step limit was reached. Reply "continue" to keep going.`
        : `The task is incomplete — the ${MAX_STEPS}-step limit was reached after ${stepsCompleted} steps. Reply "continue" to keep going.`
      onEvent({
        type: 'max_steps_reached',
        stepsCompleted,
        maxSteps: MAX_STEPS,
        text: finalText
      })
      onEvent({ type: 'text', text: finalText })
      onEvent({ type: 'done' })
    } else {
      // Normal completion — ensure we always have a non-empty summary
      finalText =
        doneToolSummary ||
        result.text ||
        `Task completed in ${stepsCompleted} step${stepsCompleted === 1 ? '' : 's'}.`
      onEvent({ type: 'text', text: finalText })
      onEvent({ type: 'done', summary: finalText })
    }

    return {
      success: true,
      text: finalText,
      usage
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    if (errorMessage === 'Agent cancelled') {
      onEvent({ type: 'done', summary: 'Cancelled' })
      return { success: false, text: 'Cancelled', usage: { inputTokens: 0, outputTokens: 0 } }
    }

    console.error(`[ChatAgentV2] Error:`, error)
    onEvent({ type: 'error', error: errorMessage })
    return {
      success: false,
      error: errorMessage,
      usage: { inputTokens: 0, outputTokens: 0 }
    }
  }
}
