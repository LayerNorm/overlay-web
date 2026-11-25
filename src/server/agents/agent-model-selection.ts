import 'server-only'

import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { NEW_AGENT_DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { assertUserCanUseByokModel } from '@/server/ai/model-runtime'
import { WORKSPACE_RUN_PERSONAL_MODEL_ERROR } from '@/shared/ai/workspace-run-model'
import { resolveCatalogModelIds } from '@/server/ai/model-policy-authority'
import { WorkspaceAgentServiceError } from './workspace-agent-validation'

/**
 * An agent saved with a model Overlay does not offer fails its first task, so the
 * save is refused instead. Runs repeat this check because the catalog can change.
 */
export const WORKSPACE_AGENT_PERSONAL_MODEL_MESSAGE =
  'Workspace agents can only use Overlay models or the workspace\'s own providers. Add this provider in Settings → Providers while in Workspace mode, or pick another model.'

/**
 * A workspace agent works for everyone, so it may not run on anyone's personal key or subscription
 * (`visibility: 'workspace'`); a creator-only agent may use its creator's.
 */
export async function assertAgentModelSelectable(
  modelId: string,
  actorUserId: string,
  workspaceId: string,
  visibility: 'workspace' | 'creator' = 'workspace',
): Promise<void> {
  if (isByokModelId(modelId)) {
    await assertUserCanUseByokModel(modelId, actorUserId, workspaceId, { workspaceOnly: visibility === 'workspace' })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === WORKSPACE_RUN_PERSONAL_MODEL_ERROR) {
          throw new WorkspaceAgentServiceError('validation', WORKSPACE_AGENT_PERSONAL_MODEL_MESSAGE)
        }
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
