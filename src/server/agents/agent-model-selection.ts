import 'server-only'

import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { NEW_AGENT_DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { assertUserCanUseByokModel } from '@/server/ai/model-runtime'
import { resolveCatalogModelIds } from '@/server/ai/model-policy-authority'
import { WorkspaceAgentServiceError } from './workspace-agent-validation'

/**
 * An agent saved with a model Overlay does not offer fails its first task, so the
 * save is refused instead. Runs repeat this check because the catalog can change.
 */
export async function assertAgentModelSelectable(modelId: string, actorUserId: string, workspaceId: string): Promise<void> {
  if (isByokModelId(modelId)) {
    await assertUserCanUseByokModel(modelId, actorUserId, workspaceId).catch((_error: unknown) => {
      throw new WorkspaceAgentServiceError('validation', 'That connected model is not available to you in this workspace')
    })
    return
  }
  if (!(await resolveCatalogModelIds({ entitlements: null })).chat.has(modelId)) {
    throw new WorkspaceAgentServiceError(
      'validation',
      `"${modelId}" is not a model Overlay offers. Leave the model out to use the default (${NEW_AGENT_DEFAULT_MODEL_ID}), or use an exact model ID from the model list.`,
    )
  }
}
