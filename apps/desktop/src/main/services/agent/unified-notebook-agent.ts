/**
 * Unified Notebook Agent
 *
 * Uses Vercel AI Gateway for all model providers with a single API key.
 * OpenRouter fallback for free models (openrouter/free).
 *
 * This replaces the multi-provider notebook-agent.ts
 */

import { ToolLoopAgent, stepCountIs } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { keyCacheService } from '../key-cache-service'
import {
  mapModelId,
  isFreeModel,
  getGateway,
  getGenerationDetails,
  resolveOpenRouterModelId
} from '../ai/gateway-provider'
import type { AgentTokenUsage } from './unified-browser-agent'
import {
  estimateTokenUsageFromGenerateResult,
  extractGenerateResultUsage,
  extractGenerationIdsFromResult,
  hasTokenUsage,
  normalizeTokenUsage,
  recoverUsageFromGenerationIds
} from './token-usage'
import { createUnifiedTools } from './unified-tools'

const DEFAULT_MODEL_ID = 'anthropic/claude-haiku-4-5'

// ── Retry configuration ─────────────────────────────────────────────────────────

const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
}

// ── Error classification helpers ────────────────────────────────────────────────

interface ClassifiedError {
  isRetryable: boolean
  isRateLimit: boolean
  userMessage: string
  retryAfterMs?: number
}

function classifyError(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err)
  const lowerMessage = message.toLowerCase()

  // Rate limit errors
  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('rate_limit') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('429')
  ) {
    const retryMatch = message.match(/try again in ([\d.]+)s/i)
    const retryAfterMs = retryMatch ? Math.ceil(parseFloat(retryMatch[1]) * 1000) : undefined

    return {
      isRetryable: true,
      isRateLimit: true,
      userMessage: 'Rate limit reached. Retrying automatically...',
      retryAfterMs
    }
  }

  // Timeout / network errors
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('econnreset') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('socket hang up') ||
    lowerMessage.includes('fetch failed')
  ) {
    return {
      isRetryable: true,
      isRateLimit: false,
      userMessage: 'Connection issue. Retrying...'
    }
  }

  // Server errors (5xx)
  if (
    lowerMessage.includes('500') ||
    lowerMessage.includes('502') ||
    lowerMessage.includes('503') ||
    lowerMessage.includes('504') ||
    lowerMessage.includes('internal server error') ||
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('bad gateway')
  ) {
    return {
      isRetryable: true,
      isRateLimit: false,
      userMessage: 'Server temporarily unavailable. Retrying...'
    }
  }

  // Overloaded errors
  if (
    lowerMessage.includes('overloaded') ||
    lowerMessage.includes('capacity') ||
    lowerMessage.includes('busy')
  ) {
    return {
      isRetryable: true,
      isRateLimit: false,
      userMessage: 'Service is busy. Retrying...'
    }
  }

  // API key errors - not retryable
  if (
    lowerMessage.includes('api key') ||
    lowerMessage.includes('apikey') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('invalid_api_key') ||
    lowerMessage.includes('401')
  ) {
    return {
      isRetryable: false,
      isRateLimit: false,
      userMessage: 'API key error. Please check your API key in settings.'
    }
  }

  // Quota/billing errors - not retryable
  if (
    lowerMessage.includes('quota') ||
    lowerMessage.includes('billing') ||
    lowerMessage.includes('insufficient') ||
    lowerMessage.includes('exceeded')
  ) {
    return {
      isRetryable: false,
      isRateLimit: false,
      userMessage: 'API quota exceeded. Please check your billing or usage limits.'
    }
  }

  // Context length errors - not retryable
  if (
    lowerMessage.includes('context length') ||
    lowerMessage.includes('too long') ||
    lowerMessage.includes('maximum context') ||
    lowerMessage.includes('token limit')
  ) {
    return {
      isRetryable: false,
      isRateLimit: false,
      userMessage: 'Note is too long for this model. Try a smaller section or a different model.'
    }
  }

  // Default: not retryable
  return {
    isRetryable: false,
    isRateLimit: false,
    userMessage: message
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function calculateBackoffDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs) {
    return Math.min(retryAfterMs + 500, RETRY_CONFIG.maxDelayMs)
  }
  const exponentialDelay =
    RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt)
  const jitter = Math.random() * 500
  return Math.min(exponentialDelay + jitter, RETRY_CONFIG.maxDelayMs)
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NotebookEdit {
  id: string
  description: string
  startLine: number
  endLine: number
  originalLines: string[]
  newLines: string[]
}

