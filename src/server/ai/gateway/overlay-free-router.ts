import 'server-only'

import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import {
  asRecord,
  assessFreeReceipt,
  FREE_ROUTE_COOLDOWN_MS,
  FREE_ROUTE_LEASE_MS,
  FREE_ROUTE_TIMEOUT_MS,
  OPENROUTER_FREE_MODEL_ID,
  OVERLAY_FREE_MODEL_ID,
  type FreeRouteCapabilities,
} from '@/shared/ai/gateway/overlay-free-policy'
import { getOrCreateGateway, getGatewayModelId, resolveOpenRouterApiKey } from './gateway-runtime'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { preflightOverlayFreeRoute, refreshOverlayFreeCatalog } from './overlay-free-refresh'

export type OverlayFreeRoute = {
  routeKey: string
  transport: 'gateway' | 'openrouter'
  modelId: string
  provider: string
  capabilitiesJson: string
  pricingJson: string
  catalogVerifiedAt: number
  catalogExpiresAt: number
  generation: number
  canaryVerifiedAt?: number
  canaryExpiresAt?: number
  quarantineReason?: string
  cooldownUntil?: number
  activeLeaseToken?: string
  activeLeaseExpiresAt?: number
}

export type OverlayFreeRepository = {
  listEligible(now: number, fallbackOnly?: boolean): Promise<OverlayFreeRoute[]>
  claim(
    routeKey: string,
    leaseToken: string,
    generation: number,
    purpose: 'user' | 'canary',
  ): Promise<{ status: string; route: OverlayFreeRoute | null }>
  settle(args: {
    routeKey: string
    leaseToken: string
    now: number
    receipt: { safe: boolean; cost: number | null; reason?: string; actualModelId?: string; actualProvider?: string }
    safe: boolean
    cost: number | null
    actualModelId?: string
    actualProvider?: string
    reason?: string
  }): Promise<void>
  cooldown(routeKey: string, leaseToken: string, now: number): Promise<void>
}

export type OverlayFreeProviderFactory = {
  gateway(modelId: string, provider: string): Promise<LanguageModelV4>
  openrouter(): Promise<LanguageModelV4>
}

export type OverlayFreeRouterOptions = {
  repository: OverlayFreeRepository
  providers: OverlayFreeProviderFactory
  preflight: (route: OverlayFreeRoute) => Promise<{ capabilities: FreeRouteCapabilities } | null>
  now?: () => number
  onModelCaptured?: (modelId: string) => void
  modelId?: typeof OVERLAY_FREE_MODEL_ID | typeof OPENROUTER_FREE_MODEL_ID
  fallbackOnly?: boolean
}

