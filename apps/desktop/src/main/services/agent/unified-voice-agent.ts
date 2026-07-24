/**
 * Unified Voice Agent
 *
 * Uses Vercel AI Gateway for all model providers with a single API key.
 * OpenRouter fallback for free models (openrouter/free).
 */

import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { keyCacheService } from '../key-cache-service'
import {
  getGenerationDetails,
  mapModelId,
  isFreeModel,
  getGateway,
  resolveOpenRouterModelId
} from '../ai/gateway-provider'
import { subscriptionService } from '../subscription-service'
import { calculateTokenCost } from '../model-pricing'
import { getConnectedToolkits, syncConnectedToolkits } from './composio-service'
import { createUnifiedTools } from './unified-tools'
import {
  estimateTokenUsageFromGenerateResult,
  extractGenerateResultUsage,
  extractGenerationIdsFromResult,
  hasTokenUsage,
  recoverUsageFromGenerationIds
} from './token-usage'

const DEFAULT_MODEL_ID = 'anthropic/claude-haiku-4-5'

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

function getLocalISOString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const tzOffset = now.getTimezoneOffset()
  const tzSign = tzOffset <= 0 ? '+' : '-'
  const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0')
  const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${tzSign}${tzHours}:${tzMins}`
}

function getSystemPrompt(connectedToolkits: string[] = []): string {
  const dateTime = getCurrentDateTimeString()
  const localISO = getLocalISOString()
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzOffset = localISO.slice(-6)

  const preConnectedSection =
    connectedToolkits.length > 0
      ? `\n## Pre-connected Toolkits\n**${connectedToolkits.join(', ')}** are already authenticated. For these, use COMPOSIO_SEARCH_TOOLS → COMPOSIO_MULTI_EXECUTE_TOOL directly (no COMPOSIO_MANAGE_CONNECTIONS needed).\n`
      : ''

  return `You are Overlay, a precise macOS AI agent. Execute user commands to completion.${preConnectedSection}

## CRITICAL: Current Date and Time (USER'S LOCAL TIME)
**Now: ${dateTime}**
**Timezone: ${tzName} (UTC${tzOffset})**
**Current ISO datetime: ${localISO}**

IMPORTANT: Use this EXACT timezone offset (${tzOffset}) for ALL calendar events. The user is in ${tzName}, NOT UTC.

## CRITICAL: Calendar Event Creation
When creating calendar events, you MUST:
1. **summary** (REQUIRED): Extract the event title from user's request (e.g., "gym" → "Gym session")
2. **start_datetime** (REQUIRED): Use the user's LOCAL timezone offset (${tzOffset}):
   - "tomorrow at 1pm" → ${localISO.slice(0, 10)} next day + T13:00:00${tzOffset}
   - "at 3pm" → today's date + T15:00:00${tzOffset}
   - ALWAYS append ${tzOffset} to the datetime
3. **end_datetime** (REQUIRED): Default to 1 hour after start, same timezone offset
4. NEVER use UTC (+00:00). ALWAYS use ${tzOffset}

## CRITICAL: Memory Search FIRST
**BEFORE answering ANY user query**, you MUST search memory to personalize your response:
1. Call memory_search with keywords from the user's query
2. Use the retrieved context to personalize your response

## Integration Tools (Composio)
Use these meta tools for any app integration (email, calendar, GitHub, Slack, etc.):
1. **COMPOSIO_SEARCH_TOOLS** — find the right tool for the task
2. **COMPOSIO_MULTI_EXECUTE_TOOL** — execute discovered tools
If a toolkit is not connected, tell the user to connect it via Settings → Integrations and stop.
Do NOT attempt in-chat authentication — the voice agent requires pre-authentication via Settings.

## Tool Priority:
0. **Memory tools (ALWAYS FIRST)** — Search memory before ANY other action
1. Composio meta tools (COMPOSIO_SEARCH_TOOLS → COMPOSIO_MULTI_EXECUTE_TOOL)
2. AppleScript tools (reminders_create, timer_set, contacts_search, imessage_send)
3. launch_app — for opening external macOS apps
4. browser_* tools — for Overlay's built-in browser panel
5. AX tree tools — when AppleScript unavailable
6. system_screenshot — LAST RESORT

## Key rules:
1. Gmail/Calendar/Slack → use Composio meta tools, NOT browser
2. Reminders/Timers → use AppleScript tools (reminders_create, timer_set)
3. iMessage → contacts_search FIRST, THEN imessage_send
4. External browsers (Brave, Chrome) → launch_app, NOT browser_*
5. Always verify success after actions`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getModelForAgent(modelId: string): Promise<any> {
  const gatewayModelId = mapModelId(modelId)

  if (isFreeModel(gatewayModelId)) {
    console.log(`[UnifiedVoiceAgent] Using OpenRouter for free model: ${gatewayModelId}`)
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

  console.log(`[UnifiedVoiceAgent] Using Gateway for model: ${gatewayModelId}`)
  const gateway = await getGateway()
  return gateway(gatewayModelId)
}

async function createVoiceAgentTools(
  onToolCall: (name: string, input: unknown) => void,
  command: string,
  securityTaskId: string
): Promise<Awaited<ReturnType<typeof createUnifiedTools>>> {
  return createUnifiedTools({
    surface: 'voice',
    securityTaskId,
    hooks: {
      onToolStart: (name, input) => onToolCall(name, input)
    },
    composio: {
      includeMetaTools: true,
      command
    }
  })
}

export interface VoiceAgentResult {
  summary: string
  steps: number
  success: boolean
  usage: { inputTokens: number; outputTokens: number }
}

export async function runUnifiedVoiceAgent(
  command: string,
  securityTaskId: string,
  modelId?: string,
  onToolCall?: (name: string, input: unknown) => void
): Promise<VoiceAgentResult> {
  const effectiveModelId = modelId || DEFAULT_MODEL_ID
  const gatewayModelId = mapModelId(effectiveModelId)

  console.log(`[UnifiedVoiceAgent] ══════════════════════════════════════════`)
  console.log(`[UnifiedVoiceAgent] Starting agent session (Gateway)`)
  console.log(`[UnifiedVoiceAgent]   Model: ${gatewayModelId}`)
  console.log(`[UnifiedVoiceAgent]   Is Free: ${isFreeModel(gatewayModelId)}`)
  console.log(`[UnifiedVoiceAgent]   Command: ${command.slice(0, 100)}...`)
  console.log(`[UnifiedVoiceAgent] ══════════════════════════════════════════`)

  const model = await getModelForAgent(effectiveModelId)

  await syncConnectedToolkits().catch((err) =>
    console.warn('[UnifiedVoiceAgent] Pre-run toolkit sync failed:', err)
  )
  const connectedToolkits = getConnectedToolkits()
  const tools = await createVoiceAgentTools(onToolCall || (() => {}), command, securityTaskId)

  const totalUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
  const recoveredGenerationIds = new Set<string>()
  let stepCount = 0
  const maxSteps = 20
  const recordUsageIfAny = (): void => {
    if (!hasTokenUsage(totalUsage)) return

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
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: command }]

  while (stepCount < maxSteps) {
    stepCount++
    console.log(`[UnifiedVoiceAgent] ── Step ${stepCount}/${maxSteps} ──`)

    try {
      const result = await generateText({
        model,
        system: getSystemPrompt(connectedToolkits),
        messages,
        tools
      })

      let stepUsage = extractGenerateResultUsage(result)
      if (!hasTokenUsage(stepUsage) && !isFreeModel(gatewayModelId)) {
        const generationIds = extractGenerationIdsFromResult(result).filter(
          (id) => !recoveredGenerationIds.has(id)
        )
        if (generationIds.length > 0) {
          generationIds.forEach((id) => recoveredGenerationIds.add(id))
          console.log(
            `[UnifiedVoiceAgent] Attempting Gateway usage recovery from generation IDs: ${generationIds.join(', ')}`
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
              console.warn(`[UnifiedVoiceAgent] Failed to fetch usage for generation ${id}:`, err)
              return null
            }
          })
          if (hasTokenUsage(recoveredUsage)) {
            stepUsage = recoveredUsage
            console.log(
              `[UnifiedVoiceAgent] Recovered usage from Gateway generations: ${stepUsage.inputTokens} in, ${stepUsage.outputTokens} out`
            )
          }
        }
      }
      if (!hasTokenUsage(stepUsage)) {
        stepUsage = estimateTokenUsageFromGenerateResult(result)
        if (hasTokenUsage(stepUsage)) {
          console.log(
            `[UnifiedVoiceAgent] Estimated usage fallback: ${stepUsage.inputTokens} in, ${stepUsage.outputTokens} out`
          )
        }
      }
      totalUsage.inputTokens += stepUsage.inputTokens
      totalUsage.outputTokens += stepUsage.outputTokens
      totalUsage.cachedTokens += stepUsage.cachedTokens

      const taskCompleteTool = result.toolCalls?.find((tc) => tc.toolName === 'task_complete')
      if (taskCompleteTool) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = (taskCompleteTool as any).args as { summary: string; success: boolean }

        recordUsageIfAny()

        return {
          summary: args?.summary || result.text || 'Task completed',
          steps: stepCount,
          success: args?.success ?? true,
          usage: totalUsage
        }
      }

      if (result.text && (!result.toolCalls || result.toolCalls.length === 0)) {
        recordUsageIfAny()

        return {
          summary: result.text,
          steps: stepCount,
          success: true,
          usage: totalUsage
        }
      }

      if (result.response?.messages) {
        messages.push(...result.response.messages)
      } else if (result.text) {
        messages.push({ role: 'assistant', content: result.text })
      }

      if (result.toolCalls && result.toolCalls.length > 0) {
        continue
      }

      messages.push({
        role: 'user',
        content: 'Continue with the task. Call task_complete when done.'
      })
    } catch (err) {
      console.error(`[UnifiedVoiceAgent] Error at step ${stepCount}:`, err)

      recordUsageIfAny()

      return {
        summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
        steps: stepCount,
        success: false,
        usage: totalUsage
      }
    }
  }

  recordUsageIfAny()

  return {
    summary: 'Max steps reached without completion',
    steps: stepCount,
    success: false,
    usage: totalUsage
  }
}
