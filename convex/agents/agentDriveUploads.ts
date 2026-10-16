import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { driveAuthorityArgs, requireDriveAuthority } from './agentDrive'
import { driveUploadOperation, driveContentResult, driveUploadFields } from '../lib/agentDriveUploadSchema'
import { safeName, writable, requireParent, requireVacantName, requireFilePath, promoteDriveDuplicate, type Authority } from '../lib/agentDriveFiles'
import { canCreateInScope } from '../../src/shared/workspaces/resource-scope'
import { keyForFile } from '../../src/shared/storage/storage-keys'
import { ensureStorageAvailable, applyStorageUsageDelta, StorageQuotaExceededError } from '../files/lib/storageQuota'
import { retireDriveContent, queueDriveUploadObjects } from '../lib/agentDriveRetiredObjects'

const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_RUN_BYTES = 256 * 1024 * 1024
const idPattern = /^[A-Za-z0-9_-]{16,128}$/
type Upload = Doc<'agentDriveUploads'>

async function quota(ctx: MutationCtx, owner: string, bytes: number) {
  try { await ensureStorageAvailable(ctx, owner, bytes) }
  catch (error) {
    if (error instanceof StorageQuotaExceededError) throw new ConvexError('DRIVE_STORAGE_QUOTA')
    throw error
  }
}
function requireCreate(authority: Authority) {
  if (!canCreateInScope('content', authority.scope.kind, authority.scopeContext.viewer, authority.scopeContext.policy)) throw new ConvexError('DRIVE_EDIT_DENIED')
}
async function findUpload(ctx: Pick<QueryCtx, 'db'>, uploadId: string) {
  return ctx.db.query('agentDriveUploads').withIndex('by_uploadId', q => q.eq('uploadId', uploadId)).unique()
}
function requireAttempt(upload: Upload, args: { runId: string; sessionId: string; execution?: { attemptId: string; generation: number } }) {
  if (upload.runId !== args.runId || upload.sessionId !== args.sessionId
    || upload.attemptId !== args.execution?.attemptId || upload.generation !== args.execution?.generation) throw new ConvexError('DRIVE_RUN_UNAVAILABLE')
}

