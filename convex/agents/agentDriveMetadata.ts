import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { mutation, type MutationCtx } from '../_generated/server'
import { canCreateInScope, canEditResource, rowScope } from '../../src/shared/workspaces/resource-scope'
import { applyStorageUsageDelta } from '../files/lib/storageQuota'
import { driveAuthorityArgs, requireDriveAuthority } from './agentDrive'

const operationValidator = v.union(
  v.object({ kind: v.literal('mkdir'), name: v.string(), parentId: v.optional(v.id('files')) }),
  v.object({ kind: v.literal('move'), fileId: v.id('files'), updatedAt: v.number(), name: v.string(), parentId: v.optional(v.id('files')) }),
  v.object({ kind: v.literal('remove'), fileId: v.id('files'), updatedAt: v.number() }),
)
const resultValidator = v.object({ fileId: v.id('files'), updatedAt: v.number() })
type Authority = Awaited<ReturnType<typeof requireDriveAuthority>>

function safeName(name: string) {
  if (!name || name.length > 255 || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f]/.test(name)) throw new ConvexError('DRIVE_UNSAFE_PATH')
}
function inScope(row: Doc<'files'>, authority: Authority) {
  const { scope } = authority
  return row.workspaceId === scope.workspaceId && rowScope(row) === scope.kind
    && (scope.kind === 'workspace' || row.userId === scope.ownerUserId)
    && row.archivedAt === undefined && row.deletedAt === undefined
}
function writable(row: Doc<'files'>, authority: Authority) {
  if (!inScope(row, authority) || !canEditResource(row, authority.scopeContext.viewer)) throw new ConvexError('DRIVE_EDIT_DENIED')
}
async function requireParent(ctx: MutationCtx, parentId: Id<'files'> | undefined, authority: Authority, name: string, movingId?: Id<'files'>) {
  const visited = new Set<string>()
  let id: string | undefined = parentId
  let pathLength = name.length
  for (let depth = 0; id !== undefined; depth++) {
    if (depth >= 64 || id === movingId || visited.has(id)) throw new ConvexError('DRIVE_UNSAFE_PATH')
    visited.add(id)
    const normalized = ctx.db.normalizeId('files', id)
    const row = normalized ? await ctx.db.get(normalized) : null
    if (!row || row.type !== 'folder') throw new ConvexError('DRIVE_SOURCE_CHANGED')
    writable(row, authority)
    pathLength += row.name.length + 1
    if (pathLength > 4096) throw new ConvexError('DRIVE_UNSAFE_PATH')
    id = row.parentId
  }
}
async function children(ctx: MutationCtx, parentId: Id<'files'>) {
  const rows = await ctx.db.query('files').withIndex('by_parentId', q => q.eq('parentId', parentId)).take(10001)
  if (rows.length > 10000) throw new ConvexError('DRIVE_TOO_MANY_ENTRIES')
  return rows.filter(row => row.deletedAt === undefined && row.archivedAt === undefined)
}
async function requireVacantName(ctx: MutationCtx, authority: Authority, name: string, parentId?: Id<'files'>, except?: Id<'files'>) {
  // Root names must be checked across the fixed scope, including other owners' shared files.
  const { scope } = authority
  const rows = parentId !== undefined ? await children(ctx, parentId)
    : scope.kind === 'personal'
      ? await ctx.db.query('files').withIndex('by_workspaceId_userId_archivedAt', q => q.eq('workspaceId', scope.workspaceId).eq('userId', scope.ownerUserId).eq('archivedAt', undefined)).take(10001)
      : await ctx.db.query('files').withIndex('by_workspaceId_scope_archivedAt', q => q.eq('workspaceId', scope.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined)).take(10001)
  if (rows.length > 10000) throw new ConvexError('DRIVE_TOO_MANY_ENTRIES')
  if (rows.some(row => row._id !== except && row.parentId === parentId && row.name === name && inScope(row, authority))) throw new ConvexError('DRIVE_PATH_CONFLICT')
}