export interface NotebookAgentEvent {
  type: 'thinking' | 'tool_call' | 'edit_proposal' | 'text' | 'done' | 'error'
  thinking?: string
  tool?: string
  toolInput?: Record<string, unknown>
  edit?: NotebookEdit
  text?: string
  error?: string
  step?: number
}

// ── System prompts ───────────────────────────────────────────────────────────────────

const WRITE_MODE_PROMPT = `You are a precise note-editing assistant embedded in a notebook app. Your job is to edit the user's note based on their request, or create new content from scratch if the note is empty.

## CRITICAL: Memory Search FIRST
**BEFORE making any edits**, you MUST search memory to personalize your response:
1. Call memory_search with keywords from the user's request to find relevant facts, preferences, and context
2. Use the retrieved context to personalize your edits and make them relevant to the user

This is MANDATORY for every request. Never skip memory search. The user expects you to remember them.

## Tools available:
- memory_search: Search user memories for relevant context (ALWAYS call this FIRST)
- read_note: Read the current note content (including title) with line numbers
- propose_edit: Propose a change to a range of lines. The user will accept or reject each edit individually.
- finish: Signal that you are done proposing edits.
- Additional macOS tools are available for explicit system tasks: launch_app, applescript_run, reminders_create, reminders_list, timer_set, contacts_search, imessage_send, ax_list_apps, ax_get_ui_tree, ax_click, download_file, shortcuts_list, shortcuts_run, shortcuts_view.

## Rules:
1. Always call memory_search first to find relevant user context, then read_note to see the current content.
2. If the note is empty or minimal, you CAN and SHOULD create comprehensive new content from scratch. Do not refuse to write content just because the note is empty.
3. Make targeted, precise edits. Use multiple propose_edit calls for separate independent changes.
4. Be exact with line numbers — only include lines you are actually changing.
5. If adding new content to an empty note, use start_line=1 and end_line=1.
6. After proposing all edits, call finish with a brief summary.
7. Preserve the user's writing style and tone when editing existing content.
8. Always render mathematical equations and formulas using LaTeX syntax. CRITICAL FORMATTING RULES:
   - Inline math: Use $content$ with NO spaces between $ and content (wrong: $ x^2 $, correct: $x^2$)
   - Display math: Use $$content$$ ALL ON ONE LINE, not on separate lines (wrong: $$\\nx=1\\n$$, correct: $$x=1$$)
   - For multi-line equations, use LaTeX environments like \\begin{aligned}...\\end{aligned} inside the $$ delimiters on ONE line.
9. Use --- on its own line for horizontal rules/section breaks.
10. For tables, use markdown table syntax: | Header1 | Header2 | with |---| separator row.
11. For note-writing/editing requests, prioritize note tools. Only use macOS system tools when the user explicitly asks for external system actions.`

const ASK_MODE_PROMPT = `You are a helpful assistant embedded in a notebook app. Your job is to answer questions about the user's note WITHOUT making any edits.

## CRITICAL: Memory Search FIRST
**BEFORE answering ANY question**, you MUST search memory to personalize your response:
1. Call memory_search with keywords from the user's question to find relevant facts, preferences, and context
2. Use the retrieved context to personalize your answer

This is MANDATORY for every question. Never skip memory search. The user expects you to remember them.

## Tools available:
- memory_search: Search user memories for relevant context (ALWAYS call this FIRST)
- read_note: Read the current note content with line numbers
- finish: Signal that you are done with your response.
- Additional macOS tools are available for explicit system tasks: launch_app, applescript_run, reminders_create, reminders_list, timer_set, contacts_search, imessage_send, ax_list_apps, ax_get_ui_tree, ax_click, download_file, shortcuts_list, shortcuts_run, shortcuts_view.

## Rules:
1. Always call memory_search first to find relevant user context, then read_note to understand the note content.
2. Answer questions, explain concepts, provide insights, or help the user understand their notes.
3. Do NOT propose any edits. This is ask mode - you are here to help, not to change the note.
4. When explaining mathematical concepts, use LaTeX syntax. IMPORTANT: Use $content$ for inline math and $$content$$ for display math - NO SPACES between $ and the content (wrong: $ x^2 $, correct: $x^2$).
5. Be concise but thorough in your explanations.
6. After answering, call finish with a brief summary of what you explained.
7. For note Q&A requests, prioritize note tools. Only use macOS system tools when the user explicitly asks for external system actions.`

