/**
 * Unified Browser Agent using AI Gateway
 *
 * This version uses the Vercel AI Gateway for all model providers,
 * eliminating the need for individual provider API keys.
 *
 * Changes from browser-agent-ai-sdk.ts:
 * - Uses Gateway model strings (e.g., "anthropic/claude-sonnet-4-6") instead of provider instances
 * - Single API key (AI_GATEWAY_API_KEY) for all providers
 * - OpenRouter fallback for free models
 */

import { ToolLoopAgent, stepCountIs, hasToolCall, generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { windowManager } from '../window-manager'
import { browserManager } from '../browser-manager'
import { agentBrowserService } from '../agent-browser-service'
import { keyCacheService } from '../key-cache-service'
import {
  mapModelId,
  isFreeModel,
  getGateway,
  getGenerationDetails,
  resolveOpenRouterModelId
} from '../ai/gateway-provider'
import { subscriptionService } from '../subscription-service'
import { calculateTokenCost } from '../model-pricing'
import {
  estimateTokenUsageFromGenerateResult,
  extractGenerateResultUsage,
  extractGenerationIdsFromResult,
  hasTokenUsage,
  normalizeTokenUsage,
  recoverUsageFromGenerationIds
} from './token-usage'
import {
  getGroundedPageContent,
  groundedClick,
  groundedType,
  formatPageContentForAgent,
  formatClickResultForAgent,
  formatTypeResultForAgent
} from './grounding/grounded-tools'
import { createUnifiedTools } from './unified-tools'
import { getModelSupportsVision } from '../chat-service'
import { getCloudMemoryService } from '../memory/CloudMemoryService'
import { getUnifiedKnowledgeService } from '../memory/UnifiedKnowledgeService'
import { getSkillMatcherService } from '../memory/SkillMatcherService'

// ── Agent Event / History / Usage Types ──────────────────────────────────────

export interface BrowserAgentEvent {
  type:
    | 'plan'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'text'
    | 'done'
    | 'error'
    | 'max_steps_reached'
    | 'history_update'
    | 'checkpoint'
  plan?: string
  thinking?: string
  tool?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  text?: string
  error?: string
  step?: number
  taskComplete?: boolean
  summary?: string
  messages?: BrowserAgentMessage[]
  checkpointStep?: number
  checkpointMessage?: string
}

export interface BrowserAgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentTokenUsage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

export type BrowserAgentMode = 'ask' | 'act'

const MAX_IMAGE_SIZE_BYTES = 4.5 * 1024 * 1024
const MAX_STEPS = 50
const CHECKPOINT_INTERVAL = 10
const COMPACTION_CHAR_THRESHOLD = 60_000

// ── Helpers ───────────────────────────────────────────────────────────────────

function compressImageForAPI(image: Electron.NativeImage): { base64: string; buffer: Buffer } {
  let quality = 90
  let scale = 1.0
  let buffer = image.toJPEG(quality)

  while (buffer.length > MAX_IMAGE_SIZE_BYTES && (quality > 20 || scale > 0.25)) {
    if (quality > 30) {
      quality -= 15
    } else if (scale > 0.25) {
      scale -= 0.25
      quality = 80
      const size = image.getSize()
      const resized = image.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'good'
      })
      buffer = resized.toJPEG(quality)
      continue
    } else {
      quality -= 10
    }
    buffer = image.toJPEG(quality)
  }

  return { base64: buffer.toString('base64'), buffer }
}

function getActiveTabWebContents(): Electron.WebContents | null {
  const browserWindow = windowManager.findWindowByType('browser') as BrowserWindow | undefined
  if (!browserWindow) return null
  return browserManager.getActiveTabWebContents(browserWindow.id)
}

// ── System Prompts ────────────────────────────────────────────────────────────

