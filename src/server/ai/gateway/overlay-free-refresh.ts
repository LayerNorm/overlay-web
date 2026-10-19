import 'server-only'

import { asRecord, freeEndpointCapabilities, freeRoutePriority, FREE_ROUTE_TTL_MS, FREE_ROUTE_COOLDOWN_MS, assessFreeReceipt } from '@/shared/ai/gateway/overlay-free-policy'
import { getGatewayModelId, getOrCreateGateway, resolveGatewayApiKey } from './gateway-runtime'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { OverlayFreeRoute } from './overlay-free-router'
import {
  currentGatewayEndpoint,
  currentOpenRouterFreeModel,
  gatewayModelHasZeroPricing,
  openRouterFreeModelHasZeroPricing,
  parseGatewayEndpoints,
  parseGatewayModels,
} from './overlay-free-catalog'

type CatalogFetcher = {
  gatewayModels: () => Promise<unknown>
  gatewayEndpoints: (modelId: string) => Promise<unknown>
  openrouterModels: () => Promise<unknown>
}

const defaultFetchers: CatalogFetcher = {
  gatewayModels: async () => {
    const response = await fetch('https://ai-gateway.vercel.sh/v1/models', { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`gateway_catalog:${response.status}`)
    return await response.json()
  },
  gatewayEndpoints: async (modelId) => {
    const response = await fetch(`https://ai-gateway.vercel.sh/v1/models/${encodeURIComponent(modelId)}/endpoints`, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`gateway_endpoints:${response.status}`)
    return await response.json()
  },
  openrouterModels: async () => {
    const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`openrouter_catalog:${response.status}`)
    return await response.json()
  },
}

function withinDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return Promise.reject(new Error('overlay_free_refresh_deadline_exceeded'))
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('overlay_free_refresh_deadline_exceeded')), remaining)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function routeFromEndpoint(model: Record<string, unknown>, endpoint: Record<string, unknown>, now: number, generation: number): OverlayFreeRoute | null {
  const modelId = typeof model.id === 'string' ? model.id : ''
  const provider = typeof endpoint.provider_name === 'string' ? endpoint.provider_name : ''
  const capabilities = freeEndpointCapabilities(endpoint)
  const pricing = asRecord(endpoint.pricing)
  if (!modelId || !provider || !capabilities || !gatewayModelHasZeroPricing(model)) return null
  if (!currentGatewayEndpoint({ data: { endpoints: [endpoint] } }, modelId, provider)) return null
  return {
    routeKey: `gateway:${modelId}:${provider}`,
    transport: 'gateway',
    modelId,
    provider,
    capabilitiesJson: JSON.stringify(capabilities),
    pricingJson: JSON.stringify(pricing),
    catalogVerifiedAt: now,
    catalogExpiresAt: now + FREE_ROUTE_TTL_MS,
    generation,
    canaryVerifiedAt: undefined,
    canaryExpiresAt: undefined,
  }
}

function openrouterRoute(model: Record<string, unknown>, now: number, generation: number): OverlayFreeRoute | null {
  const id = model.id
  const capabilities = freeEndpointCapabilities(model)
  const pricing = model.pricing
  if (typeof id !== 'string' || !openRouterFreeModelHasZeroPricing(model) || !capabilities) return null
  return {
    routeKey: `openrouter:${id}:openrouter`,
    transport: 'openrouter',
    modelId: id,
    provider: 'openrouter',
    capabilitiesJson: JSON.stringify(capabilities),
    pricingJson: JSON.stringify(pricing),
    catalogVerifiedAt: now,
    catalogExpiresAt: now + FREE_ROUTE_TTL_MS,
    generation,
  }
}

export async function preflightOverlayFreeRoute(
  route: OverlayFreeRoute,
  fetchers: CatalogFetcher = defaultFetchers,
) {
  if (route.transport === 'gateway') {
    const [modelPayload, endpointPayload] = await Promise.all([
      fetchers.gatewayModels(),
      fetchers.gatewayEndpoints(route.modelId),
    ])
    const model = parseGatewayModels(modelPayload).find((value) => value.id === route.modelId)
    const endpoint = currentGatewayEndpoint(endpointPayload, route.modelId, route.provider)
    if (!model || !gatewayModelHasZeroPricing(model) || !endpoint) return null
    return { capabilities: endpoint.capabilities }
  }
  const model = currentOpenRouterFreeModel(await fetchers.openrouterModels())
  return model ? { capabilities: model.capabilities } : null
}

