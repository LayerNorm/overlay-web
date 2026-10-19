import 'server-only'

import type { LanguageModelV4 } from '@ai-sdk/provider'
import { asRecord, freeEndpointCapabilities, freeRoutePriority, FREE_ROUTE_TTL_MS, FREE_ROUTE_COOLDOWN_MS, assessFreeReceipt } from '@/shared/ai/gateway/overlay-free-policy'
import { getGatewayModelId, getOrCreateGateway, resolveGatewayApiKey } from './gateway-runtime'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { OverlayFreeRoute } from './overlay-free-router-contracts'
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
  if (!currentGatewayEndpoint({ data: { id: modelId, endpoints: [endpoint] } }, modelId, provider)) return null
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

type RefreshStore = Pick<typeof convex, 'mutation'>
type GatewayModelFactory = (modelId: string) => LanguageModelV4
type RefreshLock = { leaseToken: string; generation: number }
type CatalogDiscovery = {
  gatewayCandidates: OverlayFreeRoute[]
  openrouterRoutes: OverlayFreeRoute[]
  gatewaySucceeded: boolean
  openrouterSucceeded: boolean
}

type RefreshContext = {
  serverSecret: string
  lock: RefreshLock
  deadline: number
  fetchers: CatalogFetcher
  onlyOpenRouter: boolean
  store: RefreshStore
}

type CanaryContext = RefreshContext & {
  gateway: GatewayModelFactory | null
}

async function discoverOpenRouter(
  fetchers: CatalogFetcher,
  deadline: number,
  generation: number,
): Promise<{ routes: OverlayFreeRoute[]; succeeded: boolean }> {
  try {
    const payload = await withinDeadline(fetchers.openrouterModels(), deadline)
    const routes = parseGatewayModels(payload)
      .map((value) => openrouterRoute(value, Date.now(), generation))
      .filter((value): value is OverlayFreeRoute => value !== null)
    return { routes, succeeded: true }
  } catch (_error) {
    return { routes: [], succeeded: false }
  }
}

async function discoverGateway(
  fetchers: CatalogFetcher,
  deadline: number,
  generation: number,
  onlyOpenRouter: boolean,
): Promise<{ routes: OverlayFreeRoute[]; succeeded: boolean }> {
  if (onlyOpenRouter) return { routes: [], succeeded: false }
  try {
    const routes: OverlayFreeRoute[] = []
    const models = parseGatewayModels(await withinDeadline(fetchers.gatewayModels(), deadline))
    for (const model of models) {
      if (Date.now() >= deadline) throw new Error('overlay_free_refresh_deadline_exceeded')
      if (typeof model.id !== 'string' || !gatewayModelHasZeroPricing(model)) continue
      const endpoints = parseGatewayEndpoints(
        await withinDeadline(fetchers.gatewayEndpoints(model.id), deadline),
      )
      for (const endpoint of endpoints) {
        const route = routeFromEndpoint(model, endpoint, Date.now(), generation)
        if (route) routes.push(route)
      }
    }
    if (Date.now() >= deadline) throw new Error('overlay_free_refresh_deadline_exceeded')
    return { routes, succeeded: true }
  } catch (_error) {
    return { routes: [], succeeded: false }
  }
}

async function discoverCatalog(
  fetchers: CatalogFetcher,
  deadline: number,
  generation: number,
  onlyOpenRouter: boolean,
): Promise<CatalogDiscovery> {
  const openrouter = await discoverOpenRouter(fetchers, deadline, generation)
  const gateway = await discoverGateway(fetchers, deadline, generation, onlyOpenRouter)
  return {
    gatewayCandidates: gateway.routes,
    openrouterRoutes: openrouter.routes,
    gatewaySucceeded: gateway.succeeded,
    openrouterSucceeded: openrouter.succeeded,
  }
}

function prioritizedRoutes(discovery: CatalogDiscovery): OverlayFreeRoute[] {
  const gatewayRoutes = discovery.gatewayCandidates.sort((a, b) =>
    freeRoutePriority(a.modelId) - freeRoutePriority(b.modelId) ||
    a.routeKey.localeCompare(b.routeKey))
  return [...gatewayRoutes.slice(0, 11), ...discovery.openrouterRoutes.slice(0, 1)]
}

