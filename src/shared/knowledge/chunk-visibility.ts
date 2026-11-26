import type { ResourceScope } from '@/shared/workspaces/resource-scope'

export type ChunkVisibility = 'owner' | 'workspace'

/**
 * Whether a searcher may see an indexed chunk, by the chunk's own visibility. A chunk marked `owner` is private to the
 * person it belongs to. `workspaceOnly` is a search made for a workspace context (a room others can read, a workspace
 * automation; internal/develop/tool-catalog.md, "Rooms others can read"): nothing private is returned, not even the searcher's own,
 * because the result will be shown to everyone there.
 *
 * A file chunk without a visibility is private: files are their uploader's until they are in Workspace
 * (internal/develop/workspace-and-personal.md). Memory and message chunks from before visibility existed
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
export function fileChunkVisibility(file: { scope?: ResourceScope; archivedAt?: number; workspaceId?: string }): ChunkVisibility {
  return file.scope === 'workspace' && file.archivedAt === undefined && Boolean(file.workspaceId) ? 'workspace' : 'owner'
}

const WORKSPACE_FILES_OWNER_PREFIX = 'workspace-files:'

/**
 * The owner id a workspace's files are indexed under (P7): once for the workspace rather than per uploader, so one search
 * finds them for every member, a teammate's private chunks can't crowd them out, and they stay searchable after their
 * uploader leaves. Not a legal user id, like `agent-memory:` owners.
 */
export function workspaceFilesOwnerId(workspaceId: string): string {
  return `${WORKSPACE_FILES_OWNER_PREFIX}${workspaceId}`
}

/** Who a file's chunks are indexed under, and who may find them. */
export function fileChunkOwner(file: { userId: string; scope?: ResourceScope; archivedAt?: number; workspaceId?: string }): {
  userId: string
  visibility: ChunkVisibility
} {
  const visibility = fileChunkVisibility(file)
  return visibility === 'workspace'
    ? { userId: workspaceFilesOwnerId(file.workspaceId!), visibility }
    : { userId: file.userId, visibility }
}

/**
 * Which side of the workspace a search hit belongs to, for the model and the person: `personal` is visible only to the
 * person it belongs to, `workspace` to every member. Uses the same defaults as `chunkVisibleToSearch`.
 */
export function chunkScope(chunk: { visibility?: ChunkVisibility; sourceKind?: string }): 'personal' | 'workspace' {
  const visibility = chunk.visibility ?? (chunk.sourceKind === 'file' ? 'owner' : 'workspace')
  return visibility === 'owner' ? 'personal' : 'workspace'
}
