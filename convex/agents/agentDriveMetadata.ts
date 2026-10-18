import { ConvexError, v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { mutation } from '../_generated/server'
import { canCreateInScope } from '../../src/shared/workspaces/resource-scope'
import { applyStorageUsageDelta } from '../files/lib/storageQuota'
import { driveAuthorityArgs, requireDriveAuthority } from './agentDrive'
import { safeName, writable, requireFilePath, promoteDriveDuplicate, children, requireParent, requireVacantName } from '../lib/agentDriveFiles'

const operationValidator = v.union(
  v.object({ kind: v.literal('mkdir'), name: v.string(), parentId: v.optional(v.id('files')) }),
  v.object({ kind: v.literal('move'), fileId: v.id('files'), path: v.string(), updatedAt: v.number(), name: v.string(), parentId: v.optional(v.id('files')) }),
  v.object({ kind: v.literal('remove'), fileId: v.id('files'), path: v.string(), updatedAt: v.number() }),
)
const resultValidator = v.object({ fileId: v.id('files'), updatedAt: v.number() })
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
      : operation.kind === 'move' ? JSON.stringify(['move', operation.fileId, operation.path, operation.updatedAt, operation.name, operation.parentId ?? null])
        : JSON.stringify(['remove', operation.fileId, operation.path, operation.updatedAt])
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
      await requireFilePath(ctx, file, authority, operation.path)
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
          await promoteDriveDuplicate(ctx, file, updatedAt)
          // Existing Files policy keeps bytes charged until object cleanup is confirmed.
          if (!file.r2Key && !file.storageId && file.kind !== 'output' && (file.sizeBytes ?? 0) > 0) await applyStorageUsageDelta(ctx, file.userId, -(file.sizeBytes ?? 0))
        }
        await ctx.db.patch(file._id, { deletedAt: updatedAt, updatedAt, indexStatus: 'skipped' })
      }
      result = { fileId: file._id, updatedAt }
    }
    await ctx.db.insert('agentDriveMetadataReceipts', { runId: args.runId, sessionId: args.sessionId, requestId: args.requestId,
      attemptId: args.execution?.attemptId, generation: args.execution?.generation, fingerprint, result, createdAt: Date.now(),
      retireAt: authority.hardDeadlineAt + 48 * 60 * 60_000 })
    return result
  },
})
