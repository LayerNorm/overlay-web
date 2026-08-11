import { logger } from '@/server/observability/logger'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { generateText } from '@/server/ai/sdk'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { DEFAULT_CHAT_SUGGESTIONS } from '@/shared/chat/chat-suggestions-defaults'
import { getOverlaySession } from '@/server/auth/session'
import { getBillingProgrammaticSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { ChatSuggestionRepository } from '@/server/chat-suggestions/ChatSuggestionRepository'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import {
  billableBudgetCentsFromProviderUsd,
} from '@/server/billing/billing-runtime'
import { providerRequestFingerprint } from '@/server/billing/ServerProviderUsageMeter'

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizePrompt(prompt: string, firstName?: string): string | null {
  let next = prompt.trim()
  if (!next) return null

  next = next.replace(/^['"“”]+|['"“”]+$/g, '').trim()
  next = next.replace(/^(?:hey|hi|hello)\s+[^,!:;.-]*[,!:;.-]+\s*/i, '')

  const trimmedFirstName = firstName?.trim()
  if (trimmedFirstName) {
    const escaped = escapeRegExp(trimmedFirstName)
    next = next.replace(new RegExp(`^${escaped}\\b\\s*[,!:;.-]+\\s*`, 'i'), '')
  }

  next = next.replace(/\boverlay\b/gi, '').replace(/\s{2,}/g, ' ').trim()
  next = next.replace(/^[,!:;.-]+\s*/, '').trim()

  if (!next) return null
  if (/\boverlay\b/i.test(next)) return null
  if (trimmedFirstName && new RegExp(`\\b${escapeRegExp(trimmedFirstName)}\\b`, 'i').test(next)) {
    return null
  }

  return next
}

function normalizeFourPrompts(raw: string[], firstName?: string): string[] {
  const strings = raw
    .filter((p) => typeof p === 'string' && p.trim().length > 0)
    .map((p) => sanitizePrompt(p, firstName) ?? '')
    .filter((p) => p.length > 0)
  const out: string[] = [...strings.slice(0, 4)]
  for (const d of DEFAULT_CHAT_SUGGESTIONS) {
    if (out.length >= 4) break
    if (!out.includes(d)) out.push(d)
  }
  while (out.length < 4) {
    out.push(DEFAULT_CHAT_SUGGESTIONS[out.length % DEFAULT_CHAT_SUGGESTIONS.length]!)
  }
  return out.slice(0, 4)
}

const DEFAULT_PROMPTS_NORMALIZED = normalizeFourPrompts([...DEFAULT_CHAT_SUGGESTIONS])

async function generateStartersWithLLM(args: {
  accessToken: string
  day: string
  firstName: string
  programmaticSubjectId?: string
  userId: string
  workspaceId: string
}): Promise<string[] | null> {
  const server = getOverlayServerContext()
  const entitlements = await server.generationUsagePolicy.getEntitlements({
    programmaticSubjectId: args.programmaticSubjectId,
    userId: args.userId,
    workspaceId: args.workspaceId,
  })
  if (!entitlements) return null
  const authorized = await resolveAuthorizedModelIds({ entitlements })
  if (!authorized.chat.has(FREE_TIER_AUTO_MODEL_ID)) return null
  const model = await getLanguageModel(FREE_TIER_AUTO_MODEL_ID, args.accessToken)
  const prompt = `Generate exactly 4 conversation starter prompts for an AI chat app. Each prompt:
- One clear sentence, 8–22 words
- Specific, actionable, and phrased as a task the assistant can help complete
- Cover a mix: coding/tools, research/learning, writing/communication, and a practical work or life task
- No two prompts on the same narrow topic
- Do not address the user directly by name
- Do not mention the app, assistant, or brand name "Overlay"
- Prefer concrete verbs like draft, plan, summarize, analyze, organize, compare, or create

Reply with ONLY valid JSON (no markdown fences) in this exact shape:
{"prompts":["...","...","...","..."]}`
  const estimatedInputTokens = Math.ceil(prompt.length / 4) + 32
  const maxOutputTokens = 700
  const estimatedProviderCostUsd = await calculateLanguageModelTokenCostOrNull(
    FREE_TIER_AUTO_MODEL_ID,
    estimatedInputTokens,
    0,
    maxOutputTokens,
  )
  if (estimatedProviderCostUsd === null) return null
  const operationId = `chat.suggestions:${args.day}`
  const requestFingerprint = providerRequestFingerprint({
    day: args.day,
    operationId: 'chat.suggestions',
    userId: args.userId,
  })
  const reservation = await server.generationUsagePolicy.reserve({
    entitlements,
    idempotencyKey: operationId,
    kind: 'generation',
    modelId: FREE_TIER_AUTO_MODEL_ID,
    operationId: 'chat.suggestions',
    providerCostUsd: estimatedProviderCostUsd,
    requestFingerprint,
    programmaticSubjectId: args.programmaticSubjectId,
    userId: args.userId,
    workspaceId: args.workspaceId,
  })
  if (!reservation.ok) return null

  let providerWorkStarted = false
  let result: Awaited<ReturnType<typeof generateText>>
  try {
    await server.generationUsagePolicy.markStarted({
      reservationId: reservation.reservationId,
      userId: args.userId,
    })
    providerWorkStarted = true
    result = await generateText({
      model,
      temperature: 0.88,
      maxOutputTokens,
      prompt,
    })
  } catch (error) {
    await server.generationUsagePolicy.release({
      providerWorkStarted,
      reason: error instanceof Error ? error.message : 'chat_suggestions_provider_failed',
      reservationId: reservation.reservationId,
      userId: args.userId,
    }).catch((_releaseError) => undefined)
    throw error
  }

  const usage = (result as unknown as {
    usage?: { inputTokens?: number; outputTokens?: number }
  }).usage
  const inputTokens = usage?.inputTokens ?? estimatedInputTokens
  const outputTokens = usage?.outputTokens ?? maxOutputTokens
  const actualProviderCostUsd = await calculateLanguageModelTokenCostOrNull(
    FREE_TIER_AUTO_MODEL_ID,
    inputTokens,
    0,
    outputTokens,
  )
  if (actualProviderCostUsd === null) {
    await server.generationUsagePolicy.markForReconcile({
      errorMessage: `pricing_missing:${FREE_TIER_AUTO_MODEL_ID}`,
      reservationId: reservation.reservationId,
      userId: args.userId,
    }).catch((_reconcileError) => undefined)
    return null
  }
  const costCents = billableBudgetCentsFromProviderUsd(actualProviderCostUsd)
  if (reservation.reservationId) {
    try {
      await server.generationUsagePolicy.finalize({
        actualProviderCostUsd,
        events: [{
          type: 'generation',
          modelId: FREE_TIER_AUTO_MODEL_ID,
          inputTokens,
          outputTokens,
          cachedTokens: 0,
          cost: costCents,
          timestamp: Date.now(),
        }],
        reservationId: reservation.reservationId,
        userId: args.userId,
      })
    } catch (error) {
      await server.generationUsagePolicy.markForReconcile({
        errorMessage: error instanceof Error ? error.message : 'chat_suggestions_finalize_failed',
        reservationId: reservation.reservationId,
        userId: args.userId,
      }).catch((_reconcileError) => undefined)
      throw error
    }
  } else {
    await server.appData.repositories.usage.recordBatch({
      events: [{
        cachedTokens: 0,
        costCents,
        inputTokens,
        kind: 'generation',
        modelId: FREE_TIER_AUTO_MODEL_ID,
        occurredAt: Date.now(),
        outputTokens,
        providerCostUsd: actualProviderCostUsd,
      }],
      operationId,
      userId: args.userId,
    })
  }

  const raw = result.text.trim()
  const jsonStr = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const parsed = JSON.parse(jsonStr) as { prompts?: unknown }
  const promptsUnknown = parsed.prompts
  if (!Array.isArray(promptsUnknown)) return null
  const strings = promptsUnknown
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => sanitizePrompt(p, args.firstName) ?? '')
    .filter((p) => p.length > 0)
  return normalizeFourPrompts(strings, args.firstName)
}

type PersistArgs = {
  repository: ChatSuggestionRepository
  userId: string
  prompts: string[]
  day: string
}

async function persistStarters({ repository, userId, prompts, day }: PersistArgs): Promise<boolean> {
  try {
    return await repository.setForUser({ day, prompts, userId })
  } catch (err) {
    logger.error('[chat-suggestions] failed to persist starters', err)
    return false
  }
}

/**
 * Daily refresh after UTC midnight: regenerate (or roll defaults if no first name).
 * Runs after the response is sent (stale-while-revalidate).
 */
function scheduleRefreshForNewDay(args: {
  repository: ChatSuggestionRepository
  userId: string
  accessToken: string
  firstName: string
  programmaticSubjectId?: string
  today: string
  workspaceId: string
}) {
  const { repository, userId, accessToken, firstName, programmaticSubjectId, today, workspaceId } = args
  after(async () => {
    try {
      const trimmed = firstName.trim()
      if (!trimmed) {
        await persistStarters({
          repository,
          userId,
          prompts: DEFAULT_PROMPTS_NORMALIZED,
          day: today,
        })
        return
      }
      const generated = await generateStartersWithLLM({
        accessToken,
        day: today,
        firstName: trimmed,
        programmaticSubjectId,
        userId,
        workspaceId,
      })
      if (generated && generated.length === 4) {
        await persistStarters({ repository, userId, prompts: generated, day: today })
      }
    } catch (err) {
      logger.warn('[chat-suggestions] background refresh failed', err)
    }
  })
}

export async function GET(request: Request, context: AppApiRouteContext) {
  try {
    const session = await getOverlaySession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = context.auth.userId
    const workspaceId = context.workspace.workspace.id
    const programmaticSubjectId = getBillingProgrammaticSubjectId(context)

    const repository = getOverlayServerContext().appData.repositories.chatSuggestions
    const today = utcDateKey()
    const firstName = session.user.id === userId ? session.user.firstName?.trim() ?? '' : ''

    const cached = await repository.getByUserId(userId)

    if (cached && cached.day === today && cached.prompts.length === 4) {
      return NextResponse.json({ prompts: normalizeFourPrompts(cached.prompts, firstName), stale: false })
    }

    // Yesterday's (or older) starters: return immediately, refresh for the new UTC day in the background
    if (cached && cached.prompts.length === 4 && cached.day !== today) {
      const prompts = normalizeFourPrompts(cached.prompts, firstName)
      scheduleRefreshForNewDay({
        repository,
        userId,
        accessToken: context.auth.accessToken || session.accessToken,
        firstName,
        programmaticSubjectId,
        today,
        workspaceId,
      })
      return NextResponse.json({ prompts, stale: true })
    }

    // No personalization signal: skip LLM, persist defaults for today so loads stay cheap
    if (!firstName) {
      const prompts = DEFAULT_PROMPTS_NORMALIZED
      await persistStarters({ repository, userId, prompts, day: today })
      return NextResponse.json({ prompts, stale: false })
    }

    let generated: string[] | null = null
    try {
      generated = await generateStartersWithLLM({
        accessToken: context.auth.accessToken || session.accessToken,
        day: today,
        firstName,
        programmaticSubjectId,
        userId,
        workspaceId,
      })
    } catch (err) {
      logger.warn('[chat-suggestions] generation failed', err)
    }

    if (generated && generated.length === 4) {
      await persistStarters({ repository, userId, prompts: generated, day: today })
      return NextResponse.json({ prompts: generated, stale: false })
    }

    if (cached && cached.prompts.length === 4) {
      return NextResponse.json({ prompts: normalizeFourPrompts(cached.prompts, firstName), stale: false })
    }

    return NextResponse.json({ prompts: [...DEFAULT_CHAT_SUGGESTIONS], stale: false })
  } catch (err) {
    logger.error('[chat-suggestions]', err)
    return NextResponse.json({ prompts: [...DEFAULT_CHAT_SUGGESTIONS], stale: false })
  }
}
