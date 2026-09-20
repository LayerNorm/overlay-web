import 'server-only'

import {
  finalizeProviderBudgetReservation,
  getPayerEntitlements,
  reserveProviderBudget,
  type ProviderUsageEvent,
} from '@/server/billing/billing-runtime'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'
import { logger } from '@/server/observability/logger'
import { verifyAgentGatewayToken, type AgentGatewayTokenClaims } from './token'

/**
 * Metered model proxy for agent CLIs running inside Overlay machines.
 *
 * Boxes get `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL` pointed here plus a scoped
 * gateway token, so `claude`, `codex`, `opencode`, etc. authenticate through
 * Overlay instead of holding real provider keys. Every upstream call is
 * reserved against the workspace/agent budget before it leaves and finalized
 * with the provider-reported token usage afterward — the same reserve/finalize
 * pipeline chat and sandbox metering use.
 */

const DEFAULT_RESERVE_USD = 0.25
const FALLBACK_USAGE_USD = 0.05
const ESTIMATED_INPUT_TOKENS = 32_000
const MAX_RESERVE_OUTPUT_TOKENS = 200_000
const UPSTREAM_TIMEOUT_MS = 280_000

type GatewayProviderId = 'anthropic' | 'openai'

type GatewayUpstream = {
  origin: string
  /** `getServerProviderKey` lookup for the real provider credential. */
  keyProvider: string
  /** Path prefixes relative to the provider segment (already `v1/...`). */
  allowedPaths: RegExp[]
  /** Which client header may carry the scoped token. */
  tokenHeaders: string[]
}

const UPSTREAMS: Record<GatewayProviderId, GatewayUpstream> = {
  anthropic: {
    // Origin is env-overridable so self-hosters can point at an
    // Anthropic-compatible relay (LiteLLM, internal gateways, …).
    origin: process.env.OVERLAY_AGENT_GATEWAY_ANTHROPIC_ORIGIN?.trim() || 'https://api.anthropic.com',
    keyProvider: 'anthropic',
    allowedPaths: [
      /^v1\/messages$/,
      /^v1\/messages\/count_tokens$/,
      /^v1\/models(?:\/[^/]+)?$/,
    ],
    tokenHeaders: ['x-api-key', 'authorization'],
  },
  openai: {
    origin: process.env.OVERLAY_AGENT_GATEWAY_OPENAI_ORIGIN?.trim() || 'https://api.openai.com',
    keyProvider: 'openai',
    allowedPaths: [
      /^v1\/chat\/completions$/,
      /^v1\/responses$/,
      /^v1\/embeddings$/,
      /^v1\/models(?:\/[^/]+)?$/,
    ],
    tokenHeaders: ['authorization', 'x-api-key'],
  },
}

const HOP_BY_HOP_HEADERS = new Set([
  'authorization', 'x-api-key', 'host', 'content-length', 'connection',
  'transfer-encoding', 'cookie', 'keep-alive', 'proxy-authorization',
])

export type ParsedTokenUsage = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

function isGatewayProviderId(value: string): value is GatewayProviderId {
  return value === 'anthropic' || value === 'openai'
}