// ── Get model for Gateway or OpenRouter ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getModelForAgent(modelId: string): Promise<any> {
  const gatewayModelId = mapModelId(modelId)

  // Free models use OpenRouter directly
  if (isFreeModel(gatewayModelId)) {
    console.log(`[UnifiedNotebookAgent] Using OpenRouter for free model: ${gatewayModelId}`)
    const openrouterKey = await keyCacheService.getKey('openrouter')
    if (!openrouterKey) {
      throw new Error('OpenRouter API key not configured for free models')
    }
    const openrouterModelId = resolveOpenRouterModelId(gatewayModelId)
    const openrouter = createOpenAI({
      apiKey: openrouterKey,
      baseURL: 'https://openrouter.ai/api/v1'
    })
    return openrouter(openrouterModelId)
  }

  // All other models use AI Gateway
  console.log(`[UnifiedNotebookAgent] Using Gateway for model: ${gatewayModelId}`)
  const gateway = await getGateway()
  return gateway(gatewayModelId)
}

// ── Main unified notebook agent ───────────────────────────────────────────────────────

export async function runUnifiedNotebookAgent(
  noteContent: string,
  noteTitle: string,
  userCommand: string,
  modelId: string,
  mode: 'ask' | 'write',
  onEvent: (event: NotebookAgentEvent) => void,
  isCancelled: () => boolean,
  securityTaskId: string
): Promise<{ usage: AgentTokenUsage }> {
  const totalUsage: AgentTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0
  }

  const effectiveModelId = modelId || DEFAULT_MODEL_ID
  const gatewayModelId = mapModelId(effectiveModelId)

  console.log(
    `[UnifiedNotebookAgent] ══════════════════════════════════════════════════════════════`
  )
  console.log(`[UnifiedNotebookAgent] Starting agent session (Gateway)`)
  console.log(`[UnifiedNotebookAgent]   Original Model: ${effectiveModelId}`)
  console.log(`[UnifiedNotebookAgent]   Gateway Model: ${gatewayModelId}`)
  console.log(`[UnifiedNotebookAgent]   Is Free: ${isFreeModel(gatewayModelId)}`)
  console.log(`[UnifiedNotebookAgent]   Mode: ${mode}`)
  console.log(
    `[UnifiedNotebookAgent] ══════════════════════════════════════════════════════════════`
  )

  const currentContent = noteContent
  const currentTitle = noteTitle || 'Untitled'
  let editIdCounter = 0
  let finished = false

  onEvent({ type: 'thinking', thinking: 'Analyzing note...' })

  let attempt = 0
  let lastError: Error | null = null

  while (attempt <= RETRY_CONFIG.maxRetries) {
    if (isCancelled()) {
      onEvent({ type: 'done' })
      return { usage: totalUsage }
    }

    try {
      // Get model from Gateway or OpenRouter
      const model = await getModelForAgent(effectiveModelId)

      // Select prompt based on mode
      const systemPrompt = mode === 'ask' ? ASK_MODE_PROMPT : WRITE_MODE_PROMPT

      const tools = await createUnifiedTools({
        surface: 'notebook',
        securityTaskId,
        isCancelled,
        notebookContext: {
          noteContent: currentContent,
          noteTitle: currentTitle,
          mode,
          createEditId: () => `edit-${Date.now()}-${editIdCounter++}`,
          onEditProposal: (edit) => {
            onEvent({ type: 'edit_proposal', edit })
            console.log(
              `[UnifiedNotebookAgent] propose_edit — lines ${edit.startLine}–${edit.endLine}: "${edit.description}"`
            )
          },
          onFinish: (summary) => {
            finished = true
            onEvent({ type: 'text', text: summary })
            console.log(`[UnifiedNotebookAgent] finish — "${summary}"`)
          }
        },
        hooks: {
          onToolStart: (toolName, toolInput) => {
            onEvent({
              type: 'tool_call',
              tool: toolName,
              toolInput
            })
          }
        }
      })

      const notebookAgent = new ToolLoopAgent({
        model,
        instructions: systemPrompt,
        tools,
        stopWhen: stepCountIs(20),
        onStepFinish: async ({ text, toolCalls, usage }) => {
          if (isCancelled()) return

          // Accumulate token usage from each step
          if (usage) {
            const stepUsage = normalizeTokenUsage(usage)
            totalUsage.inputTokens += stepUsage.inputTokens
            totalUsage.outputTokens += stepUsage.outputTokens
            totalUsage.cachedTokens += stepUsage.cachedTokens
          }

          // Emit any text generated in this step
          if (text && text.trim()) {
            onEvent({ type: 'text', text })
          }

          // Log step progress
          if (toolCalls && toolCalls.length > 0) {
            console.log(
              `[UnifiedNotebookAgent] Step completed with ${toolCalls.length} tool call(s)`
            )
          }
        }
      })

      // Run the agent
      const result = await notebookAgent.generate({
        prompt: `Note content:\n\n${noteContent || '(empty note)'}\n\n---\n\nUser request: ${userCommand}`
      })

      // Prefer AI SDK aggregate usage (totalUsage), then step-level, then last-step usage.
      // Keep onStepFinish accumulation only if the generate result has no usage.
      const extractedUsage = extractGenerateResultUsage(result)
      let finalUsage = extractedUsage
      if (!hasTokenUsage(finalUsage) && !isFreeModel(gatewayModelId)) {
        const generationIds = extractGenerationIdsFromResult(result)
        if (generationIds.length > 0) {
          console.log(
            `[UnifiedNotebookAgent] Attempting Gateway usage recovery from generation IDs: ${generationIds.join(', ')}`
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
              console.warn(
                `[UnifiedNotebookAgent] Failed to fetch usage for generation ${id}:`,
                err
              )
              return null
            }
          })
          if (hasTokenUsage(recoveredUsage)) {
            finalUsage = recoveredUsage
            console.log(
              `[UnifiedNotebookAgent] Recovered usage from Gateway generations: ${finalUsage.inputTokens} in, ${finalUsage.outputTokens} out`
            )
          }
        }
      }
      if (!hasTokenUsage(finalUsage)) {
        finalUsage = estimateTokenUsageFromGenerateResult(result)
        if (hasTokenUsage(finalUsage)) {
          console.log(
            `[UnifiedNotebookAgent] Estimated usage fallback: ${finalUsage.inputTokens} in, ${finalUsage.outputTokens} out`
          )
        }
      }
      if (
        finalUsage.inputTokens > 0 ||
        finalUsage.outputTokens > 0 ||
        finalUsage.cachedTokens > 0
      ) {
        totalUsage.inputTokens = finalUsage.inputTokens
        totalUsage.outputTokens = finalUsage.outputTokens
        totalUsage.cachedTokens = finalUsage.cachedTokens
      }

      // If we have final text and didn't finish via the finish tool, emit it
      if (result.text && result.text.trim() && !finished) {
        onEvent({ type: 'text', text: result.text })
      }

      console.log(
        `[UnifiedNotebookAgent] Total usage: ${totalUsage.inputTokens} input, ${totalUsage.outputTokens} output`
      )
      onEvent({ type: 'done' })
      return { usage: totalUsage }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const classified = classifyError(err)

      console.error(
        `[UnifiedNotebookAgent] Error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}): ${lastError.message}`
      )

      if (classified.isRetryable && attempt < RETRY_CONFIG.maxRetries) {
        const delay = calculateBackoffDelay(attempt, classified.retryAfterMs)
        console.log(
          `[UnifiedNotebookAgent] ${classified.userMessage} Waiting ${Math.round(delay / 1000)}s before retry...`
        )

        onEvent({
          type: 'thinking',
          thinking: `${classified.userMessage} (attempt ${attempt + 2}/${RETRY_CONFIG.maxRetries + 1} in ${Math.round(delay / 1000)}s)`
        })

        await sleep(delay)
        attempt++
        continue
      }

      // Not retryable or exhausted retries
      const finalMessage =
        attempt >= RETRY_CONFIG.maxRetries
          ? `Failed after ${attempt + 1} attempts: ${classified.userMessage}`
          : classified.userMessage

      console.error(`[UnifiedNotebookAgent] Final error: ${finalMessage}`)
      onEvent({ type: 'error', error: finalMessage })
      return { usage: totalUsage }
    }
  }

  // Should not reach here
  if (lastError) {
    const classified = classifyError(lastError)
    onEvent({
      type: 'error',
      error: `Failed after ${RETRY_CONFIG.maxRetries + 1} attempts: ${classified.userMessage}`
    })
  }
  return { usage: totalUsage }
}

export async function runNotebookAgentStreaming(
  noteContent: string,
  noteTitle: string,
  userCommand: string,
  modelId: string,
  mode: 'ask' | 'write',
  onEvent: (event: NotebookAgentEvent) => void,
  isCancelled: () => boolean,
  securityTaskId: string
): Promise<{ usage: AgentTokenUsage }> {
  return runUnifiedNotebookAgent(
    noteContent,
    noteTitle,
    userCommand,
    modelId,
    mode,
    onEvent,
    isCancelled,
    securityTaskId
  )
}
