import 'server-only'

import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'
import { OVERLAY_FREE_CHAT_MODELS } from '@/shared/ai/gateway/model-data'

export type OverlayProviderModelSummary = {
  id: string
  name: string
}

export function overlayProviderDiscoveryModels(
  gatewayModels: readonly GatewayCatalogModel[],
): OverlayProviderModelSummary[] {
  const models: OverlayProviderModelSummary[] = []
  const seen = new Set<string>()

  for (const model of gatewayModels) {
    if (model.type !== 'language' || seen.has(model.id)) continue
    seen.add(model.id)
    models.push({ id: model.id, name: model.name })
  }

  for (const model of OVERLAY_FREE_CHAT_MODELS) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    models.push({ id: model.id, name: model.name })
  }

  return models
}