const BROWSER_ACT_SYSTEM_PROMPT = `You are a Browser Agent for Overlay, specialized in automating web tasks. You have access to TWO separate browsers — choose the right one for each situation.

## IMPORTANT: Your Identity
You are an AI assistant integrated into the Overlay app. You are powered by the model selected by the user. Always identify yourself by your actual model name when asked.

## TWO BROWSER ENVIRONMENTS

### 🔒 HEADLESS Browser (invisible — preferred for automation)
Tools: headless_navigate, headless_get_page_content, headless_click, headless_type, headless_scroll, headless_screenshot
- Runs in an offscreen Electron window the user CANNOT see
- Never stalls due to window visibility — reliable for long automation chains
- Has a 15-second hard timeout per operation; if it times out, try again or report the error
- Use this for: data scraping, form submission, login flows, research, any task that does NOT require the user to see what is happening

### 👁 VISIBLE Browser (user-facing — use sparingly)
Tools: browser_get_page_content, browser_click, browser_type, browser_scroll, browser_screenshot, navigate_browser
- Operates on the browser panel the user can see
- Use this ONLY when: (a) the user explicitly asks to see the browser, (b) you need to read the CURRENT page the user already has open, or (c) paired with request_user_input to let the user complete a step
- Do NOT use visible browser for background automation — always prefer headless

### 🧑 User Input Bridge
Tool: request_user_input
- Use when a task requires human interaction (login, CAPTCHA, confirmation)
- Surfaces the visible browser panel, pauses the agent, and waits for the user to complete the action
- After the user signals done, continue using the HEADLESS browser for remaining steps

## Tool Priority — ALWAYS follow this order:

1. **memory_search** — ALWAYS call first to personalize responses
2. **headless_navigate** → **headless_get_page_content** — Start headless for any new URL
3. **headless_click / headless_type / headless_scroll** — Interact in headless browser
4. **request_user_input** — Only when human interaction is strictly required
5. **browser_get_page_content** — Read visible browser ONLY if user has a page open they want analyzed
6. **Fallback**: applescript_run, launch_app — For system-level automation only

## CRITICAL Rules:
- DEFAULT to headless tools for ALL automation
- ALWAYS call headless_get_page_content after headless_navigate before clicking anything
- If a headless operation times out (15s), log the error and retry once; if it fails again, try an alternative approach or report
- NEVER use visible browser for background tasks the user does not need to watch

## Plan First (IMPORTANT):
For ANY task, ALWAYS start by outputting a numbered plan:

Plan:
1. [First step]
2. [Second step]
...

Then execute each step in order. After completing EACH step, continue to the next automatically.
DO NOT stop until ALL steps are completed or you encounter an unrecoverable error.

## Task Completion Rules (CRITICAL):
- ONLY call task_complete when you have FULLY satisfied the user's request
- If you cannot fully complete the task, set success=false and explain what's missing
- Never call task_complete just because you made progress — only when DONE
- When returning lists/results, format them clearly with markdown (use - for lists, NOT numbered lists unless specifically asked)`

const BROWSER_ASK_SYSTEM_PROMPT = `You are a helpful assistant embedded in the Overlay browser panel. Your job is to answer questions about the current web page WITHOUT taking any actions that modify it.

## IMPORTANT: Your Identity
You are an AI assistant integrated into the Overlay app. You are powered by the model selected by the user. Always identify yourself by your actual model name when asked.

## TWO BROWSER ENVIRONMENTS (ASK mode — read-only)
You have access to TWO browsers, but in ask mode use only the VISIBLE browser to read the current page:
- **Visible browser** (browser_get_page_content, browser_screenshot, browser_scroll) — reads what the user sees
- **Headless browser** (headless_navigate, headless_get_page_content, etc.) — use ONLY if you need to look up a supplementary URL to better answer the question

## CRITICAL: How to Respond
You MUST provide thorough, explanatory text responses. After using tools, ALWAYS write out your findings and answer the user's question in plain text. Never just call tools silently — the user needs to see your analysis and explanation.

## Tool Priority:
1. **memory_search** — ALWAYS search memory first to personalize your response
2. **browser_get_page_content** — Read the current VISIBLE page to understand its content
3. **browser_scroll** — Scroll if needed to find more content
4. **browser_screenshot** — Use for visual inspection when DOM analysis is insufficient
5. **headless_navigate + headless_get_page_content** — Only if a supplementary lookup is needed

## Rules:
1. ALWAYS call memory_search first to find relevant user context.
2. ALWAYS call browser_get_page_content to read the page before answering.
3. DO NOT click, type, navigate, or take any actions that modify the VISIBLE page state.
4. After reading the page, provide a clear, detailed text answer to the user's question.
5. If the page content is long, summarize the key points relevant to the question.
6. Be conversational and thorough in your explanations.
7. Call task_complete when you have fully answered the question.`

