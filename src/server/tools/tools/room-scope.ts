import 'server-only'

import type { OverlayToolsOptions } from './types'

type ListScope = 'personal' | 'workspace'

/**
 * The scope a list tool actually reads. In a room others can read the answer is shown to everyone there, so the list is
 * limited to what the workspace shares whatever the model asked for; elsewhere it is what was asked (or everything the
 * caller can read when nothing was).
 */
export function roomListScope(options: Pick<OverlayToolsOptions, 'sharedRoom'>, requested: ListScope | undefined): ListScope | undefined {
  return options.sharedRoom ? 'workspace' : requested
}
