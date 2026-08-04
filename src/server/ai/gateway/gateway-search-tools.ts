import 'server-only'

import { logger } from '@/server/observability/logger'
import { createGateway, generateText, isStepCount, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
  getOrCreateGateway,
  resolveGatewayApiKey,
  resolveGatewayProviderToolProxyModelId,
} from './gateway-runtime'
import type { Entitlements } from '@/shared/app/app-contracts'
import { getOverlayServerContext } from '@/server/bootstrap'
import { calculateLanguageModelTokenCostOrNull } from './live-model-pricing'
import { providerRequestFingerprint } from '@/server/billing/ServerProviderUsageMeter'
import { billableBudgetCentsFromProviderUsd } from '@/server/billing/billing-runtime'

const GATEWAY_SEARCH_REQUEST_USD = 0.005
const GATEWAY_SEARCH_MAX_PROVIDER_COST_USD = 0.05

export type GatewaySearchBillingContext = {
  entitlements: Entitlements
  requestFingerprint: string
  userId: string
}

const PERPLEXITY_DEFAULTS = {
  maxResults: 10,
  maxTokens: 50_000,
  maxTokensPerPage: 2048,
}

const PARALLEL_DEFAULTS = {
  mode: 'one-shot' as const,
  maxResults: 10,
  excerpts: { maxCharsPerResult: 5000, maxCharsTotal: 80_000 },
}

const INNER_TOOL_ATTEMPTS = 3

function isGatewayErrorOutput(out: unknown): out is { error: string; message?: string } {
  return (
    typeof out === 'object' &&
    out != null &&
    'error' in out &&
    typeof (out as { error: unknown }).error === 'string'
  )
}

type SearchResultRecord = Record<string, unknown>

export type ExactEntityFallbackPlan = {
  label: string
  identityTerms: string[]
  objective: string
  searchQueries: string[]
}

const ENTITY_HONORIFICS = new Set([
  'dr',
  'doctor',
  'prof',
  'professor',
  'mr',
  'mrs',
  'ms',
  'sir',
])

const ENTITY_QUERY_STOP_WORDS = new Set([
  ...ENTITY_HONORIFICS,
  'about',
  'find',
  'information',
  'is',
  'look',
  'on',
  'search',
  'tell',
  'the',
  'up',
  'who',
])