// ── JS snippets for browser automation ───────────────────────────────────────

function jsScroll(direction: string, amount: number): string {
  const scrollMap: Record<string, string> = {
    down: `window.scrollBy(0, ${amount})`,
    up: `window.scrollBy(0, -${amount})`,
    top: `window.scrollTo(0, 0)`,
    bottom: `window.scrollTo(0, document.body.scrollHeight)`
  }
  return `(function() { ${scrollMap[direction] || scrollMap.down}; return JSON.stringify({ success: true }); })()`
}

function createVisibleBrowserToolHandlers() {
  return {
    browserGetPageContent: async ({ taskIntent }: { taskIntent?: string }) => {
      console.log(
        `[UnifiedBrowserAgent] [visible] browserGetPageContent, intent: ${taskIntent ?? 'none'}`
      )
      const wc = getActiveTabWebContents()
      if (!wc) {
        console.warn(
          '[UnifiedBrowserAgent] [visible] browserGetPageContent — browser panel not open'
        )
        return JSON.stringify({ success: false, error: 'Browser panel not open' })
      }

      const groundedResult = await getGroundedPageContent(wc, taskIntent)
      return formatPageContentForAgent(groundedResult)
    },
    browserClick: async ({ target, taskIntent }: { target: string; taskIntent?: string }) => {
      console.log(`[UnifiedBrowserAgent] [visible] browserClick → target="${target}"`)
      const wc = getActiveTabWebContents()
      if (!wc) {
        console.warn('[UnifiedBrowserAgent] [visible] browserClick — browser not open')
        return JSON.stringify({ success: false, error: 'Browser not open' })
      }

      const clickResult = await groundedClick(wc, target, {
        taskIntent,
        verify: true,
        checkAdversarial: true
      })
      return formatClickResultForAgent(clickResult)
    },
    browserType: async ({
      target,
      selector,
      text,
      pressEnter,
      submit
    }: {
      target?: string
      selector?: string
      text: string
      pressEnter?: boolean
      submit?: boolean
    }) => {
      console.log(
        `[UnifiedBrowserAgent] [visible] browserType → target="${target ?? selector}", text="${text.slice(0, 50)}"`
      )
      const wc = getActiveTabWebContents()
      if (!wc) {
        console.warn('[UnifiedBrowserAgent] [visible] browserType — browser not open')
        return JSON.stringify({ success: false, error: 'Browser not open' })
      }

      const effectiveTarget = target || selector
      if (!effectiveTarget) {
        return JSON.stringify({ success: false, error: 'Target selector is required' })
      }

      const typeResult = await groundedType(wc, effectiveTarget, text, {
        submit: pressEnter ?? submit ?? false,
        verify: true
      })
      return formatTypeResultForAgent(typeResult)
    },
    browserScroll: async ({
      direction,
      amount
    }: {
      direction: 'up' | 'down' | 'top' | 'bottom'
      amount?: number
    }) => {
      console.log(`[UnifiedBrowserAgent] [visible] browserScroll → ${direction}`)
      const wc = getActiveTabWebContents()
      if (!wc) {
        console.warn('[UnifiedBrowserAgent] [visible] browserScroll — browser not open')
        return JSON.stringify({ success: false, error: 'Browser not open' })
      }

      const script = jsScroll(direction, amount || 500)
      const result = await wc.executeJavaScript(script)
      return typeof result === 'string' ? result : JSON.stringify(result)
    },
    browserWait: async ({ ms }: { ms?: number }) => {
      const waitMs = Math.min(ms || 1000, 10000)
      console.log(`[UnifiedBrowserAgent] [visible] browserWait → ${waitMs}ms`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      return JSON.stringify({ success: true, waited: waitMs })
    },
    navigateBrowser: async ({ url }: { url: string }) => {
      console.log(`[UnifiedBrowserAgent] [visible] navigateBrowser → ${url}`)
      const wc = getActiveTabWebContents()
      if (!wc) {
        console.warn('[UnifiedBrowserAgent] [visible] navigateBrowser — browser not open')
        return JSON.stringify({ success: false, error: 'Browser not open' })
      }

      await wc.loadURL(url)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      return JSON.stringify({ success: true, url })
    },
    browserScreenshot: async () => {
      console.log('[UnifiedBrowserAgent] [visible] browserScreenshot')
      const wc = getActiveTabWebContents()
      if (!wc) {
        console.warn('[UnifiedBrowserAgent] [visible] browserScreenshot — browser not open')
        return JSON.stringify({ success: false, error: 'Browser not open' })
      }

      const image = await wc.capturePage()
      const { base64, buffer } = compressImageForAPI(image)
      const debugDir = join(app.getPath('userData'), 'debug', 'pictures')
      mkdirSync(debugDir, { recursive: true })
      writeFileSync(join(debugDir, `browser-visible-${Date.now()}.jpg`), buffer)
      console.log(`[UnifiedBrowserAgent] [visible] browserScreenshot — ${buffer.length} bytes`)
      return `data:image/jpeg;base64,${base64}`
    }
  }
}

function createHeadlessBrowserToolHandlers(taskId: string) {
  return {
    browserGetPageContent: async ({ taskIntent }: { taskIntent?: string }) => {
      console.log(
        `[UnifiedBrowserAgent] [headless] browserGetPageContent, intent: ${taskIntent ?? 'none'}`
      )
      return agentBrowserService.getPageContent(taskId, taskIntent)
    },
    browserClick: async ({ target, taskIntent }: { target: string; taskIntent?: string }) => {
      console.log(`[UnifiedBrowserAgent] [headless] browserClick → target="${target}"`)
      return agentBrowserService.click(taskId, target, taskIntent)
    },
    browserType: async ({
      target,
      selector,
      text,
      pressEnter,
      submit
    }: {
      target?: string
      selector?: string
      text: string
      pressEnter?: boolean
      submit?: boolean
    }) => {
      const effectiveTarget = target || selector
      if (!effectiveTarget) {
        return JSON.stringify({ success: false, error: 'Target selector is required' })
      }
      console.log(
        `[UnifiedBrowserAgent] [headless] browserType → target="${effectiveTarget}", text="${text.slice(0, 50)}"`
      )
      return agentBrowserService.type(taskId, effectiveTarget, text, {
        pressEnter: pressEnter ?? submit ?? false
      })
    },
    browserScroll: async ({
      direction,
      amount
    }: {
      direction: 'up' | 'down' | 'top' | 'bottom'
      amount?: number
    }) => {
      console.log(`[UnifiedBrowserAgent] [headless] browserScroll → ${direction}`)
      return agentBrowserService.scroll(taskId, direction, amount ?? 500)
    },
    browserWait: async ({ ms }: { ms?: number }) => {
      const waitMs = Math.min(ms || 1000, 10000)
      console.log(`[UnifiedBrowserAgent] [headless] browserWait → ${waitMs}ms`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      return JSON.stringify({ success: true, waited: waitMs })
    },
    navigateBrowser: async ({ url }: { url: string }) => {
      console.log(`[UnifiedBrowserAgent] [headless] navigateBrowser → ${url}`)
      return agentBrowserService.navigate(taskId, url)
    },
    browserScreenshot: async () => {
      console.log('[UnifiedBrowserAgent] [headless] browserScreenshot')
      return agentBrowserService.screenshot(taskId)
    }
  }
}

// ── History Compaction ────────────────────────────────────────────────────────

function estimateCharCount(history: BrowserAgentMessage[]): number {
  return history.reduce((sum, m) => sum + m.content.length, 0)
}

async function compactBrowserHistory(
  history: BrowserAgentMessage[]
): Promise<BrowserAgentMessage[]> {
  if (history.length <= 4) return history

  const olderMessages = history.slice(0, -4)
  const recentMessages = history.slice(-4)
  const olderText = olderMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n')

  try {
    const openrouterKey = await keyCacheService.getKey('openrouter')
    if (!openrouterKey) {
      console.warn('[UnifiedBrowserAgent] No OpenRouter key for compaction, using recent messages')
      return recentMessages
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openrouter = (createOpenAI as any)({
      apiKey: openrouterKey,
      baseURL: 'https://openrouter.ai/api/v1',
      compatibility: 'compatible'
    })
    const compactionModelId = resolveOpenRouterModelId('openrouter/free')
    const compactionModel = openrouter(compactionModelId)

    const result = await generateText({
      model: compactionModel,
      system: 'You are a helpful assistant that summarizes conversations concisely.',
      messages: [
        {
          role: 'user',
          content: `Summarize the following conversation history in 2-3 sentences, preserving key facts and context:\n\n${olderText}`
        }
      ]
    })

    console.log(`[UnifiedBrowserAgent] Compacted ${olderMessages.length} messages into summary`)
    return [
      { role: 'assistant', content: `[Previous conversation summary: ${result.text}]` },
      ...recentMessages
    ]
  } catch (err) {
    console.warn('[UnifiedBrowserAgent] Compaction failed, using recent messages only:', err)
    return recentMessages
  }
}

function buildPromptWithHistory(command: string, history: BrowserAgentMessage[]): string {
  if (history.length === 0) return command

  const historyText = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `## Conversation History\n${historyText}\n\n---\n\n## Current Task\n${command}`
}

// ── Pre-fetch Context ─────────────────────────────────────────────────────────

interface PrefetchedContext {
  memorySnippet: string
  notesSnippet: string
  skillsSnippet: string
}

async function prefetchAgentContext(command: string): Promise<PrefetchedContext> {
  const memoryLines: string[] = []
  const notesLines: string[] = []
  const skillsLines: string[] = []

  await Promise.allSettled([
    (async () => {
      try {
        const memoryService = getCloudMemoryService()
        const results = await memoryService.search(command, 5)
        for (const r of results) {
          memoryLines.push(`- [${r.type}] ${r.content}`)
        }
      } catch (err) {
        console.warn('[UnifiedBrowserAgent] Pre-fetch memory failed:', err)
      }
    })(),
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
        console.warn('[UnifiedBrowserAgent] Pre-fetch knowledge failed:', err)
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
          console.log(`[UnifiedBrowserAgent] Pre-fetched ${skills.length} relevant skill(s)`)
        }
      } catch (err) {
        console.warn('[UnifiedBrowserAgent] Pre-fetch skills failed:', err)
      }
    })()
  ])

  return {
    memorySnippet: memoryLines.length > 0 ? memoryLines.join('\n') : '',
    notesSnippet: notesLines.length > 0 ? notesLines.join('\n') : '',
    skillsSnippet: skillsLines.length > 0 ? skillsLines.join('\n\n---\n\n') : ''
  }
}

