import 'server-only'

import { FatalError } from 'workflow'
import { WORKSPACE_RUN_PERSONAL_MODEL_ERROR } from '@/shared/ai/workspace-run-model'

/** A workspace run refused a personal model: retrying cannot help, so the run ends at once with its own message. */
export function finalWorkspaceModelRefusal(error: unknown): never {
  if (error instanceof Error && error.message === WORKSPACE_RUN_PERSONAL_MODEL_ERROR) {
    throw new FatalError(WORKSPACE_RUN_PERSONAL_MODEL_ERROR)
  }
  throw error
}