function errorShape(provider: GatewayProviderId, status: number, type: string, message: string): Response {
  const body = provider === 'anthropic'
    ? { type: 'error', error: { type, message } }
    : { error: { message, type, code: type } }
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function extractToken(request: Request, upstream: GatewayUpstream): string | null {
  for (const header of upstream.tokenHeaders) {
    const value = request.headers.get(header)?.trim()
    if (!value) continue
    return header === 'authorization' && value.toLowerCase().startsWith('bearer ')
      ? value.slice(7).trim()
      : value
  }
  return null
}

function reserveUsd(): number {
  const configured = Number(process.env.OVERLAY_AGENT_GATEWAY_RESERVE_USD)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RESERVE_USD
}

function fallbackUsageUsd(): number {
  const configured = Number(process.env.OVERLAY_AGENT_GATEWAY_FALLBACK_USD)
  return Number.isFinite(configured) && configured >= 0 ? configured : FALLBACK_USAGE_USD
}

/**
 * Map a provider-native model id (`claude-sonnet-4-5-20250929`, `gpt-5.2-codex`)
 * onto a priced catalog id. Catalog entries are `provider/model` or bare ids;
 * dated suffixes are stripped as a second pass. Returns null when unpriced —
 * the caller bills the conservative fallback rather than blocking new models.
 */
export async function pricedModelId(provider: GatewayProviderId, rawModel: string): Promise<string | null> {
  const undated = rawModel.replace(/-\d{8}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
  const candidates = [...new Set([
    rawModel,
    `${provider}/${rawModel}`,
    undated,
    `${provider}/${undated}`,
  ])]
  for (const candidate of candidates) {
    // Cost resolution doubles as the existence check — the catalog is the
    // source of truth for pricing, so reuse it rather than duplicating a list.
    const cost = await calculateLanguageModelTokenCostOrNull(candidate, 0, 0, 0)
    if (cost !== null) return candidate
  }
  return null
}

async function estimateReserveUsd(modelId: string | null, maxOutputTokens: number): Promise<number> {
  const floor = reserveUsd()
  if (!modelId) return floor
  const outputTokens = Math.min(Math.max(maxOutputTokens, 1), MAX_RESERVE_OUTPUT_TOKENS)
  const estimate = await calculateLanguageModelTokenCostOrNull(modelId, ESTIMATED_INPUT_TOKENS, 0, outputTokens)
  return estimate !== null && estimate > 0 ? Math.max(estimate, floor) : floor
}

function parseJsonBody(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch (_error) {
    return null
  }
}

function numericField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0
}

export function usageFromAnthropicJson(body: Record<string, unknown>): ParsedTokenUsage | null {
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : null
  if (!usage) return null
  const input = numericField(usage.input_tokens)
  const cacheRead = numericField(usage.cache_read_input_tokens)
  const cacheCreate = numericField(usage.cache_creation_input_tokens)
  const output = numericField(usage.output_tokens)
  if (input + cacheRead + cacheCreate + output === 0) return null
  return { inputTokens: input + cacheCreate, cachedInputTokens: cacheRead, outputTokens: output }
}

export function usageFromOpenAiJson(body: Record<string, unknown>): ParsedTokenUsage | null {
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : null
  if (!usage) return null
  // chat.completions shape
  const promptTokens = numericField(usage.prompt_tokens)
  const completionTokens = numericField(usage.completion_tokens)
  if (promptTokens + completionTokens > 0) {
    const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
      ? usage.prompt_tokens_details as Record<string, unknown> : {}
    return { inputTokens: promptTokens, cachedInputTokens: numericField(details.cached_tokens), outputTokens: completionTokens }
  }
  // responses shape
  const input = numericField(usage.input_tokens)
  const output = numericField(usage.output_tokens)
  if (input + output === 0) return null
  const details = usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
    ? usage.input_tokens_details as Record<string, unknown> : {}
  return { inputTokens: input, cachedInputTokens: numericField(details.cached_tokens), outputTokens: output }
}

export function accumulateAnthropicEvent(acc: ParsedTokenUsage, event: Record<string, unknown>): void {
  if (event.type === 'message_start' && event.message && typeof event.message === 'object') {
    const usage = (event.message as Record<string, unknown>).usage
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>
      acc.inputTokens += numericField(u.input_tokens) + numericField(u.cache_creation_input_tokens)
      acc.cachedInputTokens += numericField(u.cache_read_input_tokens)
    }
  }
  // output_tokens on message_delta is cumulative — keep the latest.
  if (event.type === 'message_delta' && event.usage && typeof event.usage === 'object') {
    acc.outputTokens = numericField((event.usage as Record<string, unknown>).output_tokens) || acc.outputTokens
  }
}