function buildSystemPromptWithContext(basePrompt: string, context: PrefetchedContext): string {
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

// ── Get Model for Gateway ─────────────────────────────────────────────────────

async function getGatewayModel(modelId: string): Promise<string> {
  // Map legacy model IDs to Gateway format
  const gatewayModelId = mapModelId(modelId)

  // For free models, we need to use OpenRouter directly
  if (isFreeModel(gatewayModelId)) {
    console.log(`[UnifiedBrowserAgent] Free model detected: ${gatewayModelId}, using OpenRouter`)
    // Return the model ID as-is - will be handled by OpenRouter provider
    return gatewayModelId
  }

  return gatewayModelId
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createModelInstance(modelId: string): Promise<any> {
  const gatewayModelId = await getGatewayModel(modelId)

  // Free models use OpenRouter directly
  if (isFreeModel(gatewayModelId)) {
    const openrouterKey = await keyCacheService.getKey('openrouter')
    if (!openrouterKey) {
      throw new Error('OpenRouter API key not configured for free model')
    }
    const openrouterModelId = resolveOpenRouterModelId(gatewayModelId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (createOpenAI as any)({
      apiKey: openrouterKey,
      baseURL: 'https://openrouter.ai/api/v1',
      compatibility: 'compatible',
      headers: {
        'HTTP-Referer': 'https://overlay.app',
        'X-Title': 'Overlay Browser Agent'
      }
    })(openrouterModelId)
  }

  // All other models use Gateway - get model instance from gateway
  const gateway = await getGateway()
  return gateway(gatewayModelId)
}

// ── Main Function ─────────────────────────────────────────────────────────────

export async function runUnifiedBrowserAgent(
  command: string,
  onEvent: (event: BrowserAgentEvent) => void,
  isCancelled: () => boolean,
  securityTaskId: string,
  conversationHistory: BrowserAgentMessage[] = [],
  modelId?: string,
  mode: BrowserAgentMode = 'act'
): Promise<{
  summary: string
  steps: number
  messages: BrowserAgentMessage[]
  usage: AgentTokenUsage
}> {
  const effectiveModelId = modelId || 'anthropic/claude-haiku-4-5'
  const gatewayModelId = mapModelId(effectiveModelId)

  console.log(
    `[UnifiedBrowserAgent] ══════════════════════════════════════════════════════════════`
  )
  console.log(`[UnifiedBrowserAgent] Starting agent session (ToolLoopAgent)`)
  console.log(`[UnifiedBrowserAgent]   Original Model: ${effectiveModelId}`)
  console.log(`[UnifiedBrowserAgent]   Gateway Model: ${gatewayModelId}`)
  console.log(`[UnifiedBrowserAgent]   Is Free: ${isFreeModel(gatewayModelId)}`)
  console.log(`[UnifiedBrowserAgent]   Mode: ${mode}`)
  console.log(
    `[UnifiedBrowserAgent]   Command: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`
  )
  console.log(
    `[UnifiedBrowserAgent] ══════════════════════════════════════════════════════════════`
  )

  onEvent({
    type: 'thinking',
    thinking: mode === 'ask' ? 'Reading page...' : 'Analyzing browser page...'
  })

  const supportsVision = getModelSupportsVision(effectiveModelId)
  const stepRef = { current: 0 }
  const totalUsage: AgentTokenUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }

  try {
    const modelInstance = await createModelInstance(effectiveModelId)

    console.log(
      `[UnifiedBrowserAgent] Initializing tool handlers — visible browser + headless (AgentBrowserService)`
    )
    const tools = await createUnifiedTools({
      surface: 'browser',
      securityTaskId,
      isCancelled,
      supportsVision,
      browserHandlers: createVisibleBrowserToolHandlers(),
      headlessBrowserHandlers: createHeadlessBrowserToolHandlers(securityTaskId),
      hooks: {
        onToolStart: (toolName, toolInput) =>
          onEvent({
            type: 'tool_start',
            tool: toolName,
            toolInput,
            step: stepRef.current
          }),
        onToolResult: (toolName, toolResult) =>
          onEvent({
            type: 'tool_result',
            tool: toolName,
            toolResult: toolResult.slice(0, 500),
            step: stepRef.current
          })
      }
    })

    // Compact history if it exceeds the threshold
    let effectiveHistory = conversationHistory
    if (estimateCharCount(conversationHistory) > COMPACTION_CHAR_THRESHOLD) {
      console.log(
        `[UnifiedBrowserAgent] History too large (${estimateCharCount(conversationHistory)} chars), compacting...`
      )
      effectiveHistory = await compactBrowserHistory(conversationHistory)
    }

    // Pre-fetch memory and notes context deterministically before the loop
    const prefetchedContext = await prefetchAgentContext(command)
    const baseSystemPrompt = mode === 'ask' ? BROWSER_ASK_SYSTEM_PROMPT : BROWSER_ACT_SYSTEM_PROMPT
    const systemPrompt = buildSystemPromptWithContext(baseSystemPrompt, prefetchedContext)
    const prompt = buildPromptWithHistory(command, effectiveHistory)

    const agent = new ToolLoopAgent({
      model: modelInstance,
      instructions: systemPrompt,
      tools,
      stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('task_complete')],
      toolChoice: 'auto',
      onStepFinish: async ({ text, toolCalls, usage }) => {
        if (isCancelled()) return

        if (usage) {
          const stepUsage = normalizeTokenUsage(usage)
          totalUsage.inputTokens += stepUsage.inputTokens
          totalUsage.outputTokens += stepUsage.outputTokens
          totalUsage.cachedTokens += stepUsage.cachedTokens
        }

        if (text && text.trim()) {
          onEvent({ type: 'text', text })
        }

        if (toolCalls && toolCalls.length > 0) {
          console.log(
            `[UnifiedBrowserAgent] Step ${stepRef.current} completed with ${toolCalls.length} tool call(s)`
          )
        }
      },
      prepareStep: async ({ stepNumber }) => {
        if (isCancelled()) throw new Error('Cancelled')
        stepRef.current = stepNumber
        console.log(
          `[UnifiedBrowserAgent] ── Step ${stepNumber}/${MAX_STEPS} ──────────────────────────────────────`
        )
        if (stepNumber > 0 && stepNumber % CHECKPOINT_INTERVAL === 0) {
          onEvent({
            type: 'checkpoint',
            checkpointStep: stepNumber,
            checkpointMessage: `Completed ${stepNumber} steps — still working...`
          })
        }
        return {}
      }
    })

    const result = await agent.generate({ prompt })

    // Prefer AI SDK aggregate usage, then fall back to step-accumulated usage
    let extractedUsage = extractGenerateResultUsage(result)
    if (!hasTokenUsage(extractedUsage) && !isFreeModel(gatewayModelId)) {
      const generationIds = extractGenerationIdsFromResult(result)
      if (generationIds.length > 0) {
        console.log(
          `[UnifiedBrowserAgent] Attempting Gateway usage recovery from generation IDs: ${generationIds.join(', ')}`
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
            console.warn(`[UnifiedBrowserAgent] Failed to fetch usage for generation ${id}:`, err)
            return null
          }
        })
        if (hasTokenUsage(recoveredUsage)) {
          extractedUsage = recoveredUsage
          console.log(
            `[UnifiedBrowserAgent] Recovered usage from Gateway generations: ${extractedUsage.inputTokens} in, ${extractedUsage.outputTokens} out`
          )
        }
      }
    }
    if (!hasTokenUsage(extractedUsage)) {
      extractedUsage = estimateTokenUsageFromGenerateResult(result)
      if (hasTokenUsage(extractedUsage)) {
        console.log(
          `[UnifiedBrowserAgent] Estimated usage fallback: ${extractedUsage.inputTokens} in, ${extractedUsage.outputTokens} out`
        )
      }
    }
    // Use extracted usage if available, otherwise keep step-accumulated totals
    if (
      extractedUsage.inputTokens > 0 ||
      extractedUsage.outputTokens > 0 ||
      extractedUsage.cachedTokens > 0
    ) {
      totalUsage.inputTokens = extractedUsage.inputTokens
      totalUsage.outputTokens = extractedUsage.outputTokens
      totalUsage.cachedTokens = extractedUsage.cachedTokens
    }

    // Extract summary from task_complete tool call
    const taskCompleteTool = result.steps
      ?.flatMap((s) => s.toolCalls || [])
      .find((tc) => tc.toolName === 'task_complete')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = (taskCompleteTool as any)?.args?.summary || result.text || 'Task completed.'

    // Emit final text if it wasn't already emitted via onStepFinish
    if (result.text && result.text.trim()) {
      const alreadyEmitted = result.steps?.some((s) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stepText = (s as any).text
        return stepText && stepText.trim() === result.text?.trim()
      })
      if (!alreadyEmitted) {
        onEvent({ type: 'text', text: result.text })
      }
    }

    console.log(
      `[UnifiedBrowserAgent] Session complete. Steps: ${stepRef.current}, Usage: ${totalUsage.inputTokens} in, ${totalUsage.outputTokens} out`
    )

    // Record usage
    const cost = calculateTokenCost(
      effectiveModelId,
      totalUsage.inputTokens,
      totalUsage.cachedTokens,
      totalUsage.outputTokens
    )
    subscriptionService.recordUsage('agent', cost, effectiveModelId, {
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
      cachedTokens: totalUsage.cachedTokens
    })

    const updatedMessages: BrowserAgentMessage[] = [
      ...conversationHistory,
      { role: 'user', content: command },
      { role: 'assistant', content: summary }
    ]

    // Emit history_update BEFORE done so the renderer captures it before the listener is removed
    onEvent({ type: 'history_update', messages: updatedMessages })
    onEvent({ type: 'done', taskComplete: true, summary })

    return {
      summary,
      steps: stepRef.current,
      messages: updatedMessages,
      usage: totalUsage
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage === 'Cancelled') {
      onEvent({ type: 'done' })
      return {
        summary: 'Cancelled',
        steps: stepRef.current,
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
      }
    }
    console.error('[UnifiedBrowserAgent] Error:', error)
    onEvent({ type: 'error', error: errorMessage })
    return {
      summary: `Error: ${errorMessage}`,
      steps: stepRef.current,
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
    }
  }
}
