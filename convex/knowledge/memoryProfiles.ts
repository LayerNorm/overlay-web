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
import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { internalAction } from '../_generated/server'
import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { calculateGatewayLanguageModelCostOrNull } from '../lib/gatewayCatalogPricing'
import { applyMarkupToDollars } from '../lib/usageMarkup'
import { chargeProviderUsageDirect, checkProviderBudget } from '../lib/providerBudgetCharge'
import { normalizeOpenAiCompatibleBaseUrl } from '../../src/shared/ai/gateway/openai-compatible-base-url'

// Keep in sync with memoryProfileStore.PROFILE_MEMORY_LIMIT — a node-runtime
// action cannot import the default-runtime store module (its query/mutation
// definitions would be bundled into the node graph).
const PROFILE_MEMORY_LIMIT = 200
const MAX_PROFILE_CHARS = 1800

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
- If the memories are thin, say what little is known rather than padding.
- Reply with the profile text only: no preamble, no JSON, no code fences.`

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
    /** Pays from the workspace's paid account, charged after the call. */
    billingActorUserId: v.optional(v.string()),
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
    const modelId = configuredModelId || 'google/gemini-2.5-flash-lite'
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

    // Before the call: the 2% workspace check (nothing is held). After it: a direct charge of the actual cost.
    if (!serverSecret) return { compiled: false, reason: 'background_budget_exhausted' }
    const requestFingerprint = createHash('sha256')
      .update(`profile:${args.ownerId}:${args.workspaceId ?? ''}:${memoryLines.length}:${memories[0]?.updatedAt ?? 0}`)
      .digest('hex')
    const operationId = `mprof_${createHash('sha256').update(`${billingUserId}:${requestFingerprint}`).digest('hex').slice(0, 40)}`
    const budget = await checkProviderBudget(ctx, { userId: billingUserId, workspaceId: args.workspaceId, operationId })
    if (budget.alreadyCharged) return { compiled: false, reason: 'already_processed' }
    if (!budget.allowed) return { compiled: false, reason: 'background_budget_exhausted' }

    // Plain text, not a structured object: the profile is one string, and asking for JSON made some models fail the
    // schema check on every run (and the stale profile retried every turn).
    let result: { text: string; usage?: { inputTokens?: number; outputTokens?: number } }
    try {
      result = await generateText({
        model: getCompilerModel(modelId),
        system: PROFILE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        maxOutputTokens: 800,
      })
    } catch (_err) {
      return { compiled: false, reason: 'error' }
    }

    const inputTokens = result.usage?.inputTokens ?? 0
    const outputTokens = result.usage?.outputTokens ?? 0
    const providerCostUsd = await calculateGatewayLanguageModelCostOrNull(ctx, modelId, inputTokens, 0, outputTokens)
    if (providerCostUsd === null) {
      console.error('[memoryProfiles] missing pricing; nothing was charged', modelId)
    } else {
      await chargeProviderUsageDirect(ctx, {
        serverSecret,
        userId: billingUserId,
        workspaceId: args.workspaceId,
        operationId,
        costCents: applyMarkupToDollars({ providerCostUsd }),
        event: { type: 'generation', modelId, inputTokens, outputTokens, providerCostUsd },
      }).catch((err) => console.error('[memoryProfiles] charge failed', err))
    }

    const content = stripFences(result.text).slice(0, MAX_PROFILE_CHARS)
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

/** Some models still wrap a plain reply in a code fence; keep only the text. */
function stripFences(text: string): string {
  return text.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```$/, '').trim()
}