export function buildExactEntityFallbackPlan(
  query: string | string[],
  country?: string,
): ExactEntityFallbackPlan | null {
  const candidates = Array.isArray(query) ? query : [query]
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const hasEntityPrefix = /^(?:who\s+is|who's|tell\s+me\s+about|look\s+up|find\s+(?:information\s+)?(?:about|on)|search\s+for)\b/i.test(trimmed)
    const hasHonorific = /^(?:dr|doctor|prof|professor|mr|mrs|ms|sir)\.?\s+/i.test(trimmed)
    const isQuoted = /^["“][^"”]+["”]$/.test(trimmed)
    if (!hasEntityPrefix && !hasHonorific && !isQuoted) continue

    const label = trimmed
      .replace(/^(?:who\s+is|who's|tell\s+me\s+about|look\s+up|find\s+(?:information\s+)?(?:about|on)|search\s+for)\s+/i, '')
      .replace(/^["“]|["”]$/g, '')
      .replace(/[?.!,;:]+$/g, '')
      .trim()
    const identityTerms = normalizedSearchTerms(label)
      .filter((term) => !ENTITY_QUERY_STOP_WORDS.has(term))
    if (identityTerms.length < 2 || identityTerms.length > 6) continue

    const countryHint = country ? ` Prefer sources relevant to country code ${country}.` : ''
    return {
      label,
      identityTerms,
      objective:
        `Identify the exact person or entity named "${label}" and return authoritative profile details. ` +
        `Exclude results that only share part of the name.${countryHint}`,
      searchQueries: [`"${label}"`, label],
    }
  }
  return null
}

export function hasExactEntityMatch(
  output: unknown,
  identityTerms: string[],
): boolean {
  return searchResults(output).some((result) =>
    resultMatchesIdentity(result, identityTerms),
  )
}

export function filterExactEntityResults(
  output: unknown,
  plan: ExactEntityFallbackPlan,
): unknown {
  if (!isRecord(output)) return output
  const seenUrls = new Set<string>()
  const results = searchResults(output)
    .filter((result) => resultMatchesIdentity(result, plan.identityTerms))
    .filter((result) => {
      const url = typeof result.url === 'string' ? result.url : ''
      if (!url || seenUrls.has(url)) return false
      seenUrls.add(url)
      return true
    })
  if (results.length === 0) return output

  return {
    ...output,
    results,
    search_strategy: 'exact_entity_filter',
    search_note:
      `Results were limited to exact title or URL matches for "${plan.label}". ` +
      'Treat the first detailed profile as the primary identity. Do not infer separate people solely from conflicting specialties in sparse directories unless distinct identifiers support that conclusion.',
  }
}

export function mergeExactEntityFallbackResults(
  primaryOutput: unknown,
  fallbackOutput: unknown,
  plan: ExactEntityFallbackPlan,
): unknown {
  if (!isRecord(primaryOutput) || !isRecord(fallbackOutput)) return primaryOutput
  const exactResults = [
    ...searchResults(fallbackOutput)
      .filter((result) => resultMatchesIdentity(result, plan.identityTerms))
      .map(normalizeFallbackResult),
    ...searchResults(primaryOutput)
      .filter((result) => resultMatchesIdentity(result, plan.identityTerms)),
  ]
  if (exactResults.length === 0) return primaryOutput

  const seenUrls = new Set<string>()
  const results = exactResults.filter((result) => {
    const url = typeof result.url === 'string' ? result.url : ''
    if (!url || seenUrls.has(url)) return false
    seenUrls.add(url)
    return true
  })

  return {
    ...primaryOutput,
    results,
    search_strategy: 'exact_entity_deep_augmentation',
    search_note:
      `Exact matches for "${plan.label}" were enriched with deeper exact-entity search results. ` +
      'Treat the first detailed profile as the primary identity. Do not infer separate people solely from conflicting specialties in sparse directories unless distinct identifiers support that conclusion.',
  }
}

export type GatewayPerplexitySearchParams = {
  query: string | string[]
  maxResults?: number
  maxTokensPerPage?: number
  maxTokens?: number
  country?: string
  searchDomainFilter?: string[]
  searchLanguageFilter?: string[]
  searchAfterDate?: string
  searchBeforeDate?: string
  lastUpdatedAfterFilter?: string
  lastUpdatedBeforeFilter?: string
  searchRecencyFilter?: 'day' | 'week' | 'month' | 'year'
}

export function buildPerplexityProviderPayload(
  p: GatewayPerplexitySearchParams,
): Record<string, unknown> {
  const hasDateRange = Boolean(
    p.searchAfterDate ||
      p.searchBeforeDate ||
      p.lastUpdatedAfterFilter ||
      p.lastUpdatedBeforeFilter,
  )
  const out: Record<string, unknown> = {
    query: p.query,
    max_results: p.maxResults ?? PERPLEXITY_DEFAULTS.maxResults,
    max_tokens_per_page: p.maxTokensPerPage ?? PERPLEXITY_DEFAULTS.maxTokensPerPage,
    max_tokens: p.maxTokens ?? PERPLEXITY_DEFAULTS.maxTokens,
  }
  assignOptional(out, 'country', p.country)
  assignOptionalArray(out, 'search_domain_filter', p.searchDomainFilter)
  assignOptionalArray(out, 'search_language_filter', p.searchLanguageFilter)
  assignOptional(out, 'search_after_date', p.searchAfterDate)
  assignOptional(out, 'search_before_date', p.searchBeforeDate)
  assignOptional(out, 'last_updated_after_filter', p.lastUpdatedAfterFilter)
  assignOptional(out, 'last_updated_before_filter', p.lastUpdatedBeforeFilter)
  if (!hasDateRange && p.searchRecencyFilter) {
    out.search_recency_filter = p.searchRecencyFilter
  }
  return out
}

export async function runPerplexitySearchDirectForRepair(
  accessToken: string | undefined,
  query: string | string[],
  options?: Partial<Omit<GatewayPerplexitySearchParams, 'query'>>,
  innerProxyModelId: string = resolveGatewayProviderToolProxyModelId(),
  billingContext?: GatewaySearchBillingContext,
): Promise<unknown> {
  return executeGatewayPerplexitySearch(accessToken, { query, ...options }, innerProxyModelId, billingContext)
}

async function runInnerGenerateTextWithTool<T extends 'perplexity_search' | 'parallel_search'>(params: {
  toolName: T
  tool: NonNullable<ToolSet[string]>
  prompt: string
  gw: ReturnType<typeof createGateway>
  innerProxyModelId: string
  maxAttempts: number
}): Promise<{
  attempts: number
  modelId: string
  result: Awaited<ReturnType<typeof generateText>>
}> {
  const { toolName, tool: providerTool, prompt, gw, innerProxyModelId, maxAttempts } = params
  let last: Awaited<ReturnType<typeof generateText>> | undefined
  let lastError: unknown
  let attempts = 0

  for (const modelId of toolProxyModelAttempts(innerProxyModelId)) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.info(`[AI Gateway] ${toolName} inner generateText start (attempt ${attempt}/${maxAttempts})`, {
        innerProxyModelId: modelId,
      })
      try {
        attempts += 1
        last = await generateText({
          model: gw(modelId),
          tools: { [toolName]: providerTool },
          toolChoice: { type: 'tool', toolName },
          prompt,
          stopWhen: isStepCount(2),
        })
      } catch (error) {
        lastError = error
        logger.warn(`[AI Gateway] ${toolName} inner generateText failed`, {
          innerProxyModelId: modelId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        })
        break
      }
      if (hasToolResult(last, toolName)) return { attempts, modelId, result: last }
      logger.warn(`[AI Gateway] ${toolName} missing tool result, retrying`, {
        attempt,
        finishReason: last.finishReason,
        stepCount: last.steps?.length,
      })
    }
    logToolProxyFallback(modelId, toolName)
  }
  if (last) {
    return {
      attempts,
      modelId: last.steps.at(-1)?.response.modelId ?? innerProxyModelId,
      result: last,
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'AI Gateway tool model failed'))
}

async function reserveGatewaySearch(params: {
  billingContext: GatewaySearchBillingContext | undefined
  input: unknown
  innerProxyModelId: string
  toolName: 'perplexity_search' | 'parallel_search'
}) {
  if (!params.billingContext) throw new Error('gateway_search_billing_context_required')
  const policy = getOverlayServerContext().generationUsagePolicy
  const operationId = `gateway.${params.toolName}:${globalThis.crypto.randomUUID()}`
  const reservation = await policy.reserve({
    entitlements: params.billingContext.entitlements,
    idempotencyKey: operationId,
    kind: 'generation',
    modelId: `gateway-tool/${params.toolName}`,
    operationId,
    providerCostUsd: GATEWAY_SEARCH_MAX_PROVIDER_COST_USD,
    requestFingerprint: providerRequestFingerprint({
      parent: params.billingContext.requestFingerprint,
      input: params.input,
      proxyModel: params.innerProxyModelId,
    }),
    userId: params.billingContext.userId,
  })
  if (!reservation.ok) throw new Error(reservation.code)
  await policy.markStarted({
    reservationId: reservation.reservationId,
    userId: params.billingContext.userId,
  })
  return { policy, reservationId: reservation.reservationId }
}

async function finalizeGatewaySearch(params: {
  attempts: number
  billingContext: GatewaySearchBillingContext
  meter: Awaited<ReturnType<typeof reserveGatewaySearch>>
  modelId: string
  result: Awaited<ReturnType<typeof generateText>>
  toolName: 'perplexity_search' | 'parallel_search'
}) {
  const usage = params.result.usage
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const cachedTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0
  const modelCostUsd = await calculateLanguageModelTokenCostOrNull(
    params.modelId,
    inputTokens,
    cachedTokens,
    outputTokens,
  )
  if (modelCostUsd === null) {
    await params.meter.policy.markForReconcile({
      errorMessage: `pricing_missing:${params.modelId}`,
      reservationId: params.meter.reservationId,
      userId: params.billingContext.userId,
    })
    throw new Error(`pricing_missing:${params.modelId}`)
  }
  const actualProviderCostUsd =
    Math.max(1, params.attempts) * GATEWAY_SEARCH_REQUEST_USD + modelCostUsd
  await params.meter.policy.finalize({
    actualProviderCostUsd,
    events: [{
      type: 'generation',
      modelId: `gateway-tool/${params.toolName}`,
      inputTokens,
      outputTokens,
      cachedTokens,
      cost: billableBudgetCentsFromProviderUsd(actualProviderCostUsd),
      timestamp: Date.now(),
    }],
    reservationId: params.meter.reservationId,
    userId: params.billingContext.userId,
  })
}

function extractProviderToolOutput(
  result: Awaited<ReturnType<typeof generateText>>,
  toolName: 'perplexity_search' | 'parallel_search',
  errorLabel: string,
): unknown {
  for (const step of result.steps) {
    for (const tr of step.toolResults) {
      if (tr.toolName !== toolName || tr.type !== 'tool-result') continue
      if (isGatewayErrorOutput(tr.output)) {
        throw new Error(tr.output.message || tr.output.error || `${errorLabel} returned an error`)
      }
      return tr.output
    }
    const errorPart = step.content.find((part) => part.type === 'tool-error' && part.toolName === toolName)
    if (errorPart?.type === 'tool-error') {
      throw new Error(errorPart.error instanceof Error ? errorPart.error.message : String(errorPart.error))
    }
  }
  return undefined
}

export async function executeGatewayPerplexitySearch(
  accessToken: string | undefined,
  params: GatewayPerplexitySearchParams,
  innerProxyModelId: string = resolveGatewayProviderToolProxyModelId(),
  billingContext?: GatewaySearchBillingContext,
): Promise<unknown> {
  const apiKey = await resolveGatewayApiKey(accessToken)
  if (!apiKey) {
    throw new Error('AI Gateway API key is not configured (needed for web search)')
  }
  const gw = createGateway({ apiKey })
  const perplexityTool = gw.tools.perplexitySearch({
    maxResults: PERPLEXITY_DEFAULTS.maxResults,
    maxTokens: PERPLEXITY_DEFAULTS.maxTokens,
    maxTokensPerPage: PERPLEXITY_DEFAULTS.maxTokensPerPage,
  })
  const prompt = `Call perplexity_search exactly once with this JSON input and no other tools:\n${JSON.stringify(buildPerplexityProviderPayload(params))}`

  const meter = await reserveGatewaySearch({
    billingContext,
    innerProxyModelId,
    input: params,
    toolName: 'perplexity_search',
  })
  let meteredResult: Awaited<ReturnType<typeof runInnerGenerateTextWithTool>>
  try {
    meteredResult = await runInnerGenerateTextWithTool({
      toolName: 'perplexity_search',
      tool: perplexityTool,
      prompt,
      gw,
      innerProxyModelId,
      maxAttempts: INNER_TOOL_ATTEMPTS,
    })
    await finalizeGatewaySearch({
      ...meteredResult,
      billingContext: billingContext!,
      meter,
      toolName: 'perplexity_search',
    })
  } catch (error) {
    await meter.policy.markForReconcile({
      errorMessage: error instanceof Error ? error.message : 'gateway_search_failed',
      reservationId: meter.reservationId,
      userId: billingContext!.userId,
    }).catch((_error) => undefined)
    throw error
  }
  const result = meteredResult.result
  const extracted = extractProviderToolOutput(result, 'perplexity_search', 'Perplexity search')
  if (extracted !== undefined) {
    logger.info('[AI Gateway] perplexity_search inner generateText OK')
    const fallbackPlan = buildExactEntityFallbackPlan(params.query, params.country)
    if (fallbackPlan) {
      const filtered = filterExactEntityResults(extracted, fallbackPlan)
      logger.info('[AI Gateway] perplexity_search augmenting exact entity with parallel_search', {
        entity: fallbackPlan.label,
      })
      try {
        const fallbackOutput = await executeGatewayParallelSearch(accessToken, {
          objective: fallbackPlan.objective,
          searchQueries: fallbackPlan.searchQueries,
          mode: 'one-shot',
          maxResults: params.maxResults ?? PARALLEL_DEFAULTS.maxResults,
          maxCharsPerResult: PARALLEL_DEFAULTS.excerpts.maxCharsPerResult,
          maxCharsTotal: PARALLEL_DEFAULTS.excerpts.maxCharsTotal,
        }, innerProxyModelId, billingContext)
        const repaired = mergeExactEntityFallbackResults(extracted, fallbackOutput, fallbackPlan)
        if (repaired !== extracted) {
          logger.info('[AI Gateway] perplexity_search exact entity enriched with parallel_search', {
            entity: fallbackPlan.label,
          })
          return repaired
        }
      } catch (error) {
        logger.warn('[AI Gateway] perplexity_search exact entity fallback failed', {
          entity: fallbackPlan.label,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      if (filtered !== extracted) return filtered
    }
    return extracted
  }

  logger.error('[AI Gateway] perplexity_search inner generateText missing tool result', {
    finishReason: result.finishReason,
    steps: result.steps.length,
  })
  throw new Error('Web search did not return results — check AI Gateway / Perplexity billing and logs')
}

export type GatewayParallelSearchParams = {
  objective: string
  searchQueries?: string[]
  mode?: 'one-shot' | 'agentic'
  maxResults?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  afterDate?: string
  maxCharsPerResult?: number
  maxCharsTotal?: number
  maxAgeSeconds?: number
}

export function buildParallelProviderPayload(
  p: GatewayParallelSearchParams,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    objective: p.objective,
    mode: p.mode ?? PARALLEL_DEFAULTS.mode,
    max_results: p.maxResults ?? PARALLEL_DEFAULTS.maxResults,
  }
  assignOptionalArray(out, 'search_queries', p.searchQueries)
  const sourcePolicy = compactObject({
    include_domains: p.includeDomains,
    exclude_domains: p.excludeDomains,
    after_date: p.afterDate,
  })
  if (Object.keys(sourcePolicy).length) out.source_policy = sourcePolicy
  const excerpts = compactObject({
    max_chars_per_result: p.maxCharsPerResult ?? PARALLEL_DEFAULTS.excerpts.maxCharsPerResult,
    max_chars_total: p.maxCharsTotal ?? PARALLEL_DEFAULTS.excerpts.maxCharsTotal,
  })
  if (Object.keys(excerpts).length) out.excerpts = excerpts
  if (p.maxAgeSeconds != null) out.fetch_policy = { max_age_seconds: p.maxAgeSeconds }
  return out
}

export async function executeGatewayParallelSearch(
  accessToken: string | undefined,
  params: GatewayParallelSearchParams,
  innerProxyModelId: string = resolveGatewayProviderToolProxyModelId(),
  billingContext?: GatewaySearchBillingContext,
): Promise<unknown> {
  const apiKey = await resolveGatewayApiKey(accessToken)
  if (!apiKey) {
    throw new Error('AI Gateway API key is not configured (needed for web search)')
  }
  const gw = createGateway({ apiKey })
  const parallelTool = gw.tools.parallelSearch({
    mode: PARALLEL_DEFAULTS.mode,
    maxResults: PARALLEL_DEFAULTS.maxResults,
    excerpts: PARALLEL_DEFAULTS.excerpts,
  })
  const prompt = `Call parallel_search exactly once with this JSON input and no other tools:\n${JSON.stringify(buildParallelProviderPayload(params))}`

  const meter = await reserveGatewaySearch({
    billingContext,
    innerProxyModelId,
    input: params,
    toolName: 'parallel_search',
  })
  let meteredResult: Awaited<ReturnType<typeof runInnerGenerateTextWithTool>>
  try {
    meteredResult = await runInnerGenerateTextWithTool({
      toolName: 'parallel_search',
      tool: parallelTool,
      prompt,
      gw,
      innerProxyModelId,
      maxAttempts: INNER_TOOL_ATTEMPTS,
    })
    await finalizeGatewaySearch({
      ...meteredResult,
      billingContext: billingContext!,
      meter,
      toolName: 'parallel_search',
    })
  } catch (error) {
    await meter.policy.markForReconcile({
      errorMessage: error instanceof Error ? error.message : 'gateway_search_failed',
      reservationId: meter.reservationId,
      userId: billingContext!.userId,
    }).catch((_error) => undefined)
    throw error
  }
  const result = meteredResult.result
  const extracted = extractProviderToolOutput(result, 'parallel_search', 'Parallel search')
  if (extracted !== undefined) {
    logger.info('[AI Gateway] parallel_search inner generateText OK')
    const exactEntityPlan = buildExactEntityFallbackPlan(params.searchQueries ?? [])
    if (exactEntityPlan) {
      return filterExactEntityResults(extracted, exactEntityPlan)
    }
    return extracted
  }

  logger.error('[AI Gateway] parallel_search inner generateText missing tool result', {
    finishReason: result.finishReason,
    steps: result.steps.length,
  })
  throw new Error('Deep web search did not return results — check AI Gateway / Parallel billing and logs')
}

const searchRecencyEnum = z.enum(['day', 'week', 'month', 'year'])

export const perplexitySearchInputSchema = z.object({
  query: z
    .union([z.string().min(1), z.array(z.string().min(1)).max(5)])
    .describe('Search query or up to 5 queries to merge'),
  maxResults: z.number().int().min(1).max(20).optional(),
  maxTokensPerPage: z.number().int().min(256).max(2048).optional(),
  maxTokens: z.number().int().min(1000).max(1_000_000).optional(),
  country: z
    .string()
    .length(2)
    .optional()
    .describe("ISO 3166-1 alpha-2 (e.g. 'US')"),
  searchDomainFilter: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Allowlist e.g. arxiv.org, pubmed.ncbi.nlm.nih.gov — or '-reddit.com' to exclude (max 20)"),
  searchLanguageFilter: z.array(z.string().min(2).max(2)).max(10).optional(),
  searchAfterDate: z
    .string()
    .optional()
    .describe("MM/DD/YYYY; cannot be combined with searchRecencyFilter in the same call"),
  searchBeforeDate: z.string().optional(),
  lastUpdatedAfterFilter: z.string().optional(),
  lastUpdatedBeforeFilter: z.string().optional(),
  searchRecencyFilter: searchRecencyEnum
    .optional()
    .describe('Relative time window. Default year. Use day/week for news'),
})

export const parallelSearchInputSchema = z.object({
  objective: z
    .string()
    .min(1)
    .max(5000)
    .describe(
      'Natural-language research goal; for academic work say so and name domains (e.g. arxiv, PubMed).',
    ),
  searchQueries: z
    .array(z.string().min(1).max(200))
    .max(8)
    .optional()
    .describe('Optional keyword queries to supplement the objective'),
  mode: z.enum(['one-shot', 'agentic']).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
  includeDomains: z.array(z.string().min(1)).optional(),
  excludeDomains: z.array(z.string().min(1)).optional(),
  afterDate: z
    .string()
    .optional()
    .describe('ISO 8601 date; only include sources published after this date'),
  maxCharsPerResult: z.number().int().min(200).max(20_000).optional(),
  maxCharsTotal: z.number().int().min(2000).max(200_000).optional(),
  maxAgeSeconds: z.number().int().min(0).optional(),
})

export async function getGatewayPerplexitySearchTool(
  accessToken?: string,
  chatModelId?: string,
  billingContext?: GatewaySearchBillingContext,
) {
  try {
    await getOrCreateGateway(accessToken)
    const innerProxyModelId = resolveGatewayProviderToolProxyModelId(chatModelId)
    logger.info('[AI Gateway] perplexity_search: function-tool wrapper for chat model', chatModelId ?? '(unknown)', {
      innerProxyModelId,
    })
    return createPerplexitySearchFunctionTool(accessToken, innerProxyModelId, billingContext)
  } catch (err) {
    logger.error('[AI Gateway] perplexity_search unavailable — check AI_GATEWAY_API_KEY:', err)
    return null
  }
}

export async function getGatewayParallelSearchTool(
  accessToken?: string,
  chatModelId?: string,
  billingContext?: GatewaySearchBillingContext,
) {
  try {
    await getOrCreateGateway(accessToken)
    const innerProxyModelId = resolveGatewayProviderToolProxyModelId(chatModelId)
    logger.info('[AI Gateway] parallel_search: function-tool wrapper for chat model', chatModelId ?? '(unknown)', {
      innerProxyModelId,
    })
    return createParallelSearchFunctionTool(accessToken, innerProxyModelId, billingContext)
  } catch (err) {
    logger.error('[AI Gateway] parallel_search unavailable — check AI_GATEWAY_API_KEY:', err)
    return null
  }
}

function createPerplexitySearchFunctionTool(
  accessToken: string | undefined,
  innerProxyModelId: string,
  billingContext?: GatewaySearchBillingContext,
) {
  return tool({
    description:
      'Search the public web (Perplexity via Vercel AI Gateway). Use for quick lookups, news, and general web search. ' +
      'Supports up to 5 batched queries, domain allow/deny (e.g. arxiv.org, pubmed), language and recency filters. ' +
      'For a named person or entity, use the exact name without recency unless the user asks for current news; exact-name results are filtered automatically. ' +
      'For heavy academic / multi-source research with long excerpts, prefer parallel_search.',
    inputSchema: perplexitySearchInputSchema,
    execute: async (input) => executeGatewayPerplexitySearch(accessToken, {
      query: input.query,
      maxResults: input.maxResults,
      maxTokensPerPage: input.maxTokensPerPage,
      maxTokens: input.maxTokens,
      country: input.country,
      searchDomainFilter: input.searchDomainFilter,
      searchLanguageFilter: input.searchLanguageFilter,
      searchAfterDate: input.searchAfterDate,
      searchBeforeDate: input.searchBeforeDate,
      lastUpdatedAfterFilter: input.lastUpdatedAfterFilter,
      lastUpdatedBeforeFilter: input.lastUpdatedBeforeFilter,
      searchRecencyFilter: input.searchRecencyFilter,
    }, innerProxyModelId, billingContext),
  })
}

function createParallelSearchFunctionTool(
  accessToken: string | undefined,
  innerProxyModelId: string,
  billingContext?: GatewaySearchBillingContext,
) {
  return tool({
    description:
      'Deep web research (Parallel AI via Vercel AI Gateway): LLM-optimized excerpts, strong for synthesis, ' +
      'citations, and domain-scoped research (e.g. include arxiv.org, nature.com). Use when the user needs ' +
      'high-quality sources, long snippets, or academic-style review. Do not call this alongside perplexity_search ' +
      'for a simple named-person or named-entity lookup; perplexity_search already performs an exact-entity deep fallback.',
    inputSchema: parallelSearchInputSchema,
    execute: async (input) => executeGatewayParallelSearch(accessToken, {
      objective: input.objective,
      searchQueries: input.searchQueries,
      mode: input.mode,
      maxResults: input.maxResults,
      includeDomains: input.includeDomains,
      excludeDomains: input.excludeDomains,
      afterDate: input.afterDate,
      maxCharsPerResult: input.maxCharsPerResult,
      maxCharsTotal: input.maxCharsTotal,
      maxAgeSeconds: input.maxAgeSeconds,
    }, innerProxyModelId, billingContext),
  })
}

function toolProxyModelAttempts(innerProxyModelId: string): string[] {
  const fallback = resolveGatewayProviderToolProxyModelId()
  return innerProxyModelId === fallback ? [innerProxyModelId] : [innerProxyModelId, fallback]
}

function hasToolResult(
  result: Awaited<ReturnType<typeof generateText>>,
  toolName: 'perplexity_search' | 'parallel_search',
): boolean {
  return result.steps?.some((step) =>
    step.toolResults?.some((tr) => tr.toolName === toolName && tr.type === 'tool-result'),
  ) === true
}

function logToolProxyFallback(
  modelId: string,
  toolName: 'perplexity_search' | 'parallel_search',
): void {
  const fallback = resolveGatewayProviderToolProxyModelId()
  if (modelId !== fallback) {
    logger.warn(`[AI Gateway] ${toolName} falling back to Gateway proxy model`, {
      from: modelId,
      to: fallback,
    })
  }
}

function assignOptional(out: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value) out[key] = value
}

function assignOptionalArray(out: Record<string, unknown>, key: string, value: string[] | undefined): void {
  if (value?.length) out[key] = value
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => (
      Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null
    )),
  )
}

