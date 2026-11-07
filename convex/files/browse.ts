import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from '../_generated/server'
import { getReadableRow, listScopedRows } from '../lib/resourceScope'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { browserFile, browserFileSummary, updateFileFor } from './files'

/** Rows read per source for the live tree, newest first. */
const TREE_SCAN_LIMIT = 300

const viewArg = v.optional(v.union(v.literal('personal'), v.literal('workspace')))

async function viewerOrNull(ctx: QueryCtx, workspaceId: string) {
  try {
    return await requireNativeWorkspace(ctx, workspaceId)
  } catch {
    return null
  }
}

/**
 * The live file tree (files, folders, notes and outputs) the signed-in member can see in a workspace view. Omitting
 * the view lists everything active: their own rows plus other members' workspace-scoped ones. Rows carry metadata
 * and a note preview, never full text or storage keys; text loads per file.
 */
export const list = query({
  args: { workspaceId: v.string(), view: viewArg },
  handler: async (ctx, { workspaceId, view }) => {
    const viewer = await viewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    const rows = await listScopedRows(ctx, {
      userId: viewer.userId,
      workspaceId,
      view,
      fetchMine: async () => await ctx.db.query('files')
        .withIndex('by_workspaceId_userId_updatedAt', (q) => q.eq('workspaceId', workspaceId).eq('userId', viewer.userId))
        .order('desc').take(TREE_SCAN_LIMIT),
      fetchShared: async (ws) => await ctx.db.query('files')
        .withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace').eq('archivedAt', undefined))
        .take(TREE_SCAN_LIMIT),
    })
    return rows
      .filter((row) => !row.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(browserFileSummary)
  },
})

/** Rows read per source when listing one folder's children. */
const CHILDREN_SCAN_LIMIT = 500

/**
 * One folder's readable children in a view (the root when `parentId` is null), for resolving relative links in a
 * markdown file: metadata only, at most 500 per source, the same read rules as the tree.
 */
export const children = query({
  args: { workspaceId: v.string(), parentId: v.union(v.string(), v.null()), view: v.union(v.literal('personal'), v.literal('workspace')) },
  handler: async (ctx, { workspaceId, parentId, view }) => {
    const viewer = await viewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    const rows = await listScopedRows(ctx, {
      userId: viewer.userId,
      workspaceId,
      view,
      fetchMine: async () => await ctx.db.query('files')
        .withIndex('by_workspaceId_userId_parentId_updatedAt', (q) =>
          q.eq('workspaceId', workspaceId).eq('userId', viewer.userId).eq('parentId', parentId ?? undefined))
        .take(CHILDREN_SCAN_LIMIT),
      fetchShared: async (ws) => parentId
        ? (await ctx.db.query('files').withIndex('by_parentId', (q) => q.eq('parentId', parentId)).take(CHILDREN_SCAN_LIMIT))
          .filter((row) => row.workspaceId === ws && row.scope === 'workspace')
        : (await ctx.db.query('files')
          .withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace').eq('archivedAt', undefined))
          .take(CHILDREN_SCAN_LIMIT)).filter((row) => row.parentId === undefined),
    })
    return rows.filter((row) => !row.deletedAt).map(browserFileSummary)
  },
})

/** One readable file with its inline text, or null when it is gone or the member lost access. */
export const get = query({
  args: { workspaceId: v.string(), fileId: v.id('files') },
  handler: async (ctx, { workspaceId, fileId }) => {
    const viewer = await viewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    const row = await getReadableRow(ctx, { row: await ctx.db.get(fileId), userId: viewer.userId, workspaceId })
    return row && !row.deletedAt ? browserFile(row) : null
  },
})

export const rename = mutation({
  args: { workspaceId: v.string(), fileId: v.id('files'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, fileId, name }) => {
    const viewer = await requireNativeWorkspace(ctx, workspaceId)
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 255) throw new Error('INVALID_NAME')
    await updateFileFor(ctx, { userId: viewer.userId, workspaceId, fileId, name: trimmed })
    return null
  },
})

export const move = mutation({
  args: { workspaceId: v.string(), fileId: v.id('files'), parentId: v.union(v.id('files'), v.null()) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, fileId, parentId }) => {
    const viewer = await requireNativeWorkspace(ctx, workspaceId)
    await updateFileFor(ctx, { userId: viewer.userId, workspaceId, fileId, parentId })
    return null
  },
})

/** Files a thread produced or received, live, for the thread's Library: the viewer's own plus workspace-shared ones. */
export const forConversation = query({
  args: { workspaceId: v.string(), conversationId: v.string() },
  handler: async (ctx, { workspaceId, conversationId }) => {
    const viewer = await viewerOrNull(ctx, workspaceId)
    if (!viewer) return null
    const rows = await listScopedRows(ctx, {
      userId: viewer.userId,
      workspaceId,
      view: undefined,
      fetchMine: async () => await ctx.db.query('files')
        .withIndex('by_workspaceId_userId_conversationId_updatedAt', (q) => q.eq('workspaceId', workspaceId).eq('userId', viewer.userId).eq('conversationId', conversationId))
        .order('desc').take(TREE_SCAN_LIMIT),
      fetchShared: async (ws) => (await ctx.db.query('files')
        .withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace').eq('archivedAt', undefined))
        .take(TREE_SCAN_LIMIT)).filter((row) => row.conversationId === conversationId),
    })
    return rows
      .filter((row) => !row.deletedAt && row.type === 'file')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(browserFileSummary)
  },
})
