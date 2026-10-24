import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'
import type {
  FreeRouteCapabilities,
  OPENROUTER_FREE_MODEL_ID,
  OVERLAY_FREE_MODEL_ID,
} from '@/shared/ai/gateway/overlay-free-policy'

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

export type OverlayFreeReceiptSummary = {
  safe: boolean
  cost: number | null
  reason?: string
  actualModelId?: string
  actualProvider?: string
}

export type OverlayFreePreflight = {
  route: OverlayFreeRoute
  capabilities: FreeRouteCapabilities
}

export type OverlayFreeClaimResult = {
  status: string
  route: OverlayFreeRoute | null
}

export type OverlayFreeAttempt = {
  route: OverlayFreeRoute
  token: string
  reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>
  response: LanguageModelV4StreamResult
  timer: ReturnType<typeof setTimeout>
  controller: AbortController
  settled: boolean
}

export type OverlayFreePreparedAttempt = {
  route: OverlayFreeRoute
  token: string
  capabilities: FreeRouteCapabilities
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
}

export type OverlayFreeStreamContext = {
  options: LanguageModelV4CallOptions
  candidates: OverlayFreeRoute[]
  deadline: number
  repository: OverlayFreeRepository
  claim: (route: OverlayFreeRoute) => Promise<OverlayFreeClaimResult>
  preflight: (
    route: OverlayFreeRoute,
    leaseToken: string,
    options: LanguageModelV4CallOptions,
    deadline: number,
  ) => Promise<OverlayFreePreflight | null>
  model: (route: OverlayFreeRoute) => Promise<LanguageModelV4>
  now: () => number
  onModelCaptured?: (modelId: string) => void
}
