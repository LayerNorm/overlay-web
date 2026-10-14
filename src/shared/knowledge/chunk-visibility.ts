/**
 * Whether a searcher may see an indexed chunk, by the chunk's own visibility. A chunk marked `owner` is private to the
 * person it belongs to. `workspaceOnly` is a search made for a room others can read (docs/plans/TOOL_SCOPING_PLAN.md,
 * T4): nothing private is returned, not even the searcher's own, because the result will be shown to everyone there.
 */
export function chunkVisibleToSearch(args: {
  chunk: { userId: string; visibility?: 'owner' | 'workspace' }
  viewerUserId: string
  workspaceOnly?: boolean
}): boolean {
  if (args.chunk.visibility !== 'owner') return true
  return !args.workspaceOnly && args.chunk.userId === args.viewerUserId
}

/** The kinds a workspace-only search may read: files are indexed per person and have no shared copy yet. */
export function workspaceOnlySourceKinds<T extends 'file' | 'memory' | 'message'>(requested: readonly T[] | undefined): Array<Exclude<T, 'file'> | 'memory' | 'message'> {
  const kinds = requested ?? (['memory', 'message'] as const)
  return kinds.filter((kind): kind is Exclude<T, 'file'> => kind !== 'file') as Array<Exclude<T, 'file'> | 'memory' | 'message'>
}