/** Only an internal server caller can allocate immutable staging/final object identities. */
export const intentByServer = mutation({
  args: { ...driveAuthorityArgs, requestId: v.string(), uploadId: v.string(), operation: driveUploadOperation,
    sha256: v.string(), sizeBytes: v.number(), mimeType: v.string() },
  returns: v.object({ ...driveUploadFields, _id: v.id('agentDriveUploads'), _creationTime: v.number() }),
  handler: async (ctx, args) => {
    const authority = await requireDriveAuthority(ctx, args)
    if (!idPattern.test(args.requestId) || !/^[a-f0-9-]{36}$/.test(args.uploadId)
      || !/^[a-f0-9]{64}$/.test(args.sha256) || !Number.isSafeInteger(args.sizeBytes)
      || args.sizeBytes < 0 || args.sizeBytes > MAX_FILE_BYTES || !/^[\w.+-]+\/[\w.+-]+$/.test(args.mimeType)) throw new ConvexError('DRIVE_INVALID_UPLOAD')
    const op = args.operation
    const fingerprint = JSON.stringify([op.kind, op.kind === 'create' ? [op.name, op.parentId ?? null]
      : [op.fileId, op.path, op.updatedAt], args.sha256, args.sizeBytes, args.mimeType])
    const prior = await ctx.db.query('agentDriveUploads').withIndex('by_runId_requestId', q => q.eq('runId', args.runId).eq('requestId', args.requestId)).unique()
    if (prior) {
      requireAttempt(prior, args)
      if (prior.fingerprint !== fingerprint) throw new ConvexError('DRIVE_REQUEST_CONFLICT')
      return prior
    }
    if (await findUpload(ctx, args.uploadId)) throw new ConvexError('DRIVE_REQUEST_CONFLICT')
    let ownerUserId = args.actorUserId
    let name: string
    let parentId: Id<'files'> | undefined
    if (op.kind === 'create') {
      requireCreate(authority); safeName(op.name)
      name = op.name; parentId = op.parentId
    } else {
      const file = await ctx.db.get(op.fileId)
      if (!file || file.type !== 'file') throw new ConvexError('DRIVE_SOURCE_CHANGED')
      writable(file, authority)
      // A stale revision still grants only this file; commit saves a conflict copy.
      if (!Number.isSafeInteger(op.updatedAt) || op.updatedAt < 0) throw new ConvexError('DRIVE_INVALID_UPLOAD')
      if (file.updatedAt === op.updatedAt) await requireFilePath(ctx, file, authority, op.path)
      name = file.name; parentId = file.parentId ? ctx.db.normalizeId('files', file.parentId) ?? undefined : undefined
      if (file.parentId && !parentId) throw new ConvexError('DRIVE_SOURCE_CHANGED')
      ownerUserId = file.userId
    }
    await requireParent(ctx, parentId, authority, name)
    await quota(ctx, ownerUserId, args.sizeBytes)
    const budget = await ctx.db.query('agentDriveWriteBudgets').withIndex('by_runId', q => q.eq('runId', args.runId)).unique()
    if ((budget?.uploads ?? 0) >= 1000 || (budget?.bytes ?? 0) + args.sizeBytes > MAX_RUN_BYTES) throw new ConvexError('DRIVE_UPLOAD_QUOTA')
    const now = Date.now()
    const retireAt = authority.hardDeadlineAt + 48 * 60 * 60_000
    if (budget) await ctx.db.patch(budget._id, { uploads: budget.uploads + 1, bytes: budget.bytes + args.sizeBytes,
      expiresAt: Math.max(budget.expiresAt, retireAt) })
    else await ctx.db.insert('agentDriveWriteBudgets', { runId: args.runId, uploads: 1, bytes: args.sizeBytes, expiresAt: retireAt })
    const stagingKey = keyForFile(ownerUserId, `agent-staging/${args.uploadId}`, 'upload')
    const finalKey = keyForFile(ownerUserId, args.uploadId, name)
    await queueDriveUploadObjects(ctx, { ownerUserId, stagingKey, finalKey, hardDeadlineAt: authority.hardDeadlineAt, now })
    const uploadId = await ctx.db.insert('agentDriveUploads', {
      uploadId: args.uploadId, runId: args.runId, sessionId: args.sessionId, requestId: args.requestId,
      attemptId: args.execution?.attemptId, generation: args.execution?.generation, fingerprint, operation: op,
      ownerUserId, name, parentId, sha256: args.sha256, sizeBytes: args.sizeBytes, mimeType: args.mimeType,
      stagingKey, finalKey, state: { kind: 'pending' },
      expiresAt: Math.min(args.expiresAt, now + 15 * 60_000), retireAt, createdAt: now,
    })
    const stored = await ctx.db.get(uploadId)
    if (!stored) throw new ConvexError('DRIVE_UPLOAD_UNAVAILABLE')
    return stored
  },
})

export const readByServer = query({
  args: { ...driveAuthorityArgs, uploadId: v.string() },
  returns: v.object({ ...driveUploadFields, _id: v.id('agentDriveUploads'), _creationTime: v.number() }),
  handler: async (ctx, args) => {
    await requireDriveAuthority(ctx, args)
    const upload = await findUpload(ctx, args.uploadId)
    if (!upload) throw new ConvexError('DRIVE_UPLOAD_UNAVAILABLE')
    requireAttempt(upload, args)
    return upload
  },
})

async function conflictName(ctx: MutationCtx, authority: Authority, name: string, parentId?: Id<'files'>) {
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && name.length - dot <= 24 ? name.slice(dot) : ''
  for (let index = 1; index <= 100; index++) {
    const suffix = ` (agent${index === 1 ? '' : ` ${index}`})${extension}`
    const chars = Array.from(extension ? name.slice(0, dot) : name)
    while (chars.join('').length + suffix.length > 255) chars.pop()
    const candidate = chars.join('') + suffix
    try { safeName(candidate); await requireVacantName(ctx, authority, candidate, parentId); return candidate }
    catch (error) { if (!(error instanceof ConvexError) || error.data !== 'DRIVE_PATH_CONFLICT') throw error }
  }
  throw new ConvexError('DRIVE_PATH_CONFLICT')
}

