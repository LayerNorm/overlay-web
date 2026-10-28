import 'server-only'
import { OverlayFreeRouteBusyError } from './overlay-free-router-errors'

import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import {
  assessFreeReceipt,
  freeRoutePriority,
  FREE_ROUTE_COOLDOWN_MS,
  FREE_ROUTE_LEASE_MS,
  FREE_ROUTE_TIMEOUT_MS,
  OPENROUTER_FREE_MODEL_ID,
  OVERLAY_FREE_MODEL_ID,
  type FreeRouteCapabilities,
} from '@/shared/ai/gateway/overlay-free-policy'
import type {
  OverlayFreeRepository,
  OverlayFreeRoute,
  OverlayFreeRouterOptions,
  OverlayFreeReceiptSummary,
} from './overlay-free-router-contracts'
import {
  hasInsecureOverlayFreeImageUrl,
  hasProviderExecutedOverlayFreeTool,
  hasUnsupportedOverlayFreeMedia,
  overlayFreePrivacyRequested,
  overlayFreeRouteSupports,
  parseOverlayFreeCapabilities,
  trustedOverlayFreeOptions,
} from './overlay-free-request-policy'
import { doOverlayFreeStream } from './overlay-free-router-stream'
import { confirmOpenRouterGenerationCost } from './openrouter-generation-cost'
import { getOrCreateGateway, getGatewayModelId, resolveOpenRouterApiKey } from './gateway-runtime'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { preflightOverlayFreeRoute, refreshOverlayFreeCatalog } from './overlay-free-refresh'

export type {
  OverlayFreeRepository,
  OverlayFreeRoute,
  OverlayFreeRouterOptions,
  OverlayFreeProviderFactory,
} from './overlay-free-router-contracts'

function isRateLimited(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'statusCode' in error && (error as { statusCode?: unknown }).statusCode === 429
}

export function isEmptyOverlayFreeCompletion(content: LanguageModelV4GenerateResult['content']): boolean {
  const hasText = content.some((part) => part.type === 'text' && part.text.trim().length > 0)
  const hasToolCall = content.some((part) => part.type === 'tool-call')
  return !hasText && !hasToolCall
}

function shouldRetryEmptyCompletion(
  safe: boolean,
  content: LanguageModelV4GenerateResult['content'],
): boolean {
  return safe && isEmptyOverlayFreeCompletion(content)
}

function resultAfterGenerateAttempts(
  lastEmpty: LanguageModelV4GenerateResult | undefined,
  capacityRejected: boolean,
  ambiguousAttempt: boolean,
  lastError: unknown,
): LanguageModelV4GenerateResult {
  if (lastEmpty) return lastEmpty
  if (capacityRejected && !ambiguousAttempt) throw new OverlayFreeRouteBusyError()
  throw lastError
}

function receiptSummary(value: ReturnType<typeof assessFreeReceipt>): OverlayFreeReceiptSummary {
  return {
    safe: value.safe,
    cost: value.cost,
    ...(value.reason ? { reason: value.reason } : {}),
    ...(value.actualModelId ? { actualModelId: value.actualModelId } : {}),
    ...(value.actualProvider ? { actualProvider: value.actualProvider } : {}),
  }
}

function overlayMetadata(
  providerMetadata: LanguageModelV4GenerateResult['providerMetadata'],
  route: OverlayFreeRoute,
  receipt: OverlayFreeReceiptSummary,
) {
  return {
    ...providerMetadata,
    overlayFree: {
      route: receipt.actualModelId ?? route.modelId,
      provider: receipt.actualProvider ?? route.provider,
      safe: receipt.safe,
      cost: receipt.cost,
      ...(receipt.reason ? { reason: receipt.reason } : {}),
    },
  }
}

function logUnsafeReceipt(route: OverlayFreeRoute, receipt: OverlayFreeReceiptSummary): void {
  if (receipt.safe) return
  logger.warn('[overlay-free] unsafe provider receipt', {
    routeKey: route.routeKey,
    cost: receipt.cost,
    reason: receipt.reason ?? 'unsafe receipt',
  })
}

type GenerateFailureResult = {
  capacityRejected: boolean
  ambiguousAttempt: boolean
  rethrow: boolean
}

