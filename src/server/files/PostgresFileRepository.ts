import 'server-only'

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  files,
  knowledgeChunks,
  projects,
  r2UploadIntents,
} from '@/server/database/postgres/schema'
import {
  isOwnedFileR2Key,
  isOwnedOutputR2Key,
} from '@/server/storage/storage-keys'
import { enqueueStorageCleanupJobs } from '@/server/storage/PostgresStorageCleanupJobs'
import { enqueueKnowledgeReindexJob } from '@/server/knowledge/PostgresKnowledgeIndexJobs'
import type {
  FileRecord,
  ExtractedDocumentPart,
  FileRepository,
  FileShareResult,
  FileStorageEntitlements,
  FileStorageProxyTarget,
  FileSubtreeStorageEntry,
  FileUploadIntentRecord,
} from './FileRepository'

type FileRow = typeof files.$inferSelect
type Transaction = Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0]
type FileDb = OverlayPostgresDb | Transaction
type FileKind = 'folder' | 'note' | 'upload' | 'output'
type FileType = 'file' | 'folder'
type OutputSource = 'image_generation' | 'video_generation' | 'browser' | 'sandbox'
type OutputStatus = 'pending' | 'completed' | 'failed'

const UPLOAD_INTENT_FINALIZE_GRACE_MS = 15 * 60_000
const FILE_PREVIEW_CHARS = 1200
const UNLIMITED_STORAGE_BYTES = Number.MAX_SAFE_INTEGER
const PREVIEW_HTML_ENTITIES: Readonly<Record<string, string>> = {
  '#39': "'",
  amp: '&',
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

const utf8Encoder = new TextEncoder()

export class PostgresFileRepository implements FileRepository {
  readonly storageCleanupMode = 'durable' as const

  constructor(private readonly db: OverlayPostgresDb) {}

  async getFile(args: {
    fileId: string
    userId: string
    workspaceId?: string
  }): Promise<FileRecord | null> {
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(
        eq(files.id, args.fileId),
        eq(files.userId, args.userId),
        isNull(files.deletedAt),
        args.workspaceId ? eq(files.workspaceId, args.workspaceId) : undefined,
      ))
      .limit(1)
    return row ? normalizeFile(row) : null
  }

  async getFileByLegacyOutputId(args: {
    outputId: string
    userId: string
    workspaceId?: string
  }): Promise<FileRecord | null> {
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(
        eq(files.legacyOutputId, args.outputId),
        eq(files.userId, args.userId),
        isNull(files.deletedAt),
        args.workspaceId ? eq(files.workspaceId, args.workspaceId) : undefined,
      ))
      .limit(1)
    return row ? normalizeFile(row) : null
  }

  async listFiles(args: Record<string, unknown> & { userId: string; workspaceId?: string }): Promise<unknown[]> {
    const filters = [
      eq(files.userId, args.userId),
      args.includeDeleted === true ? undefined : isNull(files.deletedAt),
      typeof args.projectId === 'string' ? eq(files.projectId, args.projectId) : undefined,
      args.parentId !== undefined
        ? args.parentId === null
          ? isNull(files.parentId)
          : eq(files.parentId, String(args.parentId))
        : undefined,
      typeof args.conversationId === 'string' ? eq(files.conversationId, args.conversationId) : undefined,
      typeof args.outputType === 'string' ? eq(files.outputType, args.outputType) : undefined,
      isFileKind(args.kind) ? eq(files.kind, args.kind) : undefined,
      args.workspaceId ? eq(files.workspaceId, args.workspaceId) : undefined,
    ].filter(Boolean)

    const rows = await this.db
      .select()
      .from(files)
      .where(and(...filters))
      .orderBy(desc(files.updatedAt), desc(files.createdAt))

    return args.summary === true
      ? rows.map(normalizeFileSummary)
      : rows.map(normalizeFile)
  }

  async createFile(args: Record<string, unknown> & { userId: string; workspaceId?: string }): Promise<string | null> {
    return await this.db.transaction(async (tx) => {
      await lockFileHierarchy(tx, args.userId)
      await this.assertParentAndProject(tx, {
        userId: args.userId,
        parentId: stringValue(args.parentId),
        projectId: stringValue(args.projectId),
      })

      const now = dateValue(args.createdAt) ?? new Date()
      const updatedAt = dateValue(args.updatedAt) ?? now
      const kind = resolveKind(args.kind, args.type)
      const type: FileType = kind === 'folder' ? 'folder' : 'file'
      const textContent = stringValue(args.textContent) ?? stringValue(args.content) ?? ''
      const textBytes = type === 'file' ? utf8ByteLength(textContent) : 0
      const explicitSize = positiveNumber(args.sizeBytesOverride) ?? positiveNumber(args.sizeBytes) ?? 0
      const sizeBytes = type === 'file' ? Math.max(textBytes, explicitSize) : 0
      const indexable = isTextIndexable(kind, textContent)
      const contentHash = stringValue(args.contentHash)
      const canonicalDuplicate = indexable && contentHash
        ? await this.findCanonicalDuplicate(tx, {
            userId: args.userId,
            contentHash,
          })
        : null

      const id = fileId()
      await tx.insert(files).values({
        id,
        userId: args.userId,
        name: requiredString(args.name, 'name'),
        type,
        kind,
        parentId: stringValue(args.parentId),
        content: textContent,
        textContent: stringValue(args.textContent),
        storageId: stringValue(args.storageId),
        r2Key: stringValue(args.r2Key),
        mimeType: stringValue(args.mimeType),
        extension: stringValue(args.extension) ?? extensionOf(requiredString(args.name, 'name')),
        sizeBytes,
        contentHash,
        duplicateOfFileId: canonicalDuplicate?.id,
        indexable,
        indexStatus: indexable && !canonicalDuplicate ? 'pending' : 'skipped',
        conversationId: stringValue(args.conversationId),
        turnId: stringValue(args.turnId),
        modelId: stringValue(args.modelId),
        prompt: stringValue(args.prompt),
        outputType: stringValue(args.outputType),
        outputSource: outputSourceValue(args.outputSource),
        outputStatus: outputStatusValue(args.outputStatus),
        outputUrl: stringValue(args.outputUrl),
        outputMetadata: recordValue(args.outputMetadata),
        outputErrorMessage: stringValue(args.outputErrorMessage),
        outputCompletedAt: dateValue(args.outputCompletedAt),
        expiresAt: dateValue(args.expiresAt),
        legacyOutputId: stringValue(args.legacyOutputId),
        projectId: stringValue(args.projectId),
        createdAt: now,
        updatedAt,
        workspaceId: args.workspaceId,
      })
      if (indexable && !canonicalDuplicate) {
        await enqueueKnowledgeReindexJob(tx, {
          contentHash: contentHash ?? hashKnowledgeContent(textContent),
          sourceId: id,
          sourceKind: 'file',
          userId: args.userId,
        })
      }
      return id
    })
  }

  async createFileWithStorage(args: Record<string, unknown> & { userId: string; workspaceId?: string }): Promise<string | null> {
    const r2Key = requiredString(args.r2Key, 'r2Key')
    if (!isOwnedFileR2Key(args.userId, r2Key)) throw new Error('Invalid storage key')
    return await this.db.transaction(async (tx) => {
      await lockFileHierarchy(tx, args.userId)
      await lockStorageQuota(tx, args.userId)
      await this.assertParentAndProject(tx, {
        userId: args.userId,
        parentId: stringValue(args.parentId),
        projectId: stringValue(args.projectId),
      })

      const actualSizeBytes = positiveNumber(args.sizeBytes) ?? 0
      const intents = await tx.execute<{
        declared_size_bytes: number
        id: string
      }>(sql`
        SELECT id, declared_size_bytes
        FROM r2_upload_intents
        WHERE user_id = ${args.userId}
          AND r2_key = ${r2Key}
          AND status = 'pending'
        FOR UPDATE
      `)
      const intent = intents.rows[0]
      if (!intent) throw new Error('upload_intent_not_found')
      if (actualSizeBytes > Number(intent.declared_size_bytes)) {
        throw new Error('upload_size_exceeds_intent')
      }

      const now = new Date()
      const id = fileId()
      await tx.insert(files).values({
        id,
        userId: args.userId,
        name: requiredString(args.name, 'name'),
        type: 'file',
        kind: 'upload',
        parentId: stringValue(args.parentId),
        r2Key,
        mimeType: stringValue(args.mimeType),
        extension: stringValue(args.extension) ?? extensionOf(requiredString(args.name, 'name')),
        sizeBytes: actualSizeBytes,
        indexable: false,
        indexStatus: 'skipped',
        projectId: stringValue(args.projectId),
        createdAt: now,
        updatedAt: now,
        workspaceId: args.workspaceId,
      })
      await tx
        .update(r2UploadIntents)
        .set({
          actualSizeBytes,
          fileId: id,
          finalizedAt: now,
          status: 'finalized',
        })
        .where(eq(r2UploadIntents.id, intent.id))
      return id
    })
  }

  async createExtractedDocument(args: {
    mimeType: string
    parentId?: string
    parts: ExtractedDocumentPart[]
    projectId?: string
    r2Key: string
    sourceSizeBytes: number
    userId: string
    workspaceId?: string
  }): Promise<string[]> {
    if (!isOwnedFileR2Key(args.userId, args.r2Key)) throw new Error('Invalid storage key')
    if (args.parts.length === 0) throw new Error('Extracted document requires at least one part')
    return await this.db.transaction(async (tx) => {
      await lockFileHierarchy(tx, args.userId)
      await lockStorageQuota(tx, args.userId)
      await this.assertParentAndProject(tx, args)
      const now = new Date()
      const ids: string[] = []
      for (let index = 0; index < args.parts.length; index += 1) {
        const part = args.parts[index]!
        const canonicalDuplicate = await this.findCanonicalDuplicate(tx, {
          contentHash: part.contentHash,
          userId: args.userId,
        })
        const id = fileId()
        await tx.insert(files).values({
          id,
          userId: args.userId,
          name: part.name,
          type: 'file',
          kind: 'upload',
          parentId: args.parentId,
          content: part.content,
          textContent: part.content,
          r2Key: index === 0 ? args.r2Key : undefined,
          mimeType: index === 0 ? args.mimeType : 'text/plain',
          extension: extensionOf(part.name),
          sizeBytes: index === 0
            ? Math.max(utf8ByteLength(part.content), args.sourceSizeBytes)
            : utf8ByteLength(part.content),
          contentHash: part.contentHash,
          duplicateOfFileId: canonicalDuplicate?.id,
          indexable: true,
          indexStatus: canonicalDuplicate ? 'skipped' : 'pending',
          projectId: args.projectId,
          createdAt: now,
          updatedAt: now,
          workspaceId: args.workspaceId,
        })
        if (!canonicalDuplicate) {
          await enqueueKnowledgeReindexJob(tx, {
            contentHash: part.contentHash,
            sourceId: id,
            sourceKind: 'file',
            userId: args.userId,
          })
        }
        ids.push(id)
      }
      return ids
    })
  }

  async updateFile(args: Record<string, unknown> & { fileId: string; userId: string; workspaceId?: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockFileHierarchy(tx, args.userId)
      const [existing] = await tx
        .select()
        .from(files)
        .where(and(
          eq(files.id, args.fileId),
          eq(files.userId, args.userId),
          isNull(files.deletedAt),
          args.workspaceId ? eq(files.workspaceId, args.workspaceId) : undefined,
        ))
        .limit(1)
      if (!existing) throw new Error('Unauthorized')

      await this.assertParentAndProject(tx, {
        fileId: args.fileId,
        userId: args.userId,
        parentId: args.parentId === null ? undefined : stringValue(args.parentId),
        projectId: args.projectId === null ? undefined : stringValue(args.projectId),
      })

      const patch: Partial<typeof files.$inferInsert> = {
        updatedAt: new Date(),
      }
      if (args.name !== undefined) {
        patch.name = requiredString(args.name, 'name')
        patch.extension = extensionOf(patch.name)
      }
      if (args.parentId !== undefined) patch.parentId = stringValue(args.parentId)
      if (args.projectId !== undefined) patch.projectId = stringValue(args.projectId)
      if (args.r2Key !== undefined) patch.r2Key = stringValue(args.r2Key)
      if (args.mimeType !== undefined) patch.mimeType = stringValue(args.mimeType)
      if (args.sizeBytes !== undefined) patch.sizeBytes = positiveNumber(args.sizeBytes) ?? 0
      if (args.modelId !== undefined) patch.modelId = stringValue(args.modelId)
      if (args.outputType !== undefined) patch.outputType = stringValue(args.outputType)
      if (args.outputSource !== undefined) patch.outputSource = outputSourceValue(args.outputSource)
      if (args.outputStatus !== undefined) patch.outputStatus = outputStatusValue(args.outputStatus)
      if (args.outputUrl !== undefined) patch.outputUrl = stringValue(args.outputUrl)
      if (args.outputMetadata !== undefined) patch.outputMetadata = recordValue(args.outputMetadata)
      if (args.outputErrorMessage !== undefined) patch.outputErrorMessage = stringValue(args.outputErrorMessage)
      if (args.outputCompletedAt !== undefined) patch.outputCompletedAt = dateValue(args.outputCompletedAt)
      if (args.expiresAt !== undefined) patch.expiresAt = dateValue(args.expiresAt)

      const nextText = args.textContent ?? args.content
      if (nextText !== undefined) {
        if (typeof nextText !== 'string') throw new Error('content must be a string')
        const kind = inferKind(existing)
        const existingText = textOf(existing)
        const blobOnly = Boolean(existing.storageId ?? existing.r2Key) && !existingText.trim()
        if (blobOnly && kind !== 'output') {
          throw new Error('Storage-backed files cannot be edited inline.')
        }
        const contentHash = stringValue(args.contentHash)
        const indexable = isTextIndexable(kind, nextText)
        const canonicalDuplicate = indexable && contentHash
          ? await this.findCanonicalDuplicate(tx, {
              userId: args.userId,
              contentHash,
              ignoreFileId: args.fileId,
            })
          : null

        if (existing.type === 'file' && !existing.duplicateOfFileId && existing.contentHash !== contentHash) {
          await this.promoteDuplicate(tx, {
            userId: args.userId,
            canonicalFileId: args.fileId,
          })
        }

        patch.content = nextText
        patch.textContent = nextText
        patch.sizeBytes = utf8ByteLength(nextText)
        patch.contentHash = contentHash
        patch.duplicateOfFileId = canonicalDuplicate?.id
        patch.indexable = indexable
        patch.indexStatus = indexable && !canonicalDuplicate ? 'pending' : 'skipped'
        patch.indexError = null
      }

      const [updated] = await tx
        .update(files)
        .set(patch)
        .where(and(
          eq(files.id, args.fileId),
          eq(files.userId, args.userId),
          isNull(files.deletedAt),
          args.workspaceId ? eq(files.workspaceId, args.workspaceId) : undefined,
        ))
        .returning()
      if (updated?.indexStatus === 'pending') {
        const content = textOf(updated)
        await enqueueKnowledgeReindexJob(tx, {
          contentHash: updated.contentHash ?? hashKnowledgeContent(content),
          sourceId: updated.id,
          sourceKind: 'file',
          userId: updated.userId,
        })
      } else if (nextText !== undefined) {
        await tx.delete(knowledgeChunks).where(and(
          eq(knowledgeChunks.sourceKind, 'file'),
          eq(knowledgeChunks.sourceId, args.fileId),
          eq(knowledgeChunks.userId, args.userId),
        ))
      }
    })
  }

  async removeFile(args: {
    fileId: string
    userId: string
    workspaceId?: string
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockFileHierarchy(tx, args.userId)
      const subtree = await this.getSubtreeRows(tx, args)
      if (subtree.length === 0) throw new Error('Unauthorized')
      const subtreeIds = new Set(subtree.map((row) => row.id))
      const now = new Date()

      for (const row of subtree) {
        if (row.type === 'file' && !row.duplicateOfFileId) {
          await this.promoteDuplicate(tx, {
            userId: args.userId,
            canonicalFileId: row.id,
            excludeFileIds: subtreeIds,
          })
        }
        await tx
          .update(files)
          .set({
            deletedAt: now,
            updatedAt: now,
            indexStatus: 'skipped',
          })
          .where(and(
            eq(files.id, row.id),
            eq(files.userId, args.userId),
            isNull(files.deletedAt),
            args.workspaceId ? eq(files.workspaceId, args.workspaceId) : undefined,
          ))
        await tx.delete(knowledgeChunks).where(and(
          eq(knowledgeChunks.sourceKind, 'file'),
          eq(knowledgeChunks.sourceId, row.id),
          eq(knowledgeChunks.userId, args.userId),
        ))
      }

      await enqueueStorageCleanupJobs(tx, {
        dedupeKey: `file-delete:${args.fileId}`,
        keys: subtree.flatMap((row) => row.r2Key ? [row.r2Key] : []),
        reason: 'file-delete',
        userId: args.userId,
      })
    })
  }

  async getUploadIntent(args: {
    now: number
    r2Key: string
    userId: string
  }): Promise<FileUploadIntentRecord | null> {
    const [row] = await this.db
      .select()
      .from(r2UploadIntents)
      .where(and(
        eq(r2UploadIntents.userId, args.userId),
        eq(r2UploadIntents.r2Key, args.r2Key),
        eq(r2UploadIntents.status, 'pending'),
      ))
      .limit(1)
    if (!row) return null
    if (args.now > row.expiresAt.getTime() + UPLOAD_INTENT_FINALIZE_GRACE_MS) return null
    return {
      _id: row.id,
      declaredSizeBytes: row.declaredSizeBytes,
      mimeType: row.mimeType ?? undefined,
      expiresAt: row.expiresAt.getTime(),
    }
  }

  async createUploadIntent(args: {
    declaredSizeBytes: number
    expiresAt: number
    mimeType: string
    r2Key: string
    userId: string
  }): Promise<void> {
    if (!isOwnedFileR2Key(args.userId, args.r2Key)) throw new Error('Invalid storage key')
    const declaredSizeBytes = Math.max(0, Math.round(args.declaredSizeBytes))
    if (declaredSizeBytes <= 0) throw new Error('invalid_upload_intent_size')
    await this.db.transaction(async (tx) => {
      await lockStorageQuota(tx, args.userId)
      const storageBytesUsed = await this.getStorageBytesUsed(tx, args.userId)
      const pendingBytes = await this.getPendingUploadIntentBytes(tx, args.userId)
      if (storageBytesUsed + pendingBytes + declaredSizeBytes > UNLIMITED_STORAGE_BYTES) {
        throw new Error(`storage_limit_exceeded:${storageBytesUsed + pendingBytes + declaredSizeBytes}:${UNLIMITED_STORAGE_BYTES}`)
      }

      const inserted = await tx.insert(r2UploadIntents).values({
        id: uploadIntentId(),
        userId: args.userId,
        r2Key: args.r2Key,
        declaredSizeBytes,
        mimeType: args.mimeType,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(args.expiresAt),
      }).onConflictDoNothing().returning({ id: r2UploadIntents.id })
      if (inserted.length === 0) throw new Error('upload_intent_already_exists')
    })
  }

  async cleanupExpiredUploadIntents(args: {
    userId: string
  }): Promise<number> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(r2UploadIntents)
        .set({
          status: 'expired',
          expiredAt: new Date(),
        })
        .where(and(
          eq(r2UploadIntents.userId, args.userId),
          eq(r2UploadIntents.status, 'pending'),
          sql`${r2UploadIntents.expiresAt} < ${new Date(Date.now() - UPLOAD_INTENT_FINALIZE_GRACE_MS)}`,
        ))
        .returning({ id: r2UploadIntents.id, r2Key: r2UploadIntents.r2Key })
      for (const row of rows) {
        await enqueueStorageCleanupJobs(tx, {
          dedupeKey: `upload-intent-expired:${row.id}`,
          keys: [row.r2Key],
          reason: 'upload-intent-expired',
          userId: args.userId,
        })
      }
      return rows.length
    })
  }

  async finalizeUploadIntent(args: {
    actualSizeBytes: number
    fileId: string
    now: number
    r2Key: string
    userId: string
  }): Promise<void> {
    const [intent] = await this.db
      .select()
      .from(r2UploadIntents)
      .where(and(
        eq(r2UploadIntents.userId, args.userId),
        eq(r2UploadIntents.r2Key, args.r2Key),
      ))
      .limit(1)
    if (!intent) throw new Error('upload_intent_not_found')
    const actualSizeBytes = Math.max(0, Math.round(args.actualSizeBytes))
    if (
      intent.status === 'finalized' &&
      intent.fileId === args.fileId &&
      intent.actualSizeBytes === actualSizeBytes
    ) {
      return
    }
    if (intent.status !== 'pending') throw new Error('upload_intent_not_pending')
    if (actualSizeBytes > intent.declaredSizeBytes) {
      throw new Error('upload_size_exceeds_intent')
    }
    await this.db
      .update(r2UploadIntents)
      .set({
        status: 'finalized',
        actualSizeBytes,
        fileId: args.fileId,
        finalizedAt: new Date(args.now),
      })
      .where(eq(r2UploadIntents.id, intent.id))
  }

  async expireUploadIntent(args: {
    intentId: string
    now: number
    userId: string
  }): Promise<void> {
    await this.db
      .update(r2UploadIntents)
      .set({
        status: 'expired',
        expiredAt: new Date(args.now),
      })
      .where(and(
        eq(r2UploadIntents.id, args.intentId),
        eq(r2UploadIntents.userId, args.userId),
        eq(r2UploadIntents.status, 'pending'),
      ))
  }

  async getR2KeysForSubtree(args: {
    fileId: string
    userId: string
  }): Promise<FileSubtreeStorageEntry[]> {
    const rows = await this.getSubtreeRows(this.db, args)
    return rows.map((row) => ({
      fileId: row.id,
      r2Key: row.r2Key ?? undefined,
      storageId: row.storageId ?? undefined,
    }))
  }

  async getStorageUrlForProxy(args: {
    fileId: string
    userId: string
  }): Promise<FileStorageProxyTarget | null> {
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(
        eq(files.id, args.fileId),
        eq(files.userId, args.userId),
        isNull(files.deletedAt),
      ))
      .limit(1)
    if (!row?.r2Key) return null
    if (!validStorageKeyForKind(args.userId, inferKind(row), row.r2Key)) return null
    return {
      r2Key: row.r2Key,
      name: row.name,
      sizeBytes: row.sizeBytes ?? 0,
    }
  }

  async recordFileBandwidth(): Promise<void> {
    // Postgres app-data currently runs with billing.provider=none, so bandwidth accounting is explicit no-op.
  }

  async getStorageEntitlements(args: {
    userId: string
  }): Promise<FileStorageEntitlements | null> {
    return {
      overlayStorageBytesUsed: await this.getStorageBytesUsed(this.db, args.userId),
      overlayStorageBytesLimit: UNLIMITED_STORAGE_BYTES,
    }
  }

  async setShare(args: {
    fileId: string
    userId: string
    visibility: 'private' | 'public'
  }): Promise<FileShareResult | null> {
    const now = new Date()
    const [existing] = await this.db
      .select()
      .from(files)
      .where(and(
        eq(files.id, args.fileId),
        eq(files.userId, args.userId),
        isNull(files.deletedAt),
      ))
      .limit(1)
    if (!existing || existing.type === 'folder') return null

    if (args.visibility === 'public') {
      const token = existing.shareToken ?? generateShareToken()
      await this.db
        .update(files)
        .set({
          shareToken: token,
          shareVisibility: 'public',
          sharedAt: now,
          updatedAt: now,
        })
        .where(eq(files.id, args.fileId))
      return { token, visibility: 'public' }
    }

    await this.db
      .update(files)
      .set({
        shareToken: generateShareToken(),
        shareVisibility: 'private',
        updatedAt: now,
      })
      .where(eq(files.id, args.fileId))
    return { token: null, visibility: 'private' }
  }

  private async assertParentAndProject(db: FileDb, args: {
    fileId?: string
    userId: string
    parentId?: string
    projectId?: string
  }): Promise<void> {
    if (args.parentId) {
      const [parent] = await db
        .select({ id: files.id, kind: files.kind, type: files.type })
        .from(files)
        .where(and(
          eq(files.id, args.parentId),
          eq(files.userId, args.userId),
          isNull(files.deletedAt),
        ))
        .limit(1)
      if (!parent || inferKind(parent) !== 'folder') throw new Error('Unauthorized')
      if (args.fileId) {
        const cycle = await db.execute<{ id: string }>(sql`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id
            FROM files
            WHERE id = ${args.parentId}
              AND user_id = ${args.userId}
              AND deleted_at IS NULL
            UNION ALL
            SELECT parent.id, parent.parent_id
            FROM files parent
            JOIN ancestors child ON child.parent_id = parent.id
            WHERE parent.user_id = ${args.userId}
              AND parent.deleted_at IS NULL
          )
          SELECT id
          FROM ancestors
          WHERE id = ${args.fileId}
          LIMIT 1
        `)
        if (cycle.rows.length > 0) throw new Error('File parent cycle detected')
      }
    }
    if (args.projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(
          eq(projects.id, args.projectId),
          eq(projects.userId, args.userId),
          isNull(projects.deletedAt),
        ))
        .limit(1)
      if (!project) throw new Error('Unauthorized')
    }
  }

  private async getPendingUploadIntentBytes(db: FileDb, userId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(declared_size_bytes), 0) AS pending_bytes
      FROM r2_upload_intents
      WHERE user_id = ${userId}
        AND status = 'pending'
        AND expires_at >= ${new Date(Date.now() - UPLOAD_INTENT_FINALIZE_GRACE_MS)}
    `)
    return Number(result.rows[0]?.pending_bytes ?? 0)
  }

  private async getStorageBytesUsed(db: FileDb, userId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(size_bytes), 0) AS storage_bytes
      FROM files
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
        AND type = 'file'
        AND COALESCE(kind, 'upload') <> 'output'
        AND size_bytes > 0
    `)
    return Number(result.rows[0]?.storage_bytes ?? 0)
  }

  private async findCanonicalDuplicate(db: FileDb, args: {
    contentHash: string
    ignoreFileId?: string
    userId: string
  }): Promise<FileRow | null> {
    const filters = [
      eq(files.userId, args.userId),
      eq(files.contentHash, args.contentHash),
      isNull(files.duplicateOfFileId),
      isNull(files.deletedAt),
      args.ignoreFileId ? ne(files.id, args.ignoreFileId) : undefined,
    ].filter(Boolean)
    const [row] = await db
      .select()
      .from(files)
      .where(and(...filters))
      .orderBy(files.createdAt)
      .limit(1)
    return row ?? null
  }

  private async promoteDuplicate(db: FileDb, args: {
    canonicalFileId: string
    excludeFileIds?: Set<string>
    userId: string
  }): Promise<string | null> {
    const candidates = await db
      .select()
      .from(files)
      .where(and(
        eq(files.userId, args.userId),
        eq(files.duplicateOfFileId, args.canonicalFileId),
        isNull(files.deletedAt),
      ))
      .orderBy(files.createdAt)
    const promoted = candidates.find((candidate) => !args.excludeFileIds?.has(candidate.id))
    if (!promoted) return null
    await db
      .update(files)
      .set({
        duplicateOfFileId: null,
        indexStatus: 'pending',
        updatedAt: new Date(),
      })
      .where(eq(files.id, promoted.id))
    if (promoted.indexable) {
      await enqueueKnowledgeReindexJob(db, {
        contentHash: promoted.contentHash ?? hashKnowledgeContent(textOf(promoted)),
        sourceId: promoted.id,
        sourceKind: 'file',
        userId: promoted.userId,
      })
    }
    await db
      .update(files)
      .set({
        duplicateOfFileId: promoted.id,
        updatedAt: new Date(),
      })
      .where(and(
        eq(files.userId, args.userId),
        eq(files.duplicateOfFileId, args.canonicalFileId),
        ne(files.id, promoted.id),
        isNull(files.deletedAt),
      ))
    return promoted.id
  }

  private async getSubtreeRows(db: FileDb, args: {
    fileId: string
    userId: string
    workspaceId?: string
  }): Promise<Array<FileRow & { depth: number }>> {
    const workspaceFilter = args.workspaceId
      ? sql`AND workspace_id = ${args.workspaceId}`
      : sql``
    const result = await db.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT *, 0 AS depth
        FROM files
        WHERE id = ${args.fileId}
          AND user_id = ${args.userId}
          AND deleted_at IS NULL
          ${workspaceFilter}
        UNION ALL
        SELECT child.*, subtree.depth + 1 AS depth
        FROM files child
        JOIN subtree ON child.parent_id = subtree.id
        WHERE child.user_id = ${args.userId}
          AND child.deleted_at IS NULL
          ${workspaceFilter}
      )
      SELECT *
      FROM subtree
      ORDER BY depth DESC, updated_at DESC
    `)
    return result.rows.map((row) => fileRowFromRaw(row))
  }
}

function hashKnowledgeContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function lockFileHierarchy(db: Pick<OverlayPostgresDb, 'execute'>, userId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'files:' + userId}, 0))`)
}

