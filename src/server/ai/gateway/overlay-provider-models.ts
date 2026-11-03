import 'server-only'

import type { GatewayCatalogModel } from '@/shared/ai/gateway/gateway-catalog'
import { isRetiredHostedModelId } from '@/shared/ai/gateway/model-types'

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
    if (model.type !== 'language' || seen.has(model.id) || isRetiredHostedModelId(model.id)) continue
    seen.add(model.id)
    models.push({ id: model.id, name: model.name })
  }

  return models
}
