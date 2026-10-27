import 'server-only'

import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import { filterCatalogResources } from '@/server/authorization'
import { isGatewayCreditLow } from '@/server/ai/gateway/gateway-credits'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { modelUsesAiGatewayTransport } from '@/shared/ai/gateway/model-data'
import { getChatModelFallbackCandidates, getLowCreditFallbackAttemptModelIds } from '@/shared/ai/gateway/model-fallbacks'
import { MAX_ACT_MODEL_ATTEMPTS } from './route-helpers'

export async function prepareActModelCandidates(input: {
  authorization: AuthorizationService
  context: AppApiRouteContext
  modelId: string
  paid: boolean
  onlyAllowZdrModels: boolean
  requiresVision: boolean
  authorizedModelIds: ReadonlySet<string>
}): Promise<string[]> {
  if (isByokModelId(input.modelId)) return [input.modelId]
  const options = {
    modelId: input.modelId, paid: input.paid,
    onlyAllowZdrModels: input.paid && input.onlyAllowZdrModels,
    requiresVision: input.requiresVision,
  }
  const fallbackIds = getChatModelFallbackCandidates({ ...options, maxCandidates: MAX_ACT_MODEL_ATTEMPTS - 1 })
    .filter(id => input.authorizedModelIds.has(id))
  const lowCredit = modelUsesAiGatewayTransport(input.modelId) && !options.onlyAllowZdrModels
    && await isGatewayCreditLow()
  const candidates = lowCredit
    ? getLowCreditFallbackAttemptModelIds({ ...options, paidFallbackModelIds: fallbackIds, maxCandidates: MAX_ACT_MODEL_ATTEMPTS })
    : [input.modelId, ...fallbackIds]
  const allowed = await filterCatalogResources({
    authorization: input.authorization, context: input.context,
    capability: 'models.use', resourceType: 'model', getId: (id: string) => id,
    values: [...new Set(candidates)].filter(id => input.authorizedModelIds.has(id)),
  })
  if (!allowed.length) throw new Error('No authorized model candidates are available.')
  return allowed.slice(0, MAX_ACT_MODEL_ATTEMPTS)
}