function preservedTransports(
  discovery: CatalogDiscovery,
  onlyOpenRouter: boolean,
): Array<'gateway' | 'openrouter'> {
  return [
    ...(onlyOpenRouter || !discovery.gatewaySucceeded ? ['gateway' as const] : []),
    ...(!discovery.openrouterSucceeded ? ['openrouter' as const] : []),
  ]
}

async function publishRoutes(
  context: RefreshContext,
  routes: OverlayFreeRoute[],
  preserveTransports: Array<'gateway' | 'openrouter'>,
  probed?: Map<string, number>,
): Promise<void> {
  const { serverSecret, lock, store } = context
  await store.mutation('platform/overlayFreeSafety:publishByServer', {
    serverSecret,
    generation: lock.generation,
    refreshToken: lock.leaseToken,
    now: Date.now(),
    preserveTransports,
    routes: routes.map((route) => {
      const verifiedAt = probed?.get(route.routeKey)
      return {
        routeKey: route.routeKey,
        transport: route.transport,
        modelId: route.modelId,
        provider: route.provider,
        capabilitiesJson: route.capabilitiesJson,
        pricingJson: route.pricingJson,
        catalogVerifiedAt: route.catalogVerifiedAt,
        catalogExpiresAt: route.catalogExpiresAt,
        generation: route.generation,
        canaryVerifiedAt: verifiedAt,
        canaryExpiresAt: verifiedAt ? verifiedAt + FREE_ROUTE_TTL_MS : undefined,
      }
    }),
  }, { throwOnError: true })
}

async function cooldownCanary(
  context: CanaryContext,
  routeKey: string,
  leaseToken: string,
  reason: string,
  duration: number = FREE_ROUTE_COOLDOWN_MS,
): Promise<void> {
  const now = Date.now()
  await context.store.mutation('platform/overlayFreeSafety:cooldownByServer', {
    serverSecret: context.serverSecret,
    routeKey,
    leaseToken,
    now,
    cooldownUntil: now + duration,
    reason,
  }, { throwOnError: true })
}

async function failCanaryReceipt(
  context: CanaryContext,
  routeKey: string,
  leaseToken: string,
  reason: string,
): Promise<void> {
  await context.store.mutation('platform/overlayFreeSafety:settleByServer', {
    serverSecret: context.serverSecret,
    routeKey,
    leaseToken,
    now: Date.now(),
    receiptJson: JSON.stringify({ safe: false, cost: null, reason }),
    safe: false,
    cost: null,
    reason,
  }, { throwOnError: true })
}

async function probeGatewayRoute(
  context: CanaryContext,
  route: OverlayFreeRoute,
): Promise<number | null> {
  const { serverSecret, lock, deadline, store, fetchers, gateway } = context
  if (!gateway || Date.now() >= deadline) return null
  const leaseToken = crypto.randomUUID()
  const claimed = await store.mutation<{ status: string; route: OverlayFreeRoute | null }>(
    'platform/overlayFreeSafety:claimByServer',
    {
      serverSecret,
      routeKey: route.routeKey,
      leaseToken,
      now: Date.now(),
      leaseMs: 3 * 60 * 1000,
      purpose: 'canary',
      expectedGeneration: lock.generation,
      refreshToken: lock.leaseToken,
    },
    { throwOnError: true },
  )
  if (!claimed || claimed.status !== 'claimed' || !claimed.route) return null
  let preflight: Awaited<ReturnType<typeof preflightOverlayFreeRoute>>
  try {
    preflight = await withinDeadline(preflightOverlayFreeRoute(claimed.route, fetchers), deadline)
  } catch (_error) {
    await cooldownCanary(context, route.routeKey, leaseToken, 'catalog unavailable before canary')
    return null
  }
  if (!preflight) {
    await failCanaryReceipt(context, route.routeKey, leaseToken, 'catalog price changed or unavailable')
    return null
  }
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    await cooldownCanary(context, route.routeKey, leaseToken, 'canary deadline')
    return null
  }
  try {
    const result = await gateway(getGatewayModelId(claimed.route.modelId)).doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }] }],
      maxOutputTokens: 2,
      abortSignal: AbortSignal.timeout(Math.min(20_000, remaining)),
      providerOptions: { gateway: { only: [claimed.route.provider], models: [] } },
    })
    const receipt = assessFreeReceipt(result, {
      transport: 'gateway',
      modelId: claimed.route.modelId,
      provider: claimed.route.provider,
    })
    await store.mutation('platform/overlayFreeSafety:settleByServer', {
      serverSecret,
      routeKey: route.routeKey,
      leaseToken,
      now: Date.now(),
      receiptJson: JSON.stringify({
        safe: receipt.safe,
        cost: receipt.cost,
        reason: receipt.reason,
        actualModelId: receipt.actualModelId,
        actualProvider: receipt.actualProvider,
      }),
      safe: receipt.safe,
      cost: receipt.cost,
      actualModelId: receipt.actualModelId,
      actualProvider: receipt.actualProvider,
      reason: receipt.reason ?? undefined,
    }, { throwOnError: true })
    return receipt.safe ? Date.now() : null
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 429) {
      await cooldownCanary(context, route.routeKey, leaseToken, 'canary rate limit', 60_000)
    } else {
      await failCanaryReceipt(context, route.routeKey, leaseToken, 'missing receipt')
    }
    return null
  }
}