/** Metadata-only changes are atomic with their receipt. Hosts must delete hydrated children explicitly. */
export const commitByServer = mutation({
  args: { ...driveAuthorityArgs, requestId: v.string(), operation: operationValidator },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const authority = await requireDriveAuthority(ctx, args)
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(args.requestId)) throw new ConvexError('DRIVE_INVALID_REQUEST')
    const operation = args.operation
    // Explicit property order makes retry identity independent of JSON object key order.
    const fingerprint = operation.kind === 'mkdir' ? JSON.stringify(['mkdir', operation.name, operation.parentId ?? null])
      : operation.kind === 'move' ? JSON.stringify(['move', operation.fileId, operation.updatedAt, operation.name, operation.parentId ?? null])
        : JSON.stringify(['remove', operation.fileId, operation.updatedAt])
    const prior = await ctx.db.query('agentDriveMetadataReceipts').withIndex('by_runId_requestId', q => q.eq('runId', args.runId).eq('requestId', args.requestId)).unique()
    if (prior) {
      if (prior.sessionId !== args.sessionId || prior.attemptId !== args.execution?.attemptId || prior.generation !== args.execution?.generation || prior.fingerprint !== fingerprint) throw new ConvexError('DRIVE_REQUEST_CONFLICT')
      return prior.result
    }
    let result: { fileId: Id<'files'>; updatedAt: number }
    if (operation.kind === 'mkdir') {
      safeName(operation.name)
      if (!canCreateInScope('content', authority.scope.kind, authority.scopeContext.viewer, authority.scopeContext.policy)) throw new ConvexError('DRIVE_EDIT_DENIED')
      await requireParent(ctx, operation.parentId, authority, operation.name)
      await requireVacantName(ctx, authority, operation.name, operation.parentId)
      const now = Date.now()
      const fileId = await ctx.db.insert('files', { userId: args.actorUserId, workspaceId: authority.scope.workspaceId, scope: authority.scope.kind,
        name: operation.name, parentId: operation.parentId, type: 'folder', kind: 'folder', sizeBytes: 0, createdAt: now, updatedAt: now })
      result = { fileId, updatedAt: now }
    } else {
      const file = await ctx.db.get(operation.fileId)
      if (!file) throw new ConvexError('DRIVE_SOURCE_CHANGED')
      writable(file, authority)
      if (!Number.isSafeInteger(operation.updatedAt) || operation.updatedAt < 0 || file.updatedAt !== operation.updatedAt) throw new ConvexError('DRIVE_SOURCE_CHANGED')
      const updatedAt = Math.max(Date.now(), file.updatedAt + 1)
      if (operation.kind === 'move') {
        safeName(operation.name)
        await requireParent(ctx, operation.parentId, authority, operation.name, file._id)
        await requireVacantName(ctx, authority, operation.name, operation.parentId, file._id)
        if (file.type === 'folder') {
          const pending = [file._id]; const seen = new Set<string>()
          while (pending.length) {
            const id = pending.pop()
            if (id === undefined) break
            if (seen.has(id) || seen.size >= 10000) throw new ConvexError('DRIVE_TOO_MANY_ENTRIES')
            seen.add(id)
            for (const child of await children(ctx, id)) { writable(child, authority); if (child.type === 'folder') pending.push(child._id) }
          }
        }
        const dot = operation.name.lastIndexOf('.')
        await ctx.db.patch(file._id, { name: operation.name, parentId: operation.parentId, updatedAt,
          ...(file.type === 'file' ? { extension: dot > 0 ? operation.name.slice(dot + 1).toLowerCase() : undefined } : {}) })
      } else {
        if (file.type === 'folder' && (await children(ctx, file._id)).length) throw new ConvexError('DRIVE_DIRECTORY_NOT_EMPTY')
        // Tombstones keep immutable object versions recoverable. No storage deletion precedes the commit.
        if (file.type === 'file') {
          await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, { sourceKind: 'file', sourceId: file._id, userId: file.userId })
          if (!file.duplicateOfFileId) {
            const duplicates = await ctx.db.query('files').withIndex('by_duplicateOfFileId', q => q.eq('duplicateOfFileId', file._id)).take(10001)
            if (duplicates.length > 10000) throw new ConvexError('DRIVE_TOO_MANY_ENTRIES')
            const active = duplicates.filter(row => row.userId === file.userId && row.deletedAt === undefined)
            const [promoted, ...rest] = active
            if (promoted) {
              await ctx.db.patch(promoted._id, { duplicateOfFileId: undefined, indexStatus: 'pending', updatedAt: Math.max(updatedAt, promoted.updatedAt + 1) })
              for (const duplicate of rest) await ctx.db.patch(duplicate._id, { duplicateOfFileId: promoted._id, updatedAt: Math.max(updatedAt, duplicate.updatedAt + 1) })
              await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId: promoted._id })
            }
          }
          // Existing Files policy keeps bytes charged until object cleanup is confirmed.
          if (!file.r2Key && !file.storageId && file.kind !== 'output' && (file.sizeBytes ?? 0) > 0) await applyStorageUsageDelta(ctx, file.userId, -(file.sizeBytes ?? 0))
        }
        await ctx.db.patch(file._id, { deletedAt: updatedAt, updatedAt, indexStatus: 'skipped' })
      }
      result = { fileId: file._id, updatedAt }
    }
    await ctx.db.insert('agentDriveMetadataReceipts', { runId: args.runId, sessionId: args.sessionId, requestId: args.requestId,
      attemptId: args.execution?.attemptId, generation: args.execution?.generation, fingerprint, result, createdAt: Date.now() })
    return result
  },
})
