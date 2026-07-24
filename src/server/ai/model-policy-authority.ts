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

export async function resolveAuthorizedModelIds(args: {
  entitlements: Entitlements | null
}) {
  const runtimeConfig = await getOverlayRuntimeConfig()
  const context = { entitlements: args.entitlements, user: null }
  const runtimeChatAllowlist = runtimeConfig.llm.modelAllowlist.length
    ? new Set(runtimeConfig.llm.modelAllowlist)
    : null

  const policyChatModels =
    overlayAppConfig.modelPolicy?.filterChatModels?.(AVAILABLE_MODELS, context) ??
    AVAILABLE_MODELS
  const chat = policyChatModels
    .filter((model) => !runtimeChatAllowlist || runtimeChatAllowlist.has(model.id))
    .filter((model) => Boolean(args.entitlements && isPaidPlan(args.entitlements)) ||
      isFreeTierChatModelId(model.id))
    .map((model) => model.id)

  const paid = Boolean(args.entitlements && isPaidPlan(args.entitlements))
  const image = paid
    ? (overlayAppConfig.modelPolicy?.filterImageModels?.(IMAGE_MODELS, context) ?? IMAGE_MODELS)
      .map((model) => model.id)
    : []
  const video = paid
    ? (overlayAppConfig.modelPolicy?.filterVideoModels?.(VIDEO_MODELS, context) ?? VIDEO_MODELS)
      .map((model) => model.id)
    : []

  return {
    chat: new Set(chat),
    image: new Set(image),
    video: new Set(video),
  }
}
