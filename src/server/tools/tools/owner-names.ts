import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { OverlayToolsOptions } from './types'

/**
 * Whose an item is, for a tool result: `you` for the caller's own, the creator's name for a teammate's, and nothing when
 * the creator is not a person in this workspace (an agent's memory owner, a workspace index). Lets the model say
 * "Maya's note" instead of guessing.
 */
export type OwnerLabel = 'you' | string

export async function ownerNamesFor(
  options: Pick<OverlayToolsOptions, 'userId' | 'workspaceId'>,
  userIds: ReadonlyArray<string | null | undefined>,
): Promise<(userId: string | null | undefined) => OwnerLabel | undefined> {
  const others = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id !== options.userId))]
  let names: Record<string, string> = {}
  if (others.length > 0 && options.workspaceId) {
    names = await convex.query<Record<string, string>>('collaboration/directory:memberNamesByServer', {
      serverSecret: getInternalApiSecret(),
      workspaceId: options.workspaceId,
      userId: options.userId,
      userIds: others,
    }).then((result) => result ?? {}).catch((_error) => ({}))
  }
  return (userId) => {
    if (!userId) return undefined
    return userId === options.userId ? 'you' : names[userId]
  }
}

/** `{ owner }` when known, else nothing, so results stay compact. */
export function ownerField(label: OwnerLabel | undefined): { owner?: OwnerLabel } {
  return label ? { owner: label } : {}
}
