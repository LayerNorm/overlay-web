import 'server-only'

import { tool } from 'ai'
import { z } from 'zod'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'
import { getGatewayModelId } from '@/server/ai/gateway/gateway-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { providerRequestFingerprint } from '@/server/billing/ServerProviderUsageMeter'
import { billableBudgetCentsFromProviderUsd } from '@/server/billing/billing-runtime'
import { logger } from '@/server/observability/logger'
import type { Entitlements } from '@/shared/app/app-contracts'
import {
  buildExactEntityFallbackPlan,
  filterExactEntityResults,
  mergeExactEntityFallbackResults,
  searchResults,
} from './web-search-entity'

const ELO_BASE_URL = 'https://api.withgrowl.com/v1'
const TINYFISH_FETCH_URL = 'https://api.fetch.tinyfish.ai'

/** Flat per-provider-call price billed to the user — provider cost to us is ~$0. */
const WEB_SEARCH_REQUEST_USD = 0.005
const WEB_SEARCH_MAX_RESERVE_USD = 0.05
const ELO_TIMEOUT_MS = 35_000
const TINYFISH_TIMEOUT_MS = 60_000
const MAX_PROVIDER_RETRIES = 2
const WEB_FETCH_DEFAULT_MAX_CHARS_PER_PAGE = 20_000

export type WebSearchBillingContext = {
  entitlements: Entitlements
  programmaticSubjectId?: string
  requestFingerprint: string
  userId: string
  workspaceId?: string
}

export const webSearchInputSchema = z.object({
  query: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(5)])
    .describe('The search query, or up to 5 queries to batch'),
  maxResults: z.number().int().min(1).max(20).optional(),
  searchDomainFilter: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Allowlist e.g. arxiv.org — or '-reddit.com' to exclude (max 20)"),
  searchRecencyFilter: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe('Relative time window. Use day/week for news'),
  searchAfterDate: z.string().optional().describe('YYYY-MM-DD'),
  searchBeforeDate: z.string().optional().describe('YYYY-MM-DD'),
  country: z
    .string()
    .length(2)
    .optional()
    .describe("ISO 3166-1 alpha-2 (e.g. 'US')"),
})

export const deepSearchInputSchema = z.object({
  objective: z
    .string()
    .min(1)
    .max(5000)
    .describe(
      'Natural-language research goal; for academic work say so and name domains (e.g. arxiv, PubMed).',
    ),
  searchQueries: z
    .array(z.string().min(1).max(200))
    .max(6)
    .optional()
    .describe('Short keyword queries (2-3 work best) to supplement the objective'),
  effort: z
    .enum(['fast', 'standard', 'deep'])
    .optional()
    .describe('Retrieval thoroughness; default deep'),
  maxResults: z.number().int().min(1).max(20).optional(),
  includeDomains: z.array(z.string().min(1)).optional(),
  excludeDomains: z.array(z.string().min(1)).optional(),
  afterDate: z
    .string()
    .optional()
    .describe('YYYY-MM-DD; only include sources published after this date'),
  maxCharsPerResult: z.number().int().min(200).max(20_000).optional(),
  maxCharsTotal: z.number().int().min(2000).max(200_000).optional(),
  maxAgeSeconds: z.number().int().min(600).optional(),
})

export const webFetchInputSchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(10)
    .describe('One or more URLs to fetch (up to 10)'),
  format: z.enum(['markdown', 'html', 'json']).optional(),
  maxCharsPerPage: z.number().int().min(500).max(100_000).optional(),
  ttl: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Cache freshness in seconds; 0 forces a live fetch'),
  includeSelectors: z.array(z.string().min(1)).max(20).optional(),
  excludeSelectors: z.array(z.string().min(1)).max(20).optional(),
})

export type WebSearchInput = z.infer<typeof webSearchInputSchema>
export type DeepSearchInput = z.infer<typeof deepSearchInputSchema>
export type WebFetchInput = z.infer<typeof webFetchInputSchema>

export function buildTavilyRequestBody(
  query: string,
  input: Omit<WebSearchInput, 'query'>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    query,
    max_results: input.maxResults ?? 10,
    search_depth: 'basic',
    include_answer: true,
  }
  const domains = splitDomainFilter(input.searchDomainFilter)
  if (domains.include.length) out.include_domains = domains.include
  if (domains.exclude.length) out.exclude_domains = domains.exclude
  const hasDateRange = Boolean(input.searchAfterDate || input.searchBeforeDate)
  if (input.searchAfterDate) out.start_date = input.searchAfterDate
  if (input.searchBeforeDate) out.end_date = input.searchBeforeDate
  if (!hasDateRange && input.searchRecencyFilter) out.time_range = input.searchRecencyFilter
  const countryName = tavilyCountryName(input.country)
  if (countryName) out.country = countryName
  return out
}

