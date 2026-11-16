import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'
import { getReadableRow, scopeContextLoader } from '../lib/resourceScope'
import { folderCopyEntryValidator, folderCopyFolderValidator } from '../lib/threadWork'

/**
 * Overlay folders copied onto a computer for an agent run (internal/develop/thread-folders.md). The server lists
 * a folder's readable files here, records what it copied, and records what it saved back at the end of the run.
 */

const MAX_SUBTREE_ROWS = 2_000
const RETENTION_MS = 7 * 24 * 60 * 60_000

export type FolderCopyRow = {
  id: string
  name: string
  type: 'file' | 'folder'
  kind?: string
  parentId: string
  mimeType?: string
  sizeBytes?: number
  updatedAt: number
  hasStorageObject: boolean
  textInObjectStore: boolean
}

function summarize(row: Doc<'files'>, parentId: string): FolderCopyRow {
  return {
    id: row._id,
    name: row.name,
    type: row.type,
    ...(row.kind ? { kind: row.kind } : {}),
    parentId,
    ...(row.mimeType ? { mimeType: row.mimeType } : {}),
    ...(row.sizeBytes !== undefined ? { sizeBytes: row.sizeBytes } : {}),
    updatedAt: row.updatedAt,
    hasStorageObject: Boolean(row.r2Key),
    textInObjectStore: row.textInObjectStore === true,
  }
}

/** Every file and folder under a folder that this person can read, breadth first, up to a limit. */
export const subtreeByServer = query({
  args: { serverSecret: v.string(), userId: v.string(), workspaceId: v.string(), folderId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('files', args.folderId)
    const root = id ? await getReadableRow(ctx, { row: await ctx.db.get(id), userId: args.userId, workspaceId: args.workspaceId }) : null
    if (!root || root.type !== 'folder' || root.deletedAt !== undefined || root.archivedAt !== undefined) {
      throw new ConvexError('FOLDER_COPY_FOLDER_UNAVAILABLE')
    }
    const scope = scopeContextLoader(ctx, args.userId)
    const rows: FolderCopyRow[] = []
    const queue: string[] = [root._id]
    let truncated = false
    while (queue.length > 0) {
      const parentId = queue.shift()!
      const children = await ctx.db.query('files').withIndex('by_parentId', q => q.eq('parentId', parentId)).collect()
      for (const child of children) {
        if (child.deletedAt !== undefined || child.archivedAt !== undefined || child.workspaceId !== args.workspaceId) continue
        if (!await scope.canRead(child)) continue
        if (rows.length >= MAX_SUBTREE_ROWS) { truncated = true; break }
        rows.push(summarize(child, parentId))
        if (child.type === 'folder') queue.push(child._id)
      }
      if (truncated) break
    }
    return { folder: { id: root._id, name: root.name, scope: root.scope ?? 'personal', userId: root.userId }, rows, truncated }
  },
})

const copyFields = {
  copyId: v.string(),
  agentRunId: v.string(),
  conversationId: v.string(),
  workspaceId: v.string(),
  userId: v.string(),
  agentId: v.string(),
  agentName: v.optional(v.string()),
  messageId: v.optional(v.string()),
  target: v.union(v.literal('cloud'), v.literal('mac')),
  environmentId: v.optional(v.string()),
  folderId: v.string(),
  folderName: v.string(),
  root: v.string(),
}

/** Starts a copy record before any file is written, so a crashed run still has something to save back. */
export const startByServer = mutation({
  args: { serverSecret: v.string(), ...copyFields },
  handler: async (ctx, { serverSecret, ...copy }) => {
    requireServerSecret(serverSecret)
    const existing = await ctx.db.query('threadFolderCopies').withIndex('by_copyId', q => q.eq('copyId', copy.copyId)).unique()
    if (existing) return { created: false, status: existing.status }
    const now = Date.now()
    await ctx.db.insert('threadFolderCopies', {
      ...copy, entries: [], folders: [], skipped: [], status: 'copying', createdAt: now, updatedAt: now,
    })
    return { created: true, status: 'copying' as const }
  },
})

export const listForRunByServer = query({
  args: { serverSecret: v.string(), agentRunId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('threadFolderCopies').withIndex('by_agentRunId', q => q.eq('agentRunId', args.agentRunId)).collect()
  },
})

export const updateByServer = mutation({
  args: {
    serverSecret: v.string(),
    copyId: v.string(),
    expectedStatus: v.optional(v.union(v.literal('copying'), v.literal('copied'), v.literal('saving'), v.literal('saved'), v.literal('failed'))),
    status: v.union(v.literal('copying'), v.literal('copied'), v.literal('saving'), v.literal('saved'), v.literal('failed')),
    entries: v.optional(v.array(folderCopyEntryValidator)),
    folders: v.optional(v.array(folderCopyFolderValidator)),
    skipped: v.optional(v.array(v.string())),
    summary: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { serverSecret, copyId, expectedStatus, ...patch }) => {
    requireServerSecret(serverSecret)
    const row = await ctx.db.query('threadFolderCopies').withIndex('by_copyId', q => q.eq('copyId', copyId)).unique()
    if (!row) throw new ConvexError('FOLDER_COPY_NOT_FOUND')
    // Saving back is claimed once: only the first caller moves a copy from copied to saving.
    if (expectedStatus !== undefined && row.status !== expectedStatus) return { updated: false, status: row.status }
    const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
    await ctx.db.patch(row._id, { ...fields, updatedAt: Date.now() })
    return { updated: true, status: patch.status }
  },
})

/**
 * Shows what a run saved back as a card on the agent's reply (`data-folder-saves`). Replaces an earlier card for the
 * same run, so a retried save shows once.
 */
export const attachSummaryByServer = mutation({
  args: { serverSecret: v.string(), conversationId: v.string(), messageId: v.string(), data: v.any() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('conversationMessages', args.messageId)
    const message = id ? await ctx.db.get(id) : null
    if (!message || message.conversationId !== args.conversationId) throw new ConvexError('FOLDER_COPY_MESSAGE_NOT_FOUND')
    const parts = (message.parts ?? []).filter(part => (part as { type?: string }).type !== 'data-folder-saves')
    await ctx.db.patch(message._id, { parts: [...parts, { type: 'data-folder-saves' as const, data: args.data }] })
    return null
  },
})

/** Copy records are only needed while a run is going and shortly after. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS
    const stale = await ctx.db.query('threadFolderCopies').withIndex('by_createdAt', q => q.lt('createdAt', cutoff)).take(200)
    for (const row of stale) await ctx.db.delete(row._id)
    return { deleted: stale.length }
  },
})
