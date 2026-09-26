'use node'

/**
 * M2 compiled memory profile: a stable, model-synthesized "who is this owner"
 * block regenerated from the curated memory rows. Consumers inject the profile
 * instead of a raw top-N memory list, so durable identity/preferences/projects
 * stay present even when per-turn retrieval misses them.
 *
 * Triggered post-extraction via `compileInternal` (self-throttling — a burst of
 * turns compiles once) and read by the app through `memoryProfileStore.getProfile`.
 */
import { createHash } from 'node:crypto'
import { generateObject, type FlexibleSchema } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { internalAction } from '../_generated/server'
import { v } from 'convex/values'
import { api, internal } from '../_generated/api'
import { calculateGatewayLanguageModelCostOrNull } from '../lib/gatewayCatalogPricing'
import { isGatewayCreditLow } from '../lib/gatewayCredits'
import { applyMarkupToDollars } from '../../src/shared/billing/billing-pricing'
import { normalizeOpenAiCompatibleBaseUrl } from '../../src/shared/ai/gateway/openai-compatible-base-url'

// Keep in sync with memoryProfileStore.PROFILE_MEMORY_LIMIT — a node-runtime
// action cannot import the default-runtime store module (its query/mutation
// definitions would be bundled into the node graph).
const PROFILE_MEMORY_LIMIT = 200
const MAX_PROFILE_CHARS = 1800

const profileSchema = z.object({
  profile: z.string().describe('The compiled owner profile, under 1800 characters.'),
})

const PROFILE_SYSTEM_PROMPT = `You maintain the durable profile for one memory owner (a user or an agent).

Given that owner's stored memories, write a compact profile under 1800 characters that stays accurate as facts change.

Include, when the memories support them:
- Identity: names, roles, locations, languages.
- Stable preferences: formats, tone, tools, working style.
- Active projects and goals: what they are doing now and why.
- People and relationships that recur (name + role, e.g. "Gina — sister").
- Constraints: commitments, deadlines, things they avoid.

Rules:
- Prefer newer memories over older ones when they conflict; superseded memories are already excluded.
- Keep concrete dates when they matter (birthdays, deadlines, trips).
- Do not include one-off events that carry no lasting signal.
- Plain prose or short labeled lines — no headers, no markdown bullets with more than one level.
- If the memories are thin, say what little is known rather than padding.`

function getCompilerModel(modelId: string) {
  const gateway = createOpenAICompatible({
    name: 'gateway',
    apiKey: process.env.AI_GATEWAY_API_KEY ?? '',
    baseURL: normalizeOpenAiCompatibleBaseUrl(process.env.AI_GATEWAY_URL),
  })
  return gateway(modelId)
}

function getServerSecretForBackground(): string | null {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  return secret ? secret : null
}

/**
 * Compiles the owner's profile from their live memories. Self-throttling:
 * a profile generated within the store's throttle window is reused unless `force`.
 */
type CompileResult =
  | { compiled: true; sourceMemoryCount: number }
  | { compiled: false; reason: string }

