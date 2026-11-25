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

/** What a by-id read or edit returns when a workspace context asks for a Personal item. */
export const ROOM_PERSONAL_ITEM_ERROR =
  'That item is Personal. In a room others can read, or a workspace automation, only Workspace items can be read or changed. Its owner can move it to Workspace.'

/**
 * Whether a by-id read or edit must refuse this item: in a workspace context (a room others can read, a workspace
 * automation) only Workspace items are reachable, whoever the caller is. A missing scope means Personal.
 */
export function refusesRoomItem(options: Pick<OverlayToolsOptions, 'sharedRoom'>, item: { scope?: string | null }): boolean {
  return options.sharedRoom === true && item.scope !== 'workspace'
}

/**
 * Where a new item goes. In a workspace context it is Workspace whatever was asked, so what an agent makes there is
 * shared rather than landing in its summoner's or automation owner's Personal; elsewhere it is what was asked (Personal
 * when nothing was).
 */
export function roomCreateScope(options: Pick<OverlayToolsOptions, 'sharedRoom'>, requested: ListScope | undefined): ListScope {
  return options.sharedRoom ? 'workspace' : requested ?? 'personal'
}
