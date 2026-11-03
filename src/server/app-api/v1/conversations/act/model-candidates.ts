import 'server-only'

import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import { filterCatalogResources } from '@/server/authorization'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { isRetiredHostedModelId } from '@/shared/ai/gateway/model-types'

export async function prepareActModelCandidates(input: {
  authorization: AuthorizationService
  context: AppApiRouteContext
  modelId: string
  authorizedModelIds: ReadonlySet<string>
}): Promise<string[]> {
  if (isRetiredHostedModelId(input.modelId)) {
    throw new Error('MODEL_RETIRED: This hosted model is no longer available. Select a paid model to continue.')
  }
  if (isByokModelId(input.modelId)) return [input.modelId]
  const allowed = await filterCatalogResources({
    authorization: input.authorization, context: input.context,
    capability: 'models.use', resourceType: 'model', getId: (id: string) => id,
    values: input.authorizedModelIds.has(input.modelId) ? [input.modelId] : [],
  })
  if (!allowed.includes(input.modelId)) throw new Error('The selected model is not authorized for this workspace.')
  return [input.modelId]
}
