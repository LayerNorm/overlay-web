import 'server-only'

import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { files, knowledgeChunks, memories } from '@/server/database/postgres/schema'
import { enqueueKnowledgeReindexJob } from './PostgresKnowledgeIndexJobs'

export type KnowledgeMaintenanceResult = {
  backfillQueued: number
  failedRecovered: number
  orphanChunksPurged: number
  retainedMemoriesDeleted: number
}

export class PostgresKnowledgeMaintenanceService {
  constructor(private readonly db: OverlayPostgresDb) {}

  async runAll(args: {
    memoryRetentionDays?: number
    modelVersion: string
    now?: Date
    limit?: number
  }): Promise<KnowledgeMaintenanceResult> {
    const now = args.now ?? new Date()
    const limit = normalizeLimit(args.limit)
    const [backfillQueued, failedRecovered, retainedMemoriesDeleted, orphanChunksPurged] = await Promise.all([
      this.enqueueModelBackfill({ limit, modelVersion: args.modelVersion }),
      this.recoverFailedIndexes({ limit, modelVersion: args.modelVersion, now }),
      this.applyMemoryRetention({ days: args.memoryRetentionDays, limit, now }),
      this.purgeOrphanChunks({ limit }),
    ])
    return { backfillQueued, failedRecovered, orphanChunksPurged, retainedMemoriesDeleted }
  }

  async enqueueModelBackfill(args: { limit?: number; modelVersion: string }): Promise<number> {
    const limit = normalizeLimit(args.limit)
    const fileRows = await this.db.select({
      contentHash: files.contentHash,
      id: files.id,
      userId: files.userId,
    }).from(files).where(and(
      eq(files.indexable, true),
      isNull(files.duplicateOfFileId),
      isNull(files.deletedAt),
      or(isNull(files.embeddingModelVersion), ne(files.embeddingModelVersion, args.modelVersion)),
    )).orderBy(asc(files.updatedAt)).limit(limit)
    const remaining = Math.max(0, limit - fileRows.length)
    const memoryRows = remaining > 0
      ? await this.db.select({
          contentHash: memories.contentHash,
          id: memories.id,
          userId: memories.userId,
        }).from(memories).where(and(
          isNull(memories.deletedAt),
          or(isNull(memories.embeddingModelVersion), ne(memories.embeddingModelVersion, args.modelVersion)),
        )).orderBy(asc(memories.updatedAt)).limit(remaining)
      : []
    let queued = 0
    for (const row of fileRows) {
      if (!row.contentHash) continue
      await enqueueKnowledgeReindexJob(this.db, {
        contentHash: row.contentHash,
        modelVersion: args.modelVersion,
        sourceId: row.id,
        sourceKind: 'file',
        userId: row.userId,
      })
      queued += 1
    }
    for (const row of memoryRows) {
      await enqueueKnowledgeReindexJob(this.db, {
        contentHash: row.contentHash,
        modelVersion: args.modelVersion,
        sourceId: row.id,
        sourceKind: 'memory',
        userId: row.userId,
      })
      queued += 1
    }
    return queued
  }

  async recoverFailedIndexes(args: {
    limit?: number
    modelVersion?: string
    now?: Date
    staleMinutes?: number
  } = {}): Promise<number> {
    const limit = normalizeLimit(args.limit)
    const cutoff = new Date((args.now ?? new Date()).getTime() - (args.staleMinutes ?? 15) * 60_000)
    const fileRows = await this.db.select({
      contentHash: files.contentHash,
      id: files.id,
      userId: files.userId,
    }).from(files).where(and(
      eq(files.indexable, true),
      isNull(files.duplicateOfFileId),
      isNull(files.deletedAt),
      or(eq(files.indexStatus, 'failed'), and(eq(files.indexStatus, 'pending'), lt(files.updatedAt, cutoff))),
    )).orderBy(asc(files.updatedAt)).limit(limit)
    const remaining = Math.max(0, limit - fileRows.length)
    const memoryRows = remaining > 0
      ? await this.db.select({
          contentHash: memories.contentHash,
          id: memories.id,
          userId: memories.userId,
        }).from(memories).where(and(
          isNull(memories.deletedAt),
          or(eq(memories.indexStatus, 'failed'), and(eq(memories.indexStatus, 'pending'), lt(memories.updatedAt, cutoff))),
        )).orderBy(asc(memories.updatedAt)).limit(remaining)
      : []
    let recovered = 0
    for (const row of fileRows) {
      if (!row.contentHash) continue
      await enqueueKnowledgeReindexJob(this.db, {
        contentHash: row.contentHash,
        modelVersion: args.modelVersion,
        reviveDeadLetter: true,
        sourceId: row.id,
        sourceKind: 'file',
        userId: row.userId,
      })
      await this.db.update(files).set({ indexError: null, indexStatus: 'pending' }).where(eq(files.id, row.id))
      recovered += 1
    }
    for (const row of memoryRows) {
      await enqueueKnowledgeReindexJob(this.db, {
        contentHash: row.contentHash,
        modelVersion: args.modelVersion,
        reviveDeadLetter: true,
        sourceId: row.id,
        sourceKind: 'memory',
        userId: row.userId,
      })
      await this.db.update(memories).set({ indexError: null, indexStatus: 'pending' }).where(eq(memories.id, row.id))
      recovered += 1
    }
    return recovered
  }

  async applyMemoryRetention(args: {
    days?: number
    limit?: number
    now?: Date
  }): Promise<number> {
    if (!args.days || args.days <= 0) return 0
    const cutoff = new Date((args.now ?? new Date()).getTime() - args.days * 24 * 60 * 60_000)
    return await this.db.transaction(async (tx) => {
      const rows = await tx.select({ id: memories.id })
        .from(memories)
        .where(and(isNull(memories.deletedAt), lt(memories.updatedAt, cutoff)))
        .orderBy(asc(memories.updatedAt))
        .limit(normalizeLimit(args.limit))
      if (rows.length === 0) return 0
      await tx.delete(knowledgeChunks).where(and(
        eq(knowledgeChunks.sourceKind, 'memory'),
        inArray(knowledgeChunks.sourceId, rows.map((row) => row.id)),
      ))
      await tx.update(memories).set({ deletedAt: args.now ?? new Date(), indexStatus: 'skipped' })
        .where(inArray(memories.id, rows.map((row) => row.id)))
      return rows.length
    })
  }

  async purgeOrphanChunks(args: { limit?: number } = {}): Promise<number> {
    const result = await this.db.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT chunk.id
        FROM knowledge_chunks chunk
        WHERE (
          chunk.source_kind = 'file' AND NOT EXISTS (
            SELECT 1 FROM files file
            WHERE file.id = chunk.source_id
              AND file.user_id = chunk.user_id
              AND file.deleted_at IS NULL
          )
        ) OR (
          chunk.source_kind = 'memory' AND NOT EXISTS (
            SELECT 1 FROM memories memory
            WHERE memory.id = chunk.source_id
              AND memory.user_id = chunk.user_id
              AND memory.deleted_at IS NULL
          )
        )
        ORDER BY chunk.created_at
        LIMIT ${normalizeLimit(args.limit)}
      ), deleted AS (
        DELETE FROM knowledge_chunks chunk
        USING candidates
        WHERE chunk.id = candidates.id
        RETURNING chunk.id
      )
      SELECT id FROM deleted
    `)
    return result.rows.length
  }
}

function normalizeLimit(value?: number): number {
  return Math.min(Math.max(Math.floor(value ?? 250), 1), 2_000)
}