async function lockStorageQuota(db: Pick<OverlayPostgresDb, 'execute'>, userId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'storage:' + userId}, 0))`)
}

function normalizeFile(row: FileRow): FileRecord {
  const kind = inferKind(row)
  const text = textOf(row)
  const blobBacked = Boolean(row.storageId ?? row.r2Key)
  const hasInlineText = Boolean(text.trim())
  const storageBackedForDownload = blobBacked && !hasInlineText
  return {
    _id: row.id,
    userId: row.userId,
    name: row.name,
    type: row.type,
    kind,
    parentId: row.parentId ?? null,
    content: storageBackedForDownload ? `/api/v1/files/${row.id}/content` : text,
    textContent: text,
    storageId: row.storageId ?? undefined,
    r2Key: row.r2Key ?? undefined,
    mimeType: row.mimeType ?? undefined,
    extension: row.extension ?? extensionOf(row.name),
    sizeBytes: row.sizeBytes ?? (text ? utf8ByteLength(text) : 0),
    contentHash: row.contentHash ?? undefined,
    duplicateOfFileId: row.duplicateOfFileId ?? undefined,
    indexable: row.indexable ?? isTextIndexable(kind, text),
    indexStatus: row.indexStatus ?? (isTextIndexable(kind, text) ? 'pending' : 'skipped'),
    indexedAt: row.indexedAt?.getTime(),
    indexError: row.indexError ?? undefined,
    isStorageBacked: storageBackedForDownload,
    downloadUrl: storageBackedForDownload ? `/api/v1/files/${row.id}/content` : undefined,
    conversationId: row.conversationId ?? undefined,
    turnId: row.turnId ?? undefined,
    modelId: row.modelId ?? undefined,
    prompt: row.prompt ?? undefined,
    outputType: row.outputType ?? undefined,
    outputSource: row.outputSource ?? undefined,
    outputStatus: row.outputStatus ?? undefined,
    outputUrl: row.outputUrl ?? undefined,
    outputMetadata: row.outputMetadata ?? undefined,
    outputErrorMessage: row.outputErrorMessage ?? undefined,
    outputCompletedAt: row.outputCompletedAt?.getTime(),
    expiresAt: row.expiresAt?.getTime(),
    legacyNoteId: row.legacyNoteId ?? undefined,
    legacyOutputId: row.legacyOutputId ?? undefined,
    projectId: row.projectId ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt?.getTime(),
  }
}

function normalizeFileSummary(row: FileRow): FileRecord {
  const {
    content: _content,
    textContent: _textContent,
    ...normalized
  } = normalizeFile(row)
  void _content
  void _textContent
  return {
    ...normalized,
    previewText: inferKind(row) === 'note' ? previewTextOf(textOf(row)) : undefined,
  }
}

function fileRowFromRaw(row: Record<string, unknown>): FileRow & { depth: number } {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    type: row.type as FileType,
    kind: (row.kind ?? null) as FileKind | null,
    parentId: nullableString(row.parent_id),
    content: nullableString(row.content),
    textContent: nullableString(row.text_content),
    storageId: nullableString(row.storage_id),
    r2Key: nullableString(row.r2_key),
    mimeType: nullableString(row.mime_type),
    extension: nullableString(row.extension),
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    contentHash: nullableString(row.content_hash),
    duplicateOfFileId: nullableString(row.duplicate_of_file_id),
    indexable: row.indexable === null || row.indexable === undefined ? null : Boolean(row.indexable),
    indexStatus: row.index_status as FileRow['indexStatus'],
    indexedAt: dateFromRaw(row.indexed_at),
    indexError: nullableString(row.index_error),
    embeddingModelVersion: nullableString(row.embedding_model_version),
    conversationId: nullableString(row.conversation_id),
    turnId: nullableString(row.turn_id),
    modelId: nullableString(row.model_id),
    prompt: nullableString(row.prompt),
    outputType: nullableString(row.output_type),
    outputSource: row.output_source as FileRow['outputSource'],
    outputStatus: row.output_status as FileRow['outputStatus'],
    outputUrl: nullableString(row.output_url),
    outputMetadata: recordValue(row.output_metadata) ?? null,
    outputErrorMessage: nullableString(row.output_error_message),
    outputCompletedAt: dateFromRaw(row.output_completed_at),
    expiresAt: dateFromRaw(row.expires_at),
    legacyNoteId: nullableString(row.legacy_note_id),
    legacyOutputId: nullableString(row.legacy_output_id),
    projectId: nullableString(row.project_id),
    createdAt: requiredDateFromRaw(row.created_at),
    updatedAt: requiredDateFromRaw(row.updated_at),
    deletedAt: dateFromRaw(row.deleted_at),
    workspaceId: nullableString(row.workspace_id),
    shareToken: nullableString(row.share_token),
    shareVisibility: row.share_visibility as FileRow['shareVisibility'],
    sharedAt: dateFromRaw(row.shared_at),
    depth: Number(row.depth ?? 0),
  }
}

function inferKind(file: Pick<FileRow, 'kind' | 'type'>): FileKind {
  return file.kind ?? (file.type === 'folder' ? 'folder' : 'upload')
}

function textOf(file: Pick<FileRow, 'content' | 'textContent'>): string {
  return file.textContent ?? file.content ?? ''
}

function isTextIndexable(kind: FileKind, text: string): boolean {
  if (kind === 'folder') return false
  return text.trim().length > 0
}

function validStorageKeyForKind(userId: string, kind: FileKind, r2Key: string): boolean {
  return kind === 'output' ? isOwnedOutputR2Key(userId, r2Key) : isOwnedFileR2Key(userId, r2Key)
}

function previewTextOf(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/gi, (entity, name: string) => (
      PREVIEW_HTML_ENTITIES[name.toLowerCase()] ?? entity
    ))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, FILE_PREVIEW_CHARS)
}

function resolveKind(kind: unknown, type: unknown): FileKind {
  if (isFileKind(kind)) return kind
  return type === 'folder' ? 'folder' : 'upload'
}

function isFileKind(value: unknown): value is FileKind {
  return value === 'folder' || value === 'note' || value === 'upload' || value === 'output'
}

function extensionOf(name: string): string | undefined {
  const clean = name.trim()
  const dot = clean.lastIndexOf('.')
  if (dot <= 0 || dot === clean.length - 1) return undefined
  return clean.slice(dot + 1).toLowerCase()
}

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} required`)
  return value
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function outputSourceValue(value: unknown): OutputSource | undefined {
  return value === 'image_generation' ||
    value === 'video_generation' ||
    value === 'browser' ||
    value === 'sandbox'
    ? value
    : undefined
}

function outputStatusValue(value: unknown): OutputStatus | undefined {
  return value === 'pending' || value === 'completed' || value === 'failed'
    ? value
    : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.max(0, Math.round(Number(value)))
  }
  return undefined
}

function dateValue(value: unknown): Date | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value)
  if (value instanceof Date) return value
  return undefined
}

function dateFromRaw(value: unknown): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(String(value))
}

function requiredDateFromRaw(value: unknown): Date {
  return dateFromRaw(value) ?? new Date(0)
}

function fileId(): string {
  return `file${randomUUID().replaceAll('-', '')}`
}

function uploadIntentId(): string {
  return `upload${randomUUID().replaceAll('-', '')}`
}

function generateShareToken(): string {
  return randomBytes(16).toString('base64url')
}