/** The BFF verifies full staging bytes and seals a server-only immutable object before this transaction. */
export const commitByServer = mutation({
  args: { ...driveAuthorityArgs, uploadId: v.string(), verifiedSha256: v.string(), verifiedSizeBytes: v.number(), textPrefix: v.optional(v.string()) },
  returns: driveContentResult,
  handler: async (ctx, args) => {
    const authority = await requireDriveAuthority(ctx, args)
    const upload = await findUpload(ctx, args.uploadId)
    if (!upload) throw new ConvexError('DRIVE_UPLOAD_UNAVAILABLE')
    requireAttempt(upload, args)
    if (args.verifiedSha256 !== upload.sha256 || args.verifiedSizeBytes !== upload.sizeBytes) throw new ConvexError('DRIVE_UPLOAD_CHANGED')
    if (upload.state.kind === 'committed') return upload.state.result
    if (upload.expiresAt <= Date.now()) throw new ConvexError('DRIVE_UPLOAD_EXPIRED')
    if (args.textPrefix !== undefined && (new TextEncoder().encode(args.textPrefix).length > 128 * 1024
      || /[\uD800-\uDFFF]/u.test(args.textPrefix))) throw new ConvexError('DRIVE_INVALID_UPLOAD')
    const op = upload.operation
    const existing = op.kind === 'replace' ? await ctx.db.get(op.fileId) : null
    let conflict = false
    if (op.kind === 'replace') {
      if (!existing || existing.type !== 'file') throw new ConvexError('DRIVE_SOURCE_CHANGED')
      writable(existing, authority)
      if (existing.userId !== upload.ownerUserId) throw new ConvexError('DRIVE_SOURCE_CHANGED')
      conflict = existing.updatedAt !== op.updatedAt
      if (!conflict) await requireFilePath(ctx, existing, authority, op.path)
    }
    const text = args.textPrefix
    if (existing?.kind === 'note') {
      if (text === undefined) throw new ConvexError('DRIVE_INVALID_UPLOAD')
      // Notes remain canonical inline Markdown. An oversized edit becomes a full
      // object-backed file copy instead of truncating the Notes editor's source.
      if (new TextEncoder().encode(text).length !== upload.sizeBytes) conflict = true
    }
    await requireParent(ctx, upload.parentId, authority, upload.name)
    let name = upload.name
    if (!existing || conflict) {
      requireCreate(authority)
      try { await requireVacantName(ctx, authority, name, upload.parentId) }
      catch (error) { if (!(error instanceof ConvexError) || error.data !== 'DRIVE_PATH_CONFLICT') throw error; conflict = true }
      if (conflict) name = await conflictName(ctx, authority, name, upload.parentId)
    }
    // Retained object versions remain charged until their cleanup is confirmed.
    const releasedInline = existing && !conflict && !existing.r2Key && !existing.storageId && existing.kind !== 'output'
      ? existing.sizeBytes ?? 0 : 0
    const delta = upload.sizeBytes - releasedInline
    await quota(ctx, upload.ownerUserId, delta)
    const now = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1)
    const objectStored = !(existing?.kind === 'note' && !conflict)
    const fields = { name, r2Key: objectStored ? upload.finalKey : undefined, storageId: undefined, sizeBytes: upload.sizeBytes, contentHash: upload.sha256,
      mimeType: upload.mimeType, content: text, textContent: undefined, textInObjectStore: objectStored && text !== undefined,
      indexable: Boolean(text?.trim()), indexStatus: text?.trim() ? 'pending' as const : 'skipped' as const,
      indexError: undefined, duplicateOfFileId: undefined, updatedAt: now }
    let fileId: Id<'files'>
    if (existing && !conflict) {
      await promoteDriveDuplicate(ctx, existing, now)
      await retireDriveContent(ctx, existing, now)
      await ctx.db.patch(existing._id, fields)
      fileId = existing._id
    } else fileId = await ctx.db.insert('files', { ...fields, userId: upload.ownerUserId,
      workspaceId: authority.scope.workspaceId, scope: authority.scope.kind, type: 'file', kind: 'upload',
      parentId: upload.parentId, extension: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : undefined,
      createdAt: now })
    await applyStorageUsageDelta(ctx, upload.ownerUserId, delta)
    await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId })
    const result = { fileId, updatedAt: now, name, conflict, objectStored, sha256: upload.sha256, sizeBytes: upload.sizeBytes }
    await ctx.db.patch(upload._id, { state: { kind: 'committed', result } })
    return result
  },
})