async function settleGenerateFailure(
  repository: OverlayFreeRepository,
  route: OverlayFreeRoute,
  token: string,
  now: () => number,
  error: unknown,
  generationStarted: boolean,
  aborted: boolean,
): Promise<GenerateFailureResult> {
  if (aborted) {
    if (!generationStarted) {
      await repository.cooldown(route.routeKey, token, now())
      return { capacityRejected: false, ambiguousAttempt: false, rethrow: true }
    }
    await repository.settle({
      routeKey: route.routeKey, leaseToken: token, now: now(),
      receipt: { safe: false, cost: null, reason: 'request aborted' },
      safe: false, cost: null, reason: 'request aborted',
    })
    return { capacityRejected: false, ambiguousAttempt: true, rethrow: true }
  }
  const rateLimited = isRateLimited(error)
  if (!generationStarted || rateLimited) {
    await repository.cooldown(route.routeKey, token, now())
    return { capacityRejected: generationStarted && rateLimited, ambiguousAttempt: false, rethrow: false }
  }
  await repository.settle({
    routeKey: route.routeKey, leaseToken: token, now: now(),
    receipt: { safe: false, cost: null, reason: 'missing receipt' },
    safe: false, cost: null, reason: 'missing receipt',
  })
  return { capacityRejected: false, ambiguousAttempt: true, rethrow: false }
}

export function createSingleRequestFetch(fetcher: typeof fetch): typeof fetch {
  let requested = false
  let retryStatus: { status: number; statusText: string } | undefined
  return async (input, init) => {
    if (requested) {
      if (retryStatus) return new Response(null, retryStatus)
      throw new DOMException('OpenRouter retry disabled', 'AbortError')
    }
    requested = true
    const response = await fetcher(input, init)
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      retryStatus = { status: response.status, statusText: response.statusText }
    }
    return response
  }
}

class OverlayFreeLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const
  readonly supportedUrls = { 'image/*': [/^https:\/\/[^/]+\/.+$/i] }

  constructor(private readonly config: OverlayFreeRouterOptions) {}

  get provider(): string {
    return this.config.modelId ?? OVERLAY_FREE_MODEL_ID
  }

  get modelId(): string {
    return this.config.modelId ?? OVERLAY_FREE_MODEL_ID
  }

  private clock(): number {
    return this.config.now?.() ?? Date.now()
  }

  private async routes(options: LanguageModelV4CallOptions): Promise<OverlayFreeRoute[]> {
    if (overlayFreePrivacyRequested(options)) throw new Error('overlay_free_zdr_unsupported')
    if (hasUnsupportedOverlayFreeMedia(options)) throw new Error('overlay_free_media_unsupported')
    if (hasInsecureOverlayFreeImageUrl(options)) throw new Error('overlay_free_image_url_requires_https')
    if (hasProviderExecutedOverlayFreeTool(options)) throw new Error('overlay_free_provider_tool_unsupported')
    const routes = await this.config.repository.listEligible(this.clock(), this.config.fallbackOnly)
    return routes
      .filter((route) => !this.config.fallbackOnly || route.transport === 'openrouter')
      .filter((route) => overlayFreeRouteSupports(parseOverlayFreeCapabilities(route) ?? {
        contextWindow: 0, maxOutputTokens: 0, supportsTools: false, supportsVision: false, supportsJson: false,
      }, options))
      .sort((a, b) => (a.transport === 'gateway' ? 0 : 1) - (b.transport === 'gateway' ? 0 : 1)
        || freeRoutePriority(a.modelId) - freeRoutePriority(b.modelId)
        || a.routeKey.localeCompare(b.routeKey))
  }

  private model(route: OverlayFreeRoute): Promise<LanguageModelV4> {
    return route.transport === 'gateway'
      ? this.config.providers.gateway(getGatewayModelId(route.modelId), route.provider)
      : this.config.providers.openrouter()
  }

  private async claim(route: OverlayFreeRoute) {
    return this.config.repository.claim(route.routeKey, crypto.randomUUID(), route.generation, 'user')
  }

  private async preflight(
    route: OverlayFreeRoute,
    leaseToken: string,
    options: LanguageModelV4CallOptions,
    deadline: number,
  ): Promise<{ route: OverlayFreeRoute; capabilities: FreeRouteCapabilities } | null> {
    let current: Awaited<ReturnType<typeof this.config.preflight>>
    try {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('overlay_free_deadline_exceeded')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        current = await Promise.race([
          this.config.preflight(route),
          new Promise<null>((_, reject) => {
            timer = setTimeout(() => reject(new Error('overlay_free_deadline_exceeded')), remaining)
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    } catch (_error) {
      await this.config.repository.cooldown(route.routeKey, leaseToken, this.clock())
      return null
    }
    if (!current) {
      await this.config.repository.settle({
        routeKey: route.routeKey, leaseToken, now: this.clock(),
        receipt: { safe: false, cost: null, reason: 'current catalog unavailable' },
        safe: false, cost: null, reason: 'current catalog unavailable',
      })
      return null
    }
    if (!overlayFreeRouteSupports(current.capabilities, options)) {
      await this.config.repository.cooldown(route.routeKey, leaseToken, this.clock())
      return null
    }
    return {
      route: { ...route, capabilitiesJson: JSON.stringify(current.capabilities) },
      capabilities: current.capabilities,
    }
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const deadline = Date.now() + 90_000
    const candidates = await this.routes(options)
    const attempts = [
      ...candidates.filter((route) => route.transport === 'gateway').slice(0, 3),
      ...candidates.filter((route) => route.transport === 'openrouter').slice(0, 1),
    ]
    let lastError: unknown = new Error('overlay_free_no_eligible_route')
    let capacityRejected = false
    let ambiguousAttempt = false
    let lastEmpty: LanguageModelV4GenerateResult | undefined
    for (const candidate of attempts) {
      if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('aborted')
      const claimed = await this.claim(candidate)
      if (claimed.status === 'busy' || claimed.status === 'cooldown') capacityRejected = true
      const route = claimed.route
      const token = route?.activeLeaseToken
      if (claimed.status !== 'claimed' || !route || !token) continue
      const checked = await this.preflight(route, token, options, deadline)
      if (!checked) continue
      const remaining = deadline - Date.now()
      const hasFallback = route.transport === 'gateway' && attempts.some((item) => item.transport === 'openrouter')
      const timeout = Math.min(FREE_ROUTE_TIMEOUT_MS, remaining - (hasFallback ? 15_000 : 0))
      if (timeout <= 0) {
        await this.config.repository.cooldown(route.routeKey, token, this.clock())
        continue
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      let generationStarted = false
      let settlementAttempted = false
      try {
        const model = await this.model(checked.route)
        if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('aborted')
        generationStarted = true
        const result = await model.doGenerate({
          ...trustedOverlayFreeOptions(options, checked.route, checked.capabilities),
          abortSignal: options.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal,
        })
        clearTimeout(timer)
        const value = assessFreeReceipt(result, {
          transport: route.transport, modelId: route.modelId, provider: route.provider,
        })
        const summary = receiptSummary(value)
        settlementAttempted = true
        await this.config.repository.settle({
          routeKey: route.routeKey, leaseToken: token, now: this.clock(), receipt: summary,
          safe: value.safe, cost: value.cost, actualModelId: value.actualModelId,
          actualProvider: value.actualProvider, reason: value.reason ?? undefined,
        })
        logUnsafeReceipt(checked.route, summary)
        if (value.actualModelId) this.config.onModelCaptured?.(value.actualModelId)
        const completedResult = {
          ...result,
          providerMetadata: overlayMetadata(result.providerMetadata, checked.route, summary),
        }
        if (shouldRetryEmptyCompletion(value.safe, result.content)) {
          lastEmpty = completedResult
          logger.warn('[overlay-free] empty completion, trying next route', { routeKey: checked.route.routeKey })
          continue
        }
        return completedResult
      } catch (error) {
        clearTimeout(timer)
        if (settlementAttempted) throw error
        lastError = error
        const failure = await settleGenerateFailure(
          this.config.repository, route, token, () => this.clock(), error, generationStarted,
          options.abortSignal?.aborted ?? false,
        )
        capacityRejected ||= failure.capacityRejected
        ambiguousAttempt ||= failure.ambiguousAttempt
        if (failure.rethrow) throw error
      }
    }
    return resultAfterGenerateAttempts(lastEmpty, capacityRejected, ambiguousAttempt, lastError)
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const deadline = Date.now() + 90_000
    const candidates = await this.routes(options)
    const attempts = [
      ...candidates.filter((route) => route.transport === 'gateway').slice(0, 3),
      ...candidates.filter((route) => route.transport === 'openrouter').slice(0, 1),
    ]
    return doOverlayFreeStream({
      options,
      candidates: attempts,
      deadline,
      repository: this.config.repository,
      claim: (route) => this.claim(route),
      preflight: (route, token, callOptions, deadlineAt) => this.preflight(route, token, callOptions, deadlineAt),
      model: (route) => this.model(route),
      confirmOpenRouterGenerationCost: this.config.confirmOpenRouterGenerationCost,
      now: () => this.clock(),
      onModelCaptured: this.config.onModelCaptured,
    })
  }
}

export function createOverlayFreeLanguageModel(options: OverlayFreeRouterOptions): LanguageModelV4 {
  return new OverlayFreeLanguageModel(options)
}

export function createOverlayFreeRepository(): OverlayFreeRepository {
  const secret = () => getInternalApiSecret()
  const required = <T>(value: T | null | undefined, operation: string): T => {
    if (value == null) throw new Error(`overlay_free_storage_${operation}_failed`)
    return value
  }
  return {
    listEligible: async (now, fallbackOnly) => {
      let state = required(await convex.query<{ generation: number; due: boolean }>(
        'platform/overlayFreeSafety:getRefreshStateByServer',
        { serverSecret: secret(), now },
        { throwOnError: true },
      ), 'refresh_state')
      const openRouter = fallbackOnly ? await convex.query<OverlayFreeRoute>(
        'platform/overlayFreeSafety:getByServer',
        { serverSecret: secret(), routeKey: `openrouter:${OPENROUTER_FREE_MODEL_ID}:openrouter` },
        { throwOnError: true },
      ) : null
      const needsRefresh = !fallbackOnly || !openRouter || openRouter.catalogExpiresAt <= now
      if (state.due && needsRefresh) {
        await refreshOverlayFreeCatalog({ onlyOpenRouter: fallbackOnly, timeoutMs: 75_000 })
        state = required(await convex.query<{ generation: number; due: boolean }>(
          'platform/overlayFreeSafety:getRefreshStateByServer',
          { serverSecret: secret(), now: Date.now() },
          { throwOnError: true },
        ), 'refresh_state')
      }
      await convex.mutation('platform/overlayFreeSafety:quarantineExpiredLeasesByServer', {
        serverSecret: secret(), now: Date.now(),
      }, { throwOnError: true })
      const routes = required(await convex.query<OverlayFreeRoute[]>(
        'platform/overlayFreeSafety:listEligibleByServer',
        {
          serverSecret: secret(),
          now: Date.now(),
          generation: state.generation,
          includeBusy: true,
          includeCooldown: true,
        },
        { throwOnError: true },
      ), 'route_list')
      if (!Array.isArray(routes)) throw new Error('overlay_free_storage_route_list_failed')
      return fallbackOnly ? routes.filter((route) => route.transport === 'openrouter') : routes
    },
    claim: async (routeKey, leaseToken, generation, purpose) => required(await convex.mutation<{
      status: string
      route: OverlayFreeRoute | null
    }>('platform/overlayFreeSafety:claimByServer', {
      serverSecret: secret(), routeKey, leaseToken, now: Date.now(),
      leaseMs: FREE_ROUTE_LEASE_MS, purpose, expectedGeneration: generation,
    }, { throwOnError: true }), 'claim'),
    settle: async (args) => {
      await convex.mutation('platform/overlayFreeSafety:settleByServer', {
        serverSecret: secret(), routeKey: args.routeKey, leaseToken: args.leaseToken,
        now: args.now, receiptJson: JSON.stringify(args.receipt), safe: args.safe,
        cost: args.cost, actualModelId: args.actualModelId,
        actualProvider: args.actualProvider, reason: args.reason,
      }, { throwOnError: true })
    },
    cooldown: async (routeKey, leaseToken, now) => {
      await convex.mutation('platform/overlayFreeSafety:cooldownByServer', {
        serverSecret: secret(), routeKey, leaseToken, now,
        cooldownUntil: now + FREE_ROUTE_COOLDOWN_MS, reason: 'pre-generation rejection',
      }, { throwOnError: true })
    },
  }
}

export async function createRuntimeOverlayFreeLanguageModel(options: {
  onModelCaptured?: (modelId: string) => void
  modelId?: typeof OVERLAY_FREE_MODEL_ID | typeof OPENROUTER_FREE_MODEL_ID
  fallbackOnly?: boolean
} = {}): Promise<LanguageModelV4> {
  return createOverlayFreeLanguageModel({
    repository: createOverlayFreeRepository(),
    preflight: preflightOverlayFreeRoute,
    onModelCaptured: options.onModelCaptured,
    modelId: options.modelId,
    fallbackOnly: options.fallbackOnly,
    confirmOpenRouterGenerationCost: async (generationId) => {
      const apiKey = await resolveOpenRouterApiKey()
      return apiKey ? confirmOpenRouterGenerationCost(generationId, apiKey) : false
    },
    providers: {
      gateway: async (modelId) => (await getOrCreateGateway())(modelId),
      openrouter: async () => {
        const apiKey = await resolveOpenRouterApiKey()
        if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured')
        const provider = createOpenRouter({ apiKey, compatibility: 'strict', fetch: createSingleRequestFetch(fetch) })
        return wrapLanguageModel({ model: provider.chat(OPENROUTER_FREE_MODEL_ID), middleware: [] })
      },
    },
  })
}