export const compileInternal = internalAction({
  args: {
    ownerId: v.string(),
    workspaceId: v.optional(v.string()),
    billingActorUserId: v.optional(v.string()),
    isPaid: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CompileResult> => {
    const stale = await ctx.runQuery(internal.knowledge.memoryProfileStore.profileStale, {
      ownerId: args.ownerId,
      workspaceId: args.workspaceId,
    })
    if (!stale && args.force !== true) return { compiled: false, reason: 'fresh' }

    const memories = await ctx.runQuery(internal.knowledge.memoryProfileStore.listForProfile, {
      ownerId: args.ownerId,
      workspaceId: args.workspaceId,
      limit: PROFILE_MEMORY_LIMIT,
    })
    if (memories.length === 0) return { compiled: false, reason: 'empty' }

    const configuredModelId = process.env.OVERLAY_MEMORY_EXTRACTION_MODEL_ID?.trim()
    const lowCredit =
      !configuredModelId &&
      (args.isPaid ?? false) &&
      (await isGatewayCreditLow(
        process.env.AI_GATEWAY_API_KEY,
        normalizeOpenAiCompatibleBaseUrl(process.env.AI_GATEWAY_URL),
      ))
    const modelId =
      configuredModelId ||
      ((args.isPaid ?? false) && !lowCredit ? 'google/gemini-2.5-flash-lite' : 'openrouter/free')
    const serverSecret = getServerSecretForBackground()
    const billingUserId = args.billingActorUserId?.trim() || args.ownerId

    const memoryLines = memories
      .map((m) => {
        const when = m.eventAt ?? m.updatedAt ?? m.createdAt
        const date = new Date(when).toISOString().slice(0, 10)
        return `- [${date}]${m.type ? ` (${m.type})` : ''} ${m.content}`
      })
      .join('\n')
    const prompt = `Memories (newest first):\n${memoryLines}`

    const estimatedInputTokens = Math.ceil((PROFILE_SYSTEM_PROMPT.length + prompt.length) / 4)
    const estimatedCostUsd = await calculateGatewayLanguageModelCostOrNull(ctx, modelId, estimatedInputTokens, 0, 800)
    if (estimatedCostUsd === null) return { compiled: false, reason: 'pricing_missing' }

    const requestFingerprint = createHash('sha256')
      .update(`profile:${args.ownerId}:${args.workspaceId ?? ''}:${memoryLines.length}:${memories[0]?.updatedAt ?? 0}`)
      .digest('hex')
    const reservationId = estimatedCostUsd > 0
      ? `mprof_${createHash('sha256').update(`${billingUserId}:${requestFingerprint}`).digest('hex').slice(0, 40)}`
      : null

    if (reservationId && serverSecret) {
      try {
        const reservation = await ctx.runMutation(api.platform.usage.reserveBudgetByServer, {
          serverSecret,
          userId: billingUserId,
          reservationId,
          kind: 'generation',
          modelId,
          operationId: 'knowledge.compile-memory-profile',
          requestFingerprint,
          reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
        })
        if (reservation.idempotent || reservation.status !== 'reserved') {
          return { compiled: false, reason: 'already_processed' }
        }
      } catch {
        return { compiled: false, reason: 'background_budget_exhausted' }
      }
    }

    let result: { object: { profile: string }; usage?: { inputTokens?: number; outputTokens?: number } }
    try {
      if (reservationId && serverSecret) {
        await ctx.runMutation(api.platform.usage.markBudgetReservationStartedByServer, {
          serverSecret,
          userId: billingUserId,
          reservationId,
        })
      }
      result = (await generateObject({
        model: getCompilerModel(modelId),
        schema: profileSchema as FlexibleSchema<unknown>,
        instructions: PROFILE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        maxOutputTokens: 800,
      })) as typeof result
    } catch (err) {
      if (reservationId && serverSecret) {
        await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
          serverSecret,
          userId: billingUserId,
          reservationId,
          errorMessage: err instanceof Error ? err.message : 'profile_compile_failed',
        }).catch(() => {})
      }
      return { compiled: false, reason: 'error' }
    }

    if (reservationId && serverSecret) {
      const usage = result.usage
      const inputTokens = usage?.inputTokens ?? estimatedInputTokens
      const outputTokens = usage?.outputTokens ?? 800
      const actualCostUsd = await calculateGatewayLanguageModelCostOrNull(ctx, modelId, inputTokens, 0, outputTokens)
      if (actualCostUsd === null) {
        await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
          serverSecret,
          userId: billingUserId,
          reservationId,
          errorMessage: `pricing_missing:${modelId}`,
        }).catch(() => {})
      } else {
        const costCents = applyMarkupToDollars({ providerCostUsd: actualCostUsd })
        await ctx.runMutation(api.platform.usage.finalizeBudgetReservationByServer, {
          serverSecret,
          userId: billingUserId,
          reservationId,
          actualCents: costCents,
          events: [{
            type: 'generation',
            modelId,
            inputTokens,
            outputTokens,
            cachedTokens: 0,
            providerCostUsd: actualCostUsd,
            cost: costCents,
            timestamp: Date.now(),
          }],
        }).catch(() => {})
      }
    }

    const content = result.object.profile.trim().slice(0, MAX_PROFILE_CHARS)
    if (!content) return { compiled: false, reason: 'empty' }
    await ctx.runMutation(internal.knowledge.memoryProfileStore.upsertProfile, {
      ownerId: args.ownerId,
      workspaceId: args.workspaceId,
      content,
      sourceMemoryCount: memories.length,
      modelId,
    })
    return { compiled: true, sourceMemoryCount: memories.length }
  },
})