async function probeGatewayRoutes(
  context: RefreshContext,
  routes: OverlayFreeRoute[],
  gatewayCandidates: OverlayFreeRoute[],
  loadGateway: () => Promise<GatewayModelFactory | null>,
): Promise<Map<string, number>> {
  const probed = new Map<string, number>()
  const gateway = !context.onlyOpenRouter && gatewayCandidates.length ? await loadGateway() : null
  const canaryContext: CanaryContext = { ...context, gateway }
  for (const route of routes.filter((value) => value.transport === 'gateway')) {
    if (Date.now() >= context.deadline || !gateway) break
    const verifiedAt = await probeGatewayRoute(canaryContext, route)
    if (verifiedAt !== null) probed.set(route.routeKey, verifiedAt)
  }
  return probed
}

export async function refreshOverlayFreeCatalog({
  now = Date.now(),
  fetchers = defaultFetchers,
  onlyOpenRouter = false,
  timeoutMs,
  store = convex,
  loadGateway = async () => await resolveGatewayApiKey() ? await getOrCreateGateway() : null,
}: {
  now?: number
  fetchers?: CatalogFetcher
  onlyOpenRouter?: boolean
  timeoutMs?: number
  store?: Pick<typeof convex, 'mutation'>
  loadGateway?: () => Promise<((modelId: string) => LanguageModelV4) | null>
} = {}) {
  const serverSecret = getInternalApiSecret()
  const lockToken = crypto.randomUUID()
  const lock = await store.mutation<{ leaseToken: string; generation: number } | null>('platform/overlayFreeSafety:acquireRefreshLockByServer', {
    serverSecret, leaseToken: lockToken, now, leaseMs: 5 * 60 * 1000, retryMs: 5 * 60 * 1000,
  }, { throwOnError: true })
  if (!lock) return { refreshed: false, reason: 'locked' }
  const deadline = Date.now() + Math.min(timeoutMs ?? 200_000, 200_000)
  const context: RefreshContext = {
    serverSecret,
    lock,
    deadline,
    fetchers,
    onlyOpenRouter,
    store,
  }
  try {
    const discovery = await discoverCatalog(fetchers, deadline, lock.generation, onlyOpenRouter)
    const routes = prioritizedRoutes(discovery)
    const preserveTransports = preservedTransports(discovery, onlyOpenRouter)
    await publishRoutes(context, routes, preserveTransports)

    const probed = await probeGatewayRoutes(
      context,
      routes,
      discovery.gatewayCandidates,
      loadGateway,
    )
    await publishRoutes(context, routes, preserveTransports, probed)
    await store.mutation('platform/overlayFreeSafety:releaseRefreshLockByServer', {
      serverSecret, leaseToken: lockToken, now: Date.now(),
      success: (discovery.gatewaySucceeded || onlyOpenRouter) && discovery.openrouterSucceeded,
      partial: onlyOpenRouter,
    }, { throwOnError: true })
    return { refreshed: true, routes: routes.length, generation: lock.generation }
  } catch (error) {
    await store.mutation('platform/overlayFreeSafety:invalidateGenerationByServer', {
      serverSecret, generation: lock.generation, refreshToken: lockToken, now: Date.now(),
    }, { throwOnError: true }).catch((_error) => undefined)
    await store.mutation('platform/overlayFreeSafety:releaseRefreshLockByServer', {
      serverSecret, leaseToken: lockToken, now: Date.now(), success: false,
    }, { throwOnError: true }).catch((_error) => undefined)
    throw error
  }
}