export function buildParallelRequestBody(
  input: DeepSearchInput,
  clientModelId?: string,
): Record<string, unknown> {
  const mode = input.effort === 'fast' ? 'fast' : input.effort === 'standard' ? 'basic' : 'advanced'
  const out: Record<string, unknown> = {
    objective: input.objective,
    search_queries: input.searchQueries?.length ? input.searchQueries : [input.objective.slice(0, 200)],
    mode,
  }
  const advanced: Record<string, unknown> = {}
  if (input.maxResults != null) advanced.max_results = input.maxResults
  const sourcePolicy = compactObject({
    include_domains: input.includeDomains,
    exclude_domains: input.excludeDomains,
    after_date: input.afterDate,
  })
  if (Object.keys(sourcePolicy).length) advanced.source_policy = sourcePolicy
  if (input.maxCharsPerResult != null) {
    advanced.excerpt_settings = { max_chars_per_result: input.maxCharsPerResult }
  }
  if (input.maxAgeSeconds != null) {
    advanced.fetch_policy = { max_age_seconds: Math.max(600, input.maxAgeSeconds) }
  }
  if (Object.keys(advanced).length) out.advanced_settings = advanced
  if (input.maxCharsTotal != null) out.max_chars_total = input.maxCharsTotal
  if (clientModelId) out.client_model = clientModelId
  return out
}

export function buildTinyfishRequestBody(input: WebFetchInput): Record<string, unknown> {
  return compactObject({
    urls: input.urls,
    format: input.format ?? 'markdown',
    ttl: input.ttl,
    include_selectors: input.includeSelectors,
    exclude_selectors: input.excludeSelectors,
  })
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return res
}

