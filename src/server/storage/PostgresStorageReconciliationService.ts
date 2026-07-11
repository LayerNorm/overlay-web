import 'server-only'

import { createHash } from 'node:crypto'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { ObjectStore } from '@overlay/app-core'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { files, r2UploadIntents } from '@/server/database/postgres/schema'
import { enqueueStorageCleanupJobs } from './PostgresStorageCleanupJobs'
import { fileKeyPrefixForUser, isOwnedFileR2Key } from './storage-keys'

const DEFAULT_ORPHAN_GRACE_MS = 24 * 60 * 60_000
const DEFAULT_MISSING_GRACE_MS = 15 * 60_000
const UPLOAD_INTENT_FINALIZE_GRACE_MS = 15 * 60_000

export type StorageReconciliationSummary = {
  expiredUploadIntents: number
  missingObjects: number
  orphanCleanupJobs: number
  orphanObjects: number
  scannedObjects: number
}

export class PostgresStorageReconciliationService {
  constructor(
    private readonly db: OverlayPostgresDb,
    private readonly objectStore: Pick<ObjectStore, 'listObjects'>,
  ) {}

  async run(args: {
    missingGraceMs?: number
    now?: number
    orphanGraceMs?: number
  } = {}): Promise<StorageReconciliationSummary> {
    const now = args.now ?? Date.now()
    const expiredUploadIntents = await this.expireUploadIntents(now)
    const [objects, references] = await Promise.all([
      this.objectStore.listObjects('users/'),
      this.loadReferences(now),
    ])
    const fileObjects = objects.filter((object) => parseFileKeyOwner(object.key))
    const objectKeys = new Set(fileObjects.map((object) => object.key))
    const referencedKeys = new Set(references.map((reference) => reference.r2Key))
    const orphanCutoff = now - normalizeGrace(args.orphanGraceMs, DEFAULT_ORPHAN_GRACE_MS)
    const missingCutoff = new Date(now - normalizeGrace(args.missingGraceMs, DEFAULT_MISSING_GRACE_MS))

    const orphanObjects = fileObjects.filter((object) => (
      !referencedKeys.has(object.key) &&
      Boolean(object.lastModified) &&
      new Date(object.lastModified!).getTime() <= orphanCutoff
    ))
    let orphanCleanupJobs = 0
    const byUser = new Map<string, string[]>()
    for (const object of orphanObjects) {
      const userId = parseFileKeyOwner(object.key)
      if (!userId) continue
      const keys = byUser.get(userId) ?? []
      keys.push(object.key)
      byUser.set(userId, keys)
    }
    await this.db.transaction(async (tx) => {
      for (const [userId, keys] of byUser) {
        orphanCleanupJobs += await enqueueStorageCleanupJobs(tx, {
          dedupeKey: `storage-reconcile:${digestKeys(keys)}`,
          keys,
          reason: 'storage-reconcile-orphan',
          userId,
        })
      }
    })

    const missingFileIds = references
      .filter((reference) => reference.createdAt <= missingCutoff && !objectKeys.has(reference.r2Key))
      .map((reference) => reference.fileId)
      .filter((fileId): fileId is string => Boolean(fileId))
    for (const fileId of missingFileIds) {
      await this.db
        .update(files)
        .set({
          indexError: 'Storage object missing during reconciliation',
          indexStatus: 'failed',
          updatedAt: new Date(now),
        })
        .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    }

    return {
      expiredUploadIntents,
      missingObjects: missingFileIds.length,
      orphanCleanupJobs,
      orphanObjects: orphanObjects.length,
      scannedObjects: fileObjects.length,
    }
  }

  private async expireUploadIntents(now: number): Promise<number> {
    return await this.db.transaction(async (tx) => {
      const expired = await tx
        .update(r2UploadIntents)
        .set({ status: 'expired', expiredAt: new Date(now) })
        .where(and(
          eq(r2UploadIntents.status, 'pending'),
          lt(r2UploadIntents.expiresAt, new Date(now - UPLOAD_INTENT_FINALIZE_GRACE_MS)),
        ))
        .returning({
          id: r2UploadIntents.id,
          r2Key: r2UploadIntents.r2Key,
          userId: r2UploadIntents.userId,
        })
      for (const intent of expired) {
        await enqueueStorageCleanupJobs(tx, {
          dedupeKey: `upload-intent-expired:${intent.id}`,
          keys: [intent.r2Key],
          reason: 'upload-intent-expired',
          userId: intent.userId,
        })
      }
      return expired.length
    })
  }

  private async loadReferences(now: number): Promise<Array<{
    createdAt: Date
    fileId: string | null
    r2Key: string
  }>> {
    const result = await this.db.execute<{
      created_at: Date | string
      file_id: string | null
      r2_key: string
    }>(sql`
      SELECT id AS file_id, r2_key, created_at
      FROM files
      WHERE deleted_at IS NULL
        AND r2_key IS NOT NULL
      UNION
      SELECT file_id, r2_key, created_at
      FROM r2_upload_intents
      WHERE status = 'pending'
        AND expires_at >= ${new Date(now - UPLOAD_INTENT_FINALIZE_GRACE_MS)}
    `)
    return result.rows.map((row) => ({
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      fileId: row.file_id,
      r2Key: row.r2_key,
    }))
  }
}

function parseFileKeyOwner(key: string): string | null {
  const match = /^users\/([^/]+)\/files\//.exec(key.trim())
  if (!match?.[1]) return null
  const userId = match[1]
  return isOwnedFileR2Key(userId, key) && key.startsWith(fileKeyPrefixForUser(userId))
    ? userId
    : null
}

function normalizeGrace(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(60_000, value!)
}

function digestKeys(keys: readonly string[]): string {
  return createHash('sha256').update([...keys].sort().join('\n')).digest('hex').slice(0, 32)
}
