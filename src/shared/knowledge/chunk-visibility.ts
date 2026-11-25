import type { ResourceScope } from '@/shared/workspaces/resource-scope'

export type ChunkVisibility = 'owner' | 'workspace'

/**
 * Whether a searcher may see an indexed chunk, by the chunk's own visibility. A chunk marked `owner` is private to the
 * person it belongs to. `workspaceOnly` is a search made for a workspace context (a room others can read, a workspace
 * automation; internal/plans/TOOL_SCOPING_PLAN.md, T4): nothing private is returned, not even the searcher's own,
 * because the result will be shown to everyone there.
 *
 * A file chunk without a visibility is private: files are their uploader's until they are in Workspace
 * (internal/plans/WORKSPACE_PERSONAL_SEPARATION_PLAN.md, P7). Memory and message chunks from before visibility existed
 * keep the old rule (shared).
 */
export function chunkVisibleToSearch(args: {
  chunk: { userId: string; visibility?: ChunkVisibility; sourceKind?: string }
  viewerUserId: string
  workspaceOnly?: boolean
}): boolean {
  const visibility = args.chunk.visibility ?? (args.chunk.sourceKind === 'file' ? 'owner' : 'workspace')
  if (visibility !== 'owner') return true
  return !args.workspaceOnly && args.chunk.userId === args.viewerUserId
}

/**
 * The visibility a file's chunks carry: a file in Workspace is searchable by every member; a personal or archived one
 * only by its uploader.
 */
export function fileChunkVisibility(file: { scope?: ResourceScope; archivedAt?: number }): ChunkVisibility {
  return file.scope === 'workspace' && file.archivedAt === undefined ? 'workspace' : 'owner'
}