export function accumulateOpenAiEvent(acc: ParsedTokenUsage, event: Record<string, unknown>): void {
  // chat.completions chunks carry a top-level `usage` when stream_options.include_usage is set.
  const direct = usageFromOpenAiJson(event)
  if (direct) {
    acc.inputTokens = direct.inputTokens || acc.inputTokens
    acc.cachedInputTokens = direct.cachedInputTokens || acc.cachedInputTokens
    acc.outputTokens = direct.outputTokens || acc.outputTokens
    return
  }
  // responses stream: terminal event carries the response object.
  const response = event.response && typeof event.response === 'object'
    ? event.response as Record<string, unknown> : null
  const nested = response ? usageFromOpenAiJson(response) : null
  if (nested) {
    acc.inputTokens = nested.inputTokens || acc.inputTokens
    acc.cachedInputTokens = nested.cachedInputTokens || acc.cachedInputTokens
    acc.outputTokens = nested.outputTokens || acc.outputTokens
  }
}

/** Drain a tee'd SSE branch, accumulating the provider's reported usage. */
export async function consumeSseUsage(stream: ReadableStream<Uint8Array>, provider: GatewayProviderId): Promise<ParsedTokenUsage | null> {
  const acc: ParsedTokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          const event = parseJsonBody(data)
          if (!event) continue
          if (provider === 'anthropic') accumulateAnthropicEvent(acc, event)
          else accumulateOpenAiEvent(acc, event)
        }
      }
    }
  } catch (_error) {
    // A truncated tap still returns whatever usage was seen before the break.
    reader.cancel().catch((_error) => undefined)
  }
  return acc.inputTokens + acc.cachedInputTokens + acc.outputTokens > 0 ? acc : null
}