function normalizedSearchTerms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function searchResults(output: unknown): SearchResultRecord[] {
  if (!isRecord(output) || !Array.isArray(output.results)) return []
  return output.results.filter(isRecord)
}

function resultMatchesIdentity(
  result: SearchResultRecord,
  identityTerms: string[],
): boolean {
  const identitySurface = normalizedSearchTerms([
    result.title,
    result.url,
  ].filter((value): value is string => typeof value === 'string').join(' '))
  const identitySurfaceTerms = new Set(identitySurface)
  return identityTerms.every((term) => identitySurfaceTerms.has(term))
}

function normalizeFallbackResult(result: SearchResultRecord): SearchResultRecord {
  const excerpts = Array.isArray(result.excerpts)
    ? result.excerpts.filter((value): value is string => typeof value === 'string')
    : []
  const excerpt = typeof result.excerpt === 'string' ? result.excerpt : ''
  const snippet = typeof result.snippet === 'string' && result.snippet.trim()
    ? result.snippet
    : excerpts.join('\n\n') || excerpt
  const date = typeof result.date === 'string'
    ? result.date
    : typeof result.publish_date === 'string'
      ? result.publish_date
      : typeof result.publishDate === 'string'
        ? result.publishDate
        : undefined

  return {
    ...result,
    snippet,
    ...(date ? { date } : {}),
  }
}
