import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { assertWorkspaceMembership } from '../../lib/workspaceMembership'
import type { UploadedFileInput } from '../../../src/shared/storage/file-publication'
import { applyStorageUsageDelta, ensureStorageAvailable } from './storageQuota'

export function assertMatchingFile(file: Doc<'files'> | null, input: UploadedFileInput): asserts file is Doc<'files'> {
  if (!file || file.deletedAt || file.archivedAt || file.type !== 'file' || file.kind !== 'upload'
    || file.userId !== input.userId || file.r2Key !== input.r2Key || file.sizeBytes !== input.sizeBytes
    || file.name !== input.name || file.parentId !== input.parentId || file.workspaceId !== input.workspaceId
    || (file.scope ?? 'personal') !== input.scope || file.mimeType !== input.mimeType
    || file.extension !== input.extension) throw new Error('upload_publication_conflict')
}

export async function commitUploadedFile(ctx: MutationCtx, input: UploadedFileInput, now: number) {
  await assertWorkspaceMembership(ctx, input)
  const intent = await ctx.db.query('r2UploadIntents').withIndex('by_r2Key', q => q.eq('r2Key', input.r2Key)).unique()
  if (!intent || intent.userId !== input.userId || intent.status === 'expired') throw new Error('upload_intent_not_found')
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > intent.declaredSizeBytes) {
    throw new Error('upload_size_exceeds_intent')
  }
  if (intent.mimeType && intent.mimeType !== input.mimeType) throw new Error('upload_mime_mismatch')
  if (intent.status === 'finalized') {
    const file = intent.fileId ? await ctx.db.get(intent.fileId) : null
    assertMatchingFile(file, input)
    return file._id
  }
  if (now > intent.expiresAt + 15 * 60_000) throw new Error('upload_intent_expired')
  const existing = await ctx.db.query('files').withIndex('by_r2Key', q => q.eq('r2Key', input.r2Key)).take(2)
  if (existing.length > 1) throw new Error('upload_publication_conflict')
  let fileId = existing[0]?._id
  if (existing.length) assertMatchingFile(existing[0], input)
  else {
    await ensureStorageAvailable(ctx, input.userId, input.sizeBytes)
    fileId = await ctx.db.insert('files', {
      userId: input.userId, workspaceId: input.workspaceId, scope: input.scope,
      name: input.name, parentId: input.parentId, r2Key: input.r2Key, sizeBytes: input.sizeBytes,
      mimeType: input.mimeType, extension: input.extension, type: 'file', kind: 'upload',
      indexable: false, indexStatus: 'skipped', createdAt: now, updatedAt: now,
    })
    await applyStorageUsageDelta(ctx, input.userId, input.sizeBytes)
  }
  await ctx.db.patch(intent._id, { status: 'finalized', fileId, actualSizeBytes: input.sizeBytes, finalizedAt: now })
  return fileId!
}
