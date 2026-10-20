import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'
import overlayAppConfig from '@/overlay.config'
import { getOverlayRuntimeConfig } from '@/server/config'
import {
  AVAILABLE_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
} from '@/shared/ai/gateway/model-data'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import { isPaidPlan } from '@/server/billing/billing-runtime'
import { logger } from '@/server/observability/logger'

type RuntimeConfigLoader = typeof getOverlayRuntimeConfig

export async function resolveRuntimeChatAllowlist(
  loadRuntimeConfig: RuntimeConfigLoader = getOverlayRuntimeConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Set<string> | null> {
  try {
    const runtimeConfig = await loadRuntimeConfig()
    return runtimeConfig.llm.modelAllowlist.length
      ? new Set(runtimeConfig.llm.modelAllowlist)
      : null
  } catch (error) {
    // Chat authorization should not be coupled to validation of unrelated
    // runtime sections such as Stripe or storage. Preserve any explicit model
    // restriction directly from the environment and continue fail-soft.
    logger.warn('[model-policy] Runtime config unavailable; using direct model allowlist fallback', {
      error: error instanceof Error ? error.message : String(error),
    })
    const modelIds = (env.LLM_MODEL_ALLOWLIST ?? '')
      .split(',')
      .map((modelId) => modelId.trim())
      .filter(Boolean)
    return modelIds.length ? new Set(modelIds) : null
  }
}

/**
 * Resolve discoverable model metadata, respecting deployment and extension policies.
 *
 * Load the live gateway catalog before reading AVAILABLE_MODELS, not just its fallbacks.
 */
export async function resolveCatalogModelIds(args: {
  entitlements: Entitlements | null
  /** When true, bypass the in-memory catalog TTL and re-fetch from AI Gateway. */
  forceCatalogRefresh?: boolean
}) {
  // Populate AVAILABLE_MODELS from the full AI Gateway catalog before reading it.
  // Fail soft to curated fallbacks if the catalog is unreachable.
  try {
    const { getGatewayCatalog } = await import('@/server/ai/gateway/gateway-catalog')
    await getGatewayCatalog(args.forceCatalogRefresh ?? false)
  } catch (error) {
    logger.warn('[model-policy] Gateway catalog unavailable; authorizing curated fallback models only', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const context = { entitlements: args.entitlements, user: null }
  const runtimeChatAllowlist = await resolveRuntimeChatAllowlist()

  const policyChatModels =
    overlayAppConfig.modelPolicy?.filterChatModels?.(AVAILABLE_MODELS, context) ??
    AVAILABLE_MODELS
  const chat = policyChatModels
    .filter((model) => !runtimeChatAllowlist || runtimeChatAllowlist.has(model.id))
    .map((model) => model.id)

  const image = (overlayAppConfig.modelPolicy?.filterImageModels?.(IMAGE_MODELS, context) ?? IMAGE_MODELS)
    .map((model) => model.id)
  const video = (overlayAppConfig.modelPolicy?.filterVideoModels?.(VIDEO_MODELS, context) ?? VIDEO_MODELS)
    .map((model) => model.id)

  return {
    chat: new Set(chat),
    image: new Set(image),
    video: new Set(video),
  }
}

export function applyCatalogEntitlements(
  catalog: Awaited<ReturnType<typeof resolveCatalogModelIds>>,
  entitlements: Pick<Entitlements, 'tier' | 'planKind'> | null,
) {
  const paid = Boolean(entitlements && isPaidPlan(entitlements))
  return {
    chat: new Set([...catalog.chat].filter((id) => paid || isFreeTierChatModelId(id))),
    image: new Set(paid ? catalog.image : []),
    video: new Set(paid ? catalog.video : []),
  }
}

/** Discovery never grants permission to generate with a model. */
export async function resolveAuthorizedModelIds(args: Parameters<typeof resolveCatalogModelIds>[0]) {
  return applyCatalogEntitlements(await resolveCatalogModelIds(args), args.entitlements)
}