export async function refreshOverlayFreeCatalog({
  now = Date.now(),
  fetchers = defaultFetchers,
  onlyOpenRouter = false,
  timeoutMs,
}: { now?: number; fetchers?: CatalogFetcher; onlyOpenRouter?: boolean; timeoutMs?: number } = {}) {
  const serverSecret = getInternalApiSecret()
  const lockToken = crypto.randomUUID()
  const lock = await convex.mutation<{ leaseToken: string; generation: number } | null>('platform/overlayFreeSafety:acquireRefreshLockByServer', {
    serverSecret, leaseToken: lockToken, now, leaseMs: 5 * 60 * 1000, retryMs: 5 * 60 * 1000,
  }, { throwOnError: true })
  if (!lock) return { refreshed: false, reason: 'locked' }
  const deadline = Date.now() + Math.min(timeoutMs ?? 200_000, 200_000)
  try {
    const candidates: OverlayFreeRoute[] = []
    let gatewayCatalogSucceeded = false
    try {
      if (onlyOpenRouter) throw new Error('gateway discovery skipped')
      for (const model of parseGatewayModels(await withinDeadline(fetchers.gatewayModels(), deadline))) {
        if (Date.now() >= deadline) throw new Error('overlay_free_refresh_deadline_exceeded')
        if (typeof model.id !== 'string' || !gatewayModelHasZeroPricing(model)) continue
        for (const endpoint of parseGatewayEndpoints(await withinDeadline(fetchers.gatewayEndpoints(model.id), deadline))) {
          const route = routeFromEndpoint(model, endpoint, Date.now(), lock.generation)
          if (route) candidates.push(route)
        }
      }
      if (Date.now() >= deadline) throw new Error('overlay_free_refresh_deadline_exceeded')
      gatewayCatalogSucceeded = true
    } catch (_error) {
      candidates.length = 0
    }
    let openrouter: OverlayFreeRoute[] = []
    let openrouterCatalogSucceeded = false
    try {
      openrouter = parseGatewayModels(await withinDeadline(fetchers.openrouterModels(), deadline))
        .map((value) => openrouterRoute(value, Date.now(), lock.generation))
        .filter((value): value is OverlayFreeRoute => value !== null)
      openrouterCatalogSucceeded = true
    } catch (_error) {
      openrouter = []
    }
    candidates.sort((a, b) => freeRoutePriority(a.modelId) - freeRoutePriority(b.modelId) || a.routeKey.localeCompare(b.routeKey))
    const routes = [...candidates.slice(0, 11), ...openrouter.slice(0, 1)]
    const preserveTransports = [
      ...(onlyOpenRouter || !gatewayCatalogSucceeded ? ['gateway' as const] : []),
      ...(!openrouterCatalogSucceeded ? ['openrouter' as const] : []),
    ]
    await convex.mutation('platform/overlayFreeSafety:publishByServer', {
      serverSecret, generation: lock.generation, refreshToken: lockToken, now: Date.now(),
      preserveTransports,
      routes: routes.map(({ routeKey, transport, modelId, provider, capabilitiesJson, pricingJson, catalogVerifiedAt, catalogExpiresAt, generation }) =>
        ({ routeKey, transport, modelId, provider, capabilitiesJson, pricingJson, catalogVerifiedAt, catalogExpiresAt, generation })),
    }, { throwOnError: true })

    const probed = new Map<string, number>()
    const gatewayEnabled = !onlyOpenRouter && Boolean(await resolveGatewayApiKey())
    for (const route of routes.filter((value) => value.transport === 'gateway')) {
      if (Date.now() >= deadline || !gatewayEnabled) break
      const leaseToken = crypto.randomUUID()
      const claimed = await convex.mutation<{ status: string; route: OverlayFreeRoute | null }>('platform/overlayFreeSafety:claimByServer', {
        serverSecret, routeKey: route.routeKey, leaseToken, now: Date.now(), leaseMs: 3 * 60 * 1000,
        purpose: 'canary', expectedGeneration: lock.generation, refreshToken: lockToken,
      }, { throwOnError: true })
      if (!claimed || claimed.status !== 'claimed' || !claimed.route) continue
      const preflight = await withinDeadline(preflightOverlayFreeRoute(claimed.route, fetchers), deadline).catch((_error) => null)
      if (!preflight) {
        await convex.mutation('platform/overlayFreeSafety:settleByServer', {
          serverSecret, routeKey: route.routeKey, leaseToken, now: Date.now(),
          receiptJson: JSON.stringify({ safe: false, cost: null, reason: 'preflight failed' }),
          safe: false, cost: null, reason: 'catalog price changed or unavailable',
        }, { throwOnError: true })
        continue
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        await convex.mutation('platform/overlayFreeSafety:cooldownByServer', {
          serverSecret, routeKey: route.routeKey, leaseToken, now: Date.now(),
          cooldownUntil: Date.now() + FREE_ROUTE_COOLDOWN_MS, reason: 'canary deadline',
        }, { throwOnError: true })
        continue
      }
      try {
        const gateway = await getOrCreateGateway()
        const result = await gateway(getGatewayModelId(claimed.route.modelId)).doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }] }],
          maxOutputTokens: 2,
          abortSignal: AbortSignal.timeout(Math.min(20_000, remaining)),
          providerOptions: { gateway: { only: [claimed.route.provider], models: [] } },
        })
        const receipt = assessFreeReceipt(result, { transport: 'gateway', modelId: claimed.route.modelId, provider: claimed.route.provider })
        await convex.mutation('platform/overlayFreeSafety:settleByServer', {
          serverSecret, routeKey: route.routeKey, leaseToken, now: Date.now(),
          receiptJson: JSON.stringify({ safe: receipt.safe, cost: receipt.cost, reason: receipt.reason, actualModelId: receipt.actualModelId, actualProvider: receipt.actualProvider }), safe: receipt.safe, cost: receipt.cost,
          actualModelId: receipt.actualModelId, actualProvider: receipt.actualProvider, reason: receipt.reason ?? undefined,
        }, { throwOnError: true })
        if (receipt.safe) probed.set(route.routeKey, Date.now())
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 429) {
          await convex.mutation('platform/overlayFreeSafety:cooldownByServer', {
            serverSecret, routeKey: route.routeKey, leaseToken, now: Date.now(),
            cooldownUntil: Date.now() + 60_000, reason: 'canary rate limit',
          }, { throwOnError: true })
        } else {
          await convex.mutation('platform/overlayFreeSafety:settleByServer', {
            serverSecret, routeKey: route.routeKey, leaseToken, now: Date.now(),
            receiptJson: JSON.stringify({ safe: false, cost: null, reason: 'missing receipt' }), safe: false, cost: null,
            reason: 'missing receipt',
          }, { throwOnError: true })
        }
      }
    }
    await convex.mutation('platform/overlayFreeSafety:publishByServer', {
      serverSecret, generation: lock.generation, refreshToken: lockToken, now: Date.now(),
      preserveTransports,
      routes: routes.map((route) => {
        const verifiedAt = probed.get(route.routeKey)
        return {
          routeKey: route.routeKey, transport: route.transport, modelId: route.modelId, provider: route.provider,
          capabilitiesJson: route.capabilitiesJson, pricingJson: route.pricingJson,
          catalogVerifiedAt: route.catalogVerifiedAt, catalogExpiresAt: route.catalogExpiresAt, generation: route.generation,
          canaryVerifiedAt: verifiedAt,
          canaryExpiresAt: verifiedAt ? verifiedAt + FREE_ROUTE_TTL_MS : undefined,
        }
      }),
    }, { throwOnError: true })
    await convex.mutation('platform/overlayFreeSafety:releaseRefreshLockByServer', {
      serverSecret, leaseToken: lockToken, now: Date.now(),
      success: gatewayCatalogSucceeded || openrouterCatalogSucceeded,
    }, { throwOnError: true })
    return { refreshed: true, routes: routes.length, generation: lock.generation }
  } catch (error) {
    await convex.mutation('platform/overlayFreeSafety:invalidateGenerationByServer', {
      serverSecret, generation: lock.generation, refreshToken: lockToken, now: Date.now(),
    }, { throwOnError: true }).catch((_error) => undefined)
    await convex.mutation('platform/overlayFreeSafety:releaseRefreshLockByServer', {
      serverSecret, leaseToken: lockToken, now: Date.now(), success: false,
    }, { throwOnError: true }).catch((_error) => undefined)
    throw error
  }
}
