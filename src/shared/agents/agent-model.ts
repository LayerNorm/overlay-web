import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'

/**
 * Agents created for the removed third-party agent feature kept a `byo/<adapter>#<model>` model id. They now run on
 * Overlay's own harness; until someone picks a model for them they use the default model.
 */
const RETIRED_HARNESS_MODEL_PREFIX = 'byo/'

export function isRetiredHarnessModelId(modelId: string): boolean {
  return modelId.startsWith(RETIRED_HARNESS_MODEL_PREFIX)
}

/** The model a native turn should use for an agent's saved model id. */
export function nativeAgentModelId(modelId: string): string {
  return isRetiredHarnessModelId(modelId) ? DEFAULT_MODEL_ID : modelId
}