async function finalizeUsage(params: {
  claims: AgentGatewayTokenClaims
  modelId: string | null
  reservationId: string | null | undefined
  requestedModel: string
  usage: ParsedTokenUsage | null
}) {
  const costUsd = params.usage && params.modelId
    ? await calculateLanguageModelTokenCostOrNull(
        params.modelId,
        params.usage.inputTokens,
        params.usage.cachedInputTokens,
        params.usage.outputTokens,
      ) ?? fallbackUsageUsd()
    : params.usage
      ? fallbackUsageUsd()
      : 0
  if (params.usage && !params.modelId) {
    logger.warn('[agent-gateway] unpriced model; billed fallback', { model: params.requestedModel.slice(0, 120) })
  }
  const events: ProviderUsageEvent[] | undefined = params.usage
    ? [{
        type: 'agent',
        modelId: params.modelId ?? params.requestedModel,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        cachedTokens: params.usage.cachedInputTokens,
        cost: costUsd,
        timestamp: Date.now(),
      }]
    : undefined
  await finalizeProviderBudgetReservation({
    userId: params.claims.userId,
    reservationId: params.reservationId,
    actualProviderCostUsd: costUsd,
    events,
  }).catch((error) => {
    logger.error('[agent-gateway] usage finalize failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

export async function handleAgentGatewayRequest(
  request: Request,
  segments: { provider?: string; path?: string[] },
): Promise<Response> {
  const provider = segments.provider ?? ''
  const path = (segments.path ?? []).join('/')
  if (!isGatewayProviderId(provider)) {
    return Response.json({ error: 'Unknown agent gateway provider', code: 'provider_invalid' }, { status: 404 })
  }
  const upstream = UPSTREAMS[provider]
  if (!upstream.allowedPaths.some((pattern) => pattern.test(path))) {
    return errorShape(provider, 404, 'not_found_error', 'Endpoint is not exposed through the agent gateway.')
  }
  if (request.method !== 'POST' && !(request.method === 'GET' && /^v1\/models/.test(path))) {
    return errorShape(provider, 405, 'invalid_request_error', 'Method not allowed.')
  }

  const token = extractToken(request, upstream)
  const claims = token ? verifyAgentGatewayToken(token) : null
  if (!claims) {
    return errorShape(provider, 401, 'authentication_error', 'Invalid or expired Overlay agent-gateway token.')
  }

  const bodyText = request.method === 'POST' ? await request.text() : ''
  const body = bodyText ? parseJsonBody(bodyText) : null
  const requestedModel = typeof body?.model === 'string' ? body.model : ''
  const maxOutputTokens = numericField(body?.max_tokens ?? body?.max_completion_tokens) || 8_192

  const programmaticSubjectId = claims.agentId ? `agent:${claims.agentId}` : undefined
  const entitlements = await getPayerEntitlements({
    userId: claims.userId,
    workspaceId: claims.workspaceId,
    programmaticSubjectId,
  }).catch((_error) => null)
  if (!entitlements) {
    return errorShape(provider, 402, 'billing_error', 'No active Overlay billing account for this agent.')
  }

  const modelId = requestedModel ? await pricedModelId(provider, requestedModel) : null
  const reservation = await reserveProviderBudget({
    userId: claims.userId,
    entitlements,
    providerCostUsd: await estimateReserveUsd(modelId, maxOutputTokens),
    kind: 'agent',
    modelId: modelId ?? requestedModel,
    operationId: `agent-gateway:${provider}`,
    requestFingerprint: `${claims.workspaceId}:${claims.agentId ?? claims.userId}:${provider}`,
    workspaceId: claims.workspaceId,
    programmaticSubjectId,
  })
  if (!reservation.ok) {
    return errorShape(provider, reservation.status, 'billing_error',
      'Overlay budget is exhausted; the agent cannot make model calls until budget is added.')
  }

  const serverKey = await getServerProviderKey(upstream.keyProvider)
  if (!serverKey) {
    await finalizeProviderBudgetReservation({
      userId: claims.userId, reservationId: reservation.reservationId, actualProviderCostUsd: 0,
    }).catch((_error) => undefined)
    return errorShape(provider, 503, 'api_error', 'Model provider is not configured on this Overlay deployment.')
  }

  const headers = new Headers(request.headers)
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name)
  if (provider === 'anthropic') headers.set('x-api-key', serverKey)
  else headers.set('authorization', `Bearer ${serverKey}`)

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(`${upstream.origin}/${path}`, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? bodyText : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (error) {
    await finalizeProviderBudgetReservation({
      userId: claims.userId, reservationId: reservation.reservationId, actualProviderCostUsd: 0,
    }).catch((_error) => undefined)
    return errorShape(provider, 502, 'api_error', `Upstream model call failed: ${error instanceof Error ? error.message : 'unreachable'}`)
  }

  const responseHeaders = new Headers(upstreamResponse.headers)
  for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'connection']) {
    responseHeaders.delete(name)
  }
  responseHeaders.set('Cache-Control', 'no-store')

  const isSse = (upstreamResponse.headers.get('content-type') ?? '').includes('text/event-stream')
  if (!upstreamResponse.body) {
    await finalizeUsage({ claims, modelId, reservationId: reservation.reservationId, requestedModel, usage: null })
    return new Response(null, { status: upstreamResponse.status, headers: responseHeaders })
  }

  if (isSse) {
    const [clientBranch, meterBranch] = upstreamResponse.body.tee()
    void consumeSseUsage(meterBranch, provider).then((usage) => finalizeUsage({
      claims, modelId, reservationId: reservation.reservationId, requestedModel, usage,
    }))
    return new Response(clientBranch, { status: upstreamResponse.status, headers: responseHeaders })
  }

  const raw = await upstreamResponse.arrayBuffer()
  const parsed = parseJsonBody(Buffer.from(raw).toString('utf8'))
  const usage = parsed
    ? provider === 'anthropic' ? usageFromAnthropicJson(parsed) : usageFromOpenAiJson(parsed)
    : null
  await finalizeUsage({ claims, modelId, reservationId: reservation.reservationId, requestedModel, usage })
  return new Response(raw, { status: upstreamResponse.status, headers: responseHeaders })
}