async function postEloSearch(provider: 'tavily' | 'parallel', body: Record<string, unknown>): Promise<unknown> {
  const apiKey = await getServerProviderKey('elo')
  if (!apiKey) throw new Error('ELO_API_KEY is not configured (needed for web search)')
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= MAX_PROVIDER_RETRIES; attempt++) {
    try {
      const res = await postJson(`${ELO_BASE_URL}/search/${provider}`, {
        Authorization: `Bearer ${apiKey}`,
      }, body, ELO_TIMEOUT_MS)
      if (res.ok) return await res.json()
      if ((res.status === 429 || res.status === 503) && attempt < MAX_PROVIDER_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500, 5000)))
        continue
      }
      const detail = (await res.text()).slice(0, 300)
      throw new Error(`Web search failed (${provider} via Elo, HTTP ${res.status}): ${detail}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < MAX_PROVIDER_RETRIES && lastError.name !== 'AbortError') continue
      throw lastError
    }
  }
  throw lastError ?? new Error('Web search failed')
}

async function postTinyfishFetch(body: Record<string, unknown>): Promise<unknown> {
  const apiKey = await getServerProviderKey('tinyfish')
  if (!apiKey) throw new Error('TINYFISH_API_KEY is not configured (needed for web_fetch)')
  const res = await postJson(TINYFISH_FETCH_URL, { 'X-API-Key': apiKey }, body, TINYFISH_TIMEOUT_MS)
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    throw new Error(`web_fetch failed (TinyFish, HTTP ${res.status}): ${detail}`)
  }
  return res.json()
}

async function reserveWebSearch(params: {
  billingContext: WebSearchBillingContext | undefined
  input: unknown
  toolName: 'web_search' | 'deep_search' | 'web_fetch'
}) {
  if (!params.billingContext) throw new Error('web_search_billing_context_required')
  const policy = getOverlayServerContext().generationUsagePolicy
  const operationId = `websearch.${params.toolName}:${globalThis.crypto.randomUUID()}`
  const reservation = await policy.reserve({
    entitlements: params.billingContext.entitlements,
    idempotencyKey: operationId,
    kind: 'generation',
    modelId: `search-tool/${params.toolName}`,
    operationId,
    providerCostUsd: WEB_SEARCH_MAX_RESERVE_USD,
    requestFingerprint: providerRequestFingerprint({
      parent: params.billingContext.requestFingerprint,
      input: params.input,
    }),
    programmaticSubjectId: params.billingContext.programmaticSubjectId,
    userId: params.billingContext.userId,
    workspaceId: params.billingContext.workspaceId,
  })
  if (!reservation.ok) throw new Error(reservation.code)
  await policy.markStarted({
    reservationId: reservation.reservationId,
    userId: params.billingContext.userId,
  })
  return { policy, reservationId: reservation.reservationId }
}

async function finalizeWebSearch(params: {
  billingContext: WebSearchBillingContext
  meter: Awaited<ReturnType<typeof reserveWebSearch>>
  providerCalls: number
  toolName: 'web_search' | 'deep_search' | 'web_fetch'
}) {
  const actualProviderCostUsd = Math.max(1, params.providerCalls) * WEB_SEARCH_REQUEST_USD
  await params.meter.policy.finalize({
    actualProviderCostUsd,
    events: [{
      type: 'generation',
      modelId: `search-tool/${params.toolName}`,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: billableBudgetCentsFromProviderUsd(actualProviderCostUsd),
      timestamp: Date.now(),
    }],
    reservationId: params.meter.reservationId,
    userId: params.billingContext.userId,
  })
}

async function reconcileWebSearch(
  meter: Awaited<ReturnType<typeof reserveWebSearch>>,
  billingContext: WebSearchBillingContext | undefined,
  error: unknown,
) {
  await meter.policy.markForReconcile({
    errorMessage: error instanceof Error ? error.message : 'web_search_failed',
    reservationId: meter.reservationId,
    userId: billingContext!.userId,
  }).catch((_error) => undefined)
}

export async function executeDeepSearch(
  input: DeepSearchInput,
  billingContext?: WebSearchBillingContext,
  chatModelId?: string,
): Promise<unknown> {
  let clientModelId: string | undefined
  if (chatModelId) {
    try { clientModelId = getGatewayModelId(chatModelId) } catch (_error) { clientModelId = undefined }
  }
  const meter = await reserveWebSearch({ billingContext, input, toolName: 'deep_search' })
  try {
    const output = await postEloSearch('parallel', buildParallelRequestBody(input, clientModelId))
    await finalizeWebSearch({ billingContext: billingContext!, meter, providerCalls: 1, toolName: 'deep_search' })
    return output
  } catch (error) {
    await reconcileWebSearch(meter, billingContext, error)
    throw error
  }
}

async function executeWebSearch(
  input: WebSearchInput,
  billingContext?: WebSearchBillingContext,
  chatModelId?: string,
): Promise<unknown> {
  const queries = Array.isArray(input.query) ? input.query.slice(0, 5) : [input.query]
  const meter = await reserveWebSearch({ billingContext, input, toolName: 'web_search' })
  try {
    const outputs = await Promise.all(
      queries.map((q) => postEloSearch('tavily', buildTavilyRequestBody(q, input))),
    )
    const merged = mergeTavilyOutputs(queries, outputs)
    const fallbackPlan = buildExactEntityFallbackPlan(queries, input.country)
    let output: unknown = merged
    if (fallbackPlan) {
      const filtered = filterExactEntityResults(merged, fallbackPlan)
      try {
        const fallbackOutput = await executeDeepSearch({
          objective: fallbackPlan.objective,
          searchQueries: fallbackPlan.searchQueries,
          effort: 'standard',
          maxResults: input.maxResults ?? 10,
        }, billingContext, chatModelId)
        output = mergeExactEntityFallbackResults(merged, fallbackOutput, fallbackPlan)
        if (output === merged) output = filtered
      } catch (error) {
        logger.warn('[web-search] exact entity deep fallback failed', {
          entity: fallbackPlan.label,
          error: error instanceof Error ? error.message : String(error),
        })
        output = filtered
      }
    }
    await finalizeWebSearch({ billingContext: billingContext!, meter, providerCalls: queries.length, toolName: 'web_search' })
    return output
  } catch (error) {
    await reconcileWebSearch(meter, billingContext, error)
    throw error
  }
}

async function executeWebFetch(
  input: WebFetchInput,
  billingContext?: WebSearchBillingContext,
): Promise<unknown> {
  const meter = await reserveWebSearch({ billingContext, input, toolName: 'web_fetch' })
  try {
    const output = await postTinyfishFetch(buildTinyfishRequestBody(input))
    const capped = capFetchText(output, input.maxCharsPerPage ?? WEB_FETCH_DEFAULT_MAX_CHARS_PER_PAGE)
    await finalizeWebSearch({ billingContext: billingContext!, meter, providerCalls: 1, toolName: 'web_fetch' })
    return capped
  } catch (error) {
    await reconcileWebSearch(meter, billingContext, error)
    throw error
  }
}

export async function getWebSearchTool(
  chatModelId?: string,
  billingContext?: WebSearchBillingContext,
) {
  if (!await getServerProviderKey('elo')) {
    logger.error('[web-search] unavailable — ELO_API_KEY not configured')
    return null
  }
  return tool({
    description:
      'Search the public web for quick lookups, news, and general questions. Supports up to 5 batched queries, ' +
      'domain allow/deny lists, and recency filters; returns results plus a short synthesized answer. ' +
      'For a named person or entity use the exact name without recency unless the user asks for current news; ' +
      'exact-name results are filtered automatically. For deep multi-source research use deep_search; ' +
      'for a known URL use web_fetch.',
    inputSchema: webSearchInputSchema,
    execute: async (input) => executeWebSearch(input, billingContext, chatModelId),
  })
}

export async function getDeepSearchTool(
  chatModelId?: string,
  billingContext?: WebSearchBillingContext,
) {
  if (!await getServerProviderKey('elo')) {
    logger.error('[web-search] unavailable — ELO_API_KEY not configured')
    return null
  }
  return tool({
    description:
      'Deep web research: LLM-optimized long excerpts across many sources, with domain scoping ' +
      '(includeDomains e.g. arxiv.org, nature.com), date filters, and an effort knob. Give a self-contained ' +
      'objective plus 2-3 short searchQueries. Use for synthesis, citations, and academic or multi-source ' +
      'review. For the full text of a specific result, follow up with web_fetch. Do not call alongside ' +
      'web_search for a simple named-person or named-entity lookup; web_search already deep-augments those.',
    inputSchema: deepSearchInputSchema,
    execute: async (input) => executeDeepSearch(input, billingContext, chatModelId),
  })
}

export async function getWebFetchTool(
  billingContext?: WebSearchBillingContext,
) {
  if (!await getServerProviderKey('tinyfish')) {
    logger.error('[web-search] web_fetch unavailable — TINYFISH_API_KEY not configured')
    return null
  }
  return tool({
    description:
      'Fetch one or more URLs (up to 10) and return clean page content as markdown — JavaScript-rendered ' +
      'when needed. Use when you already have a specific URL: docs, articles, or a page found by web_search ' +
      'or deep_search. Per-URL failures are reported in errors[] without failing the batch.',
    inputSchema: webFetchInputSchema,
    execute: async (input) => executeWebFetch(input, billingContext),
  })
}

function mergeTavilyOutputs(queries: string[], outputs: unknown[]): Record<string, unknown> {
  const seenUrls = new Set<string>()
  const results: Record<string, unknown>[] = []
  const answers: string[] = []
  for (let i = 0; i < outputs.length; i++) {
    for (const result of searchResults(outputs[i])) {
      const url = typeof result.url === 'string' ? result.url : ''
      if (url && seenUrls.has(url)) continue
      if (url) seenUrls.add(url)
      results.push(queries.length > 1 ? { ...result, query: queries[i] } : result)
    }
    const answer = outputs[i] && typeof outputs[i] === 'object'
      ? (outputs[i] as Record<string, unknown>).answer
      : undefined
    if (typeof answer === 'string' && answer.trim()) answers.push(answer)
  }
  const out: Record<string, unknown> = { results }
  if (answers.length) out.answers = answers
  if (queries.length > 1) out.queries = queries
  return out
}

function capFetchText(output: unknown, maxCharsPerPage: number): unknown {
  if (typeof output !== 'object' || output === null || !Array.isArray((output as Record<string, unknown>).results)) {
    return output
  }
  const results = (output as { results: Record<string, unknown>[] }).results.map((result) => {
    if (typeof result.text === 'string' && result.text.length > maxCharsPerPage) {
      return { ...result, text: result.text.slice(0, maxCharsPerPage), truncated: true }
    }
    return result
  })
  return { ...(output as Record<string, unknown>), results }
}

// Tavily's `country` takes an English country name, not an ISO code.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
function tavilyCountryName(alpha2: string | undefined): string | undefined {
  if (!alpha2) return undefined
  const code = alpha2.toUpperCase()
  try {
    const name = regionNames.of(code)
    // of() echoes the input back for well-formed but unknown codes — omit those.
    return name && name !== code ? name : undefined
  } catch (_error) {
    return undefined
  }
}

function splitDomainFilter(filter: string[] | undefined): { include: string[]; exclude: string[] } {
  const include: string[] = []
  const exclude: string[] = []
  for (const entry of filter ?? []) {
    if (entry.startsWith('-')) exclude.push(entry.slice(1))
    else include.push(entry)
  }
  return { include, exclude }
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => (
      Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null
    )),
  )
}