type ReceiptSummary = {
  safe: boolean
  cost: number | null
  reason?: string
  actualModelId?: string
  actualProvider?: string
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

function parseCapabilities(route: OverlayFreeRoute): FreeRouteCapabilities | null {
  try {
    const value = asRecord(JSON.parse(route.capabilitiesJson))
    if (typeof value.contextWindow !== 'number' || !Number.isFinite(value.contextWindow) || value.contextWindow <= 0) return null
    return {
      contextWindow: value.contextWindow,
      maxOutputTokens: typeof value.maxOutputTokens === 'number' && Number.isFinite(value.maxOutputTokens) && value.maxOutputTokens > 0
        ? value.maxOutputTokens
        : value.contextWindow,
      supportsTools: value.supportsTools === true,
      supportsVision: value.supportsVision === true,
      supportsJson: value.supportsJson === true,
    }
  } catch (_error) {
    return null
  }
}

function privacyRequested(options: LanguageModelV4CallOptions): boolean {
  const providerOptions = asRecord(options.providerOptions)
  const gateway = asRecord(providerOptions.gateway)
  const openrouter = asRecord(providerOptions.openrouter)
  const openrouterProvider = asRecord(openrouter.provider)
  return gateway.zeroDataRetention === true ||
    openrouterProvider.zdr === true ||
    openrouterProvider.data_collection === 'deny'
}

function promptParts(options: LanguageModelV4CallOptions): Record<string, unknown>[] {
  return options.prompt.flatMap((message) => Array.isArray(message.content)
    ? message.content.map(asRecord)
    : [])
}

function toolResultParts(part: Record<string, unknown>): Record<string, unknown>[] {
  if (part.type !== 'tool-result') return []
  const output = asRecord(part.output)
  return output.type === 'content' && Array.isArray(output.value)
    ? output.value.map(asRecord)
    : []
}

function hasToolHistory(options: LanguageModelV4CallOptions): boolean {
  return options.tools?.length !== undefined && options.tools.length > 0 ||
    options.prompt.some((message) => message.role === 'tool') ||
    promptParts(options).some((part) => part.type === 'tool-call' || part.type === 'tool-result')
}

function hasProviderExecutedTool(options: LanguageModelV4CallOptions): boolean {
  return options.tools?.some((tool) => tool.type === 'provider') === true ||
    promptParts(options).some((part) => part.type === 'tool-call' && part.providerExecuted === true)
}

function mediaType(part: Record<string, unknown>): string {
  return typeof part.mediaType === 'string' ? part.mediaType.toLowerCase() : ''
}

function isImageMediaType(value: string): boolean {
  return value === 'image' || value.startsWith('image/')
}

function isImagePart(part: Record<string, unknown>): boolean {
  return ['file', 'reasoning-file', 'file-data', 'file-url'].includes(String(part.type)) &&
    isImageMediaType(mediaType(part)) ||
    part.type === 'image-data' || part.type === 'image-url'
}

function urlIsHttps(part: Record<string, unknown>): boolean {
  const data = asRecord(part.data)
  const candidate = typeof part.url === 'string' ? part.url : data.type === 'url' ? data.url : undefined
  if (typeof candidate !== 'string') return true
  try {
    return new URL(candidate).protocol === 'https:'
  } catch (_error) {
    return false
  }
}

function hasImagePrompt(options: LanguageModelV4CallOptions): boolean {
  return promptParts(options).some((part) =>
    isImagePart(part) || toolResultParts(part).some(isImagePart))
}

function hasUnsupportedMedia(options: LanguageModelV4CallOptions): boolean {
  return promptParts(options).some((part) => {
    const items = [part, ...toolResultParts(part)]
    return items.some((item) => {
      if (item.type === 'audio' || item.type === 'video') return true
      if (item.type === 'file' || item.type === 'reasoning-file' ||
        item.type === 'file-data' || item.type === 'file-url') {
        const type = mediaType(item)
        return !isImageMediaType(type) && type !== 'text' && !type.startsWith('text/')
      }
      if (item.type === 'image-data' || item.type === 'image-url') return false
      return false
    })
  })
}

function hasInsecureImageUrl(options: LanguageModelV4CallOptions): boolean {
  return promptParts(options).some((part) =>
    [part, ...toolResultParts(part)].some((item) => isImagePart(item) && !urlIsHttps(item)))
}

function promptText(options: LanguageModelV4CallOptions): string {
  return options.prompt.map((message) => {
    if (typeof message.content === 'string') return message.content
    return message.content.map((part) => {
      const value = asRecord(part)
      if (typeof value.text === 'string') return value.text
      if (value.type === 'tool-call') return JSON.stringify(value.input)
      if (value.type === 'tool-result') {
        const output = asRecord(value.output)
        if (output.type === 'content' && Array.isArray(output.value)) {
          return output.value.map((item) => {
            const content = asRecord(item)
            if (typeof content.text === 'string') return content.text
            const data = asRecord(content.data)
            return data.type === 'text' && typeof data.text === 'string' ? data.text : ''
          }).join('')
        }
        return JSON.stringify(output)
      }
      return ''
    }).join('')
  }).join('')
}

function imageCount(options: LanguageModelV4CallOptions): number {
  return promptParts(options).reduce((count, part) =>
    count + Number(isImagePart(part)) + toolResultParts(part).filter(isImagePart).length, 0)
}

function contextEstimate(options: LanguageModelV4CallOptions): number {
  const textBytes = new TextEncoder().encode(promptText(options)).byteLength
  const toolBytes = new TextEncoder().encode(JSON.stringify(options.tools ?? [])).byteLength
  return textBytes + toolBytes + imageCount(options) * 8192
}

function routeSupports(capabilities: FreeRouteCapabilities, options: LanguageModelV4CallOptions): boolean {
  if (hasToolHistory(options) && !capabilities.supportsTools) return false
  if (options.responseFormat?.type === 'json' && !capabilities.supportsJson) return false
  if (hasImagePrompt(options) && !capabilities.supportsVision) return false
  const output = options.maxOutputTokens ?? Math.min(4096, capabilities.maxOutputTokens)
  if (output > capabilities.maxOutputTokens) return false
  return contextEstimate(options) + output <= capabilities.contextWindow
}

function trustedOptions(
  options: LanguageModelV4CallOptions,
  route: OverlayFreeRoute,
  capabilities: FreeRouteCapabilities,
): LanguageModelV4CallOptions {
  const providerOptions: SharedV4ProviderOptions = route.transport === 'gateway'
    ? { gateway: { only: [route.provider], models: [] } }
    : { openrouter: { models: [], provider: { require_parameters: true } } }
  const prompt: LanguageModelV4CallOptions['prompt'] = options.prompt.map((message) => {
    if (message.role === 'system') {
      return { role: 'system', content: message.content }
    }
    const { providerOptions: _messageOptions, ...safeMessage } = message
    return safeMessage
  })
  return {
    ...options,
    prompt,
    maxOutputTokens: options.maxOutputTokens ?? Math.min(4096, capabilities.maxOutputTokens),
    headers: undefined,
    providerOptions,
  }
}

function isRateLimited(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'statusCode' in error && (error as { statusCode?: unknown }).statusCode === 429
}

function receiptSummary(value: ReturnType<typeof assessFreeReceipt>): ReceiptSummary {
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
  receipt: ReceiptSummary,
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

function logUnsafeReceipt(route: OverlayFreeRoute, receipt: ReceiptSummary): void {
  if (receipt.safe) return
  logger.warn('[overlay-free] unsafe provider receipt', {
    routeKey: route.routeKey,
    cost: receipt.cost,
    reason: receipt.reason ?? 'unsafe receipt',
  })
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
    if (privacyRequested(options)) throw new Error('overlay_free_zdr_unsupported')
    if (hasUnsupportedMedia(options)) throw new Error('overlay_free_media_unsupported')
    if (hasInsecureImageUrl(options)) throw new Error('overlay_free_image_url_requires_https')
    if (hasProviderExecutedTool(options)) throw new Error('overlay_free_provider_tool_unsupported')
    const routes = await this.config.repository.listEligible(this.clock(), this.config.fallbackOnly)
    return routes
      .filter((route) => !this.config.fallbackOnly || route.transport === 'openrouter')
      .filter((route) => routeSupports(parseCapabilities(route) ?? {
        contextWindow: 0, maxOutputTokens: 0, supportsTools: false, supportsVision: false, supportsJson: false,
      }, options))
      .sort((a, b) => (a.transport === 'gateway' ? 0 : 1) - (b.transport === 'gateway' ? 0 : 1))
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
      current = null
    }
    if (!current) {
      await this.config.repository.settle({
        routeKey: route.routeKey, leaseToken, now: this.clock(),
        receipt: { safe: false, cost: null, reason: 'current catalog unavailable' },
        safe: false, cost: null, reason: 'current catalog unavailable',
      })
      return null
    }
    if (!routeSupports(current.capabilities, options)) {
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
    for (const candidate of attempts) {
      if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('aborted')
      const claimed = await this.claim(candidate)
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
        break
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
          ...trustedOptions(options, checked.route, checked.capabilities),
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
        return {
          ...result,
          providerMetadata: overlayMetadata(result.providerMetadata, checked.route, summary),
        }
      } catch (error) {
        clearTimeout(timer)
        if (settlementAttempted) throw error
        lastError = error
        if (options.abortSignal?.aborted) {
          if (generationStarted) {
            await this.config.repository.settle({
              routeKey: route.routeKey, leaseToken: token, now: this.clock(),
              receipt: { safe: false, cost: null, reason: 'request aborted' },
              safe: false, cost: null, reason: 'request aborted',
            })
          } else {
            await this.config.repository.cooldown(route.routeKey, token, this.clock())
          }
          throw error
        }
        if (isRateLimited(error)) {
          await this.config.repository.cooldown(route.routeKey, token, this.clock())
        } else {
          await this.config.repository.settle({
            routeKey: route.routeKey, leaseToken: token, now: this.clock(),
            receipt: { safe: false, cost: null, reason: 'missing receipt' },
            safe: false, cost: null, reason: 'missing receipt',
          })
        }
      }
    }
    throw lastError
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const deadline = Date.now() + 90_000
    const candidates = await this.routes(options)
    const attempts = [
      ...candidates.filter((route) => route.transport === 'gateway').slice(0, 3),
      ...candidates.filter((route) => route.transport === 'openrouter').slice(0, 1),
    ]
    const repository = this.config.repository
    const onModelCaptured = this.config.onModelCaptured
    const now = () => this.clock()
    let safetyFailure = false
    const store = async <T>(operation: Promise<T>): Promise<T> => {
      try {
        return await operation
      } catch (error) {
        safetyFailure = true
        throw error
      }
    }
    let attemptIndex = 0
    type Attempt = {
      route: OverlayFreeRoute
      token: string
      reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>
      response: LanguageModelV4StreamResult
      timer: ReturnType<typeof setTimeout>
      controller: AbortController
      settled: boolean
    }
    const openNext = async (): Promise<Attempt | null> => {
      while (attemptIndex < attempts.length && Date.now() < deadline) {
        if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('aborted')
        const claimed = await this.claim(attempts[attemptIndex++]!)
        const route = claimed.route
        const token = route?.activeLeaseToken
        if (claimed.status !== 'claimed' || !route || !token) continue
        const checked = await this.preflight(route, token, options, deadline)
        if (!checked) continue
        const remaining = deadline - Date.now()
        const fallbackRemains = route.transport === 'gateway' && attempts.slice(attemptIndex).some((item) => item.transport === 'openrouter')
        const timeout = Math.min(FREE_ROUTE_TIMEOUT_MS, remaining - (fallbackRemains ? 15_000 : 0))
        if (timeout <= 0) {
          await repository.cooldown(route.routeKey, token, now())
          continue
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)
        try {
          const model = await this.model(checked.route)
          const response = await model.doStream({
            ...trustedOptions(options, checked.route, checked.capabilities),
            abortSignal: options.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal,
          })
          return { route: checked.route, token, reader: response.stream.getReader(), response, timer, controller, settled: false }
        } catch (error) {
          clearTimeout(timer)
          if (options.abortSignal?.aborted) {
            if (isRateLimited(error)) await store(repository.cooldown(route.routeKey, token, now()))
            else await store(repository.settle({
              routeKey: route.routeKey, leaseToken: token, now: now(),
              receipt: { safe: false, cost: null, reason: 'missing receipt' },
              safe: false, cost: null, reason: 'missing receipt',
            }))
            throw error
          }
          if (isRateLimited(error)) await store(repository.cooldown(route.routeKey, token, now()))
          else await store(repository.settle({
            routeKey: route.routeKey, leaseToken: token, now: now(),
            receipt: { safe: false, cost: null, reason: 'missing receipt' },
            safe: false, cost: null, reason: 'missing receipt',
          }))
        }
      }
      return null
    }

    const safeOpenNext = async () => {
      try {
        return await openNext()
      } catch (error) {
        safetyFailure = true
        throw error
      }
    }
    let current = await safeOpenNext()
    if (!current) throw new Error('overlay_free_no_eligible_route')
    let responseModelId: string | undefined
    let semantic = false
    let prelude: LanguageModelV4StreamPart[] = []
    let preludeSize = 0
    let closed = false
    const settleUnsafe = async (attempt: Attempt, reason: string) => {
      if (attempt.settled) return
      attempt.settled = true
      await store(repository.settle({
        routeKey: attempt.route.routeKey, leaseToken: attempt.token, now: now(),
        receipt: { safe: false, cost: null, reason }, safe: false, cost: null, reason,
      }))
    }
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      async pull(controller) {
        while (current && !closed) {
          try {
            if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('aborted')
            const next = await current.reader.read()
            if (next.done) {
              clearTimeout(current.timer)
              await settleUnsafe(current, 'missing receipt')
              if (semantic || options.abortSignal?.aborted) throw new Error('overlay_free_missing_stream_receipt')
              current = await openNext()
              responseModelId = undefined
              prelude = []
              preludeSize = 0
              if (!current) throw new Error('overlay_free_missing_stream_receipt')
              continue
            }
            const part = next.value
            if (part.type === 'error') {
              const error = part.error
              clearTimeout(current.timer)
              await current.reader.cancel().catch((_error) => undefined)
              if (isRateLimited(error) && !semantic) {
              if (!current.settled) {
                current.settled = true
                await store(repository.cooldown(current.route.routeKey, current.token, now()))
                }
              } else {
                await settleUnsafe(current, semantic ? 'stream error after output' : 'missing receipt')
              }
              if (semantic || options.abortSignal?.aborted) throw error
              current = await openNext()
              responseModelId = undefined
              prelude = []
              preludeSize = 0
              if (!current) throw error
              continue
            }
            if (part.type === 'finish') {
              clearTimeout(current.timer)
              const receipt = assessFreeReceipt({
                providerMetadata: part.providerMetadata,
                response: { modelId: responseModelId },
                usage: part.usage,
              }, {
                transport: current.route.transport,
                modelId: current.route.modelId,
                provider: current.route.provider,
              })
              const summary = receiptSummary(receipt)
              current.settled = true
              await store(repository.settle({
                routeKey: current.route.routeKey, leaseToken: current.token, now: now(),
                receipt: summary, safe: receipt.safe, cost: receipt.cost,
                actualModelId: receipt.actualModelId, actualProvider: receipt.actualProvider,
                reason: receipt.reason ?? undefined,
              }))
              logUnsafeReceipt(current.route, summary)
              if (receipt.actualModelId) onModelCaptured?.(receipt.actualModelId)
              for (const buffered of prelude) controller.enqueue(buffered)
              controller.enqueue({
                ...part,
                providerMetadata: overlayMetadata(part.providerMetadata, current.route, summary),
              })
              closed = true
              controller.close()
              return
            }
            if (part.type === 'stream-start' || part.type === 'response-metadata') {
              if (part.type === 'response-metadata' && typeof part.modelId === 'string') {
                responseModelId = part.modelId
              }
              const size = JSON.stringify(part).length
              preludeSize += size
              if (preludeSize > 64 * 1024 || prelude.length >= 32) {
                throw new Error('overlay_free_stream_prelude_too_large')
              }
              if (!semantic) {
                prelude.push(part)
                continue
              }
            }
            if (part.type === 'raw') continue
            if (!semantic) {
              semantic = true
              for (const buffered of prelude) controller.enqueue(buffered)
              prelude = []
              preludeSize = 0
            }
            controller.enqueue(part)
            return
          } catch (error) {
            if (current) {
              clearTimeout(current.timer)
              await current.reader.cancel().catch((_error) => undefined)
              if (!current.settled) {
                await settleUnsafe(current, semantic ? 'stream interrupted after output' : 'missing receipt')
              }
            }
            if (safetyFailure) {
              closed = true
              controller.error(error)
              return
            }
            if (!semantic && !options.abortSignal?.aborted) {
              current = await safeOpenNext()
              responseModelId = undefined
              prelude = []
              preludeSize = 0
              if (current) continue
            }
            closed = true
            controller.error(error)
            return
          }
        }
      },
      async cancel() {
        if (closed || !current || current.settled) return
        clearTimeout(current.timer)
        current.controller.abort()
        try {
          await current.reader.cancel()
        } finally {
          await settleUnsafe(current, 'stream cancelled')
        }
        closed = true
      },
    })
    return { ...current.response, stream }
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
      if (state.due) {
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
        { serverSecret: secret(), now: Date.now(), generation: state.generation },
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
