import 'server-only'

import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { files } from '@/server/database/postgres/schema'
import { enqueueStorageCleanupJobs } from '@/server/storage/PostgresStorageCleanupJobs'

export class PostgresOutputRetentionService {
  constructor(private readonly db: OverlayPostgresDb) {}

  async purgeExpired(args: { limit?: number; now?: number } = {}): Promise<{
    deleted: number
    cleanupJobs: number
  }> {
    const now = new Date(args.now ?? Date.now())
    const limit = Math.min(Math.max(args.limit ?? 250, 1), 1_000)
    return await this.db.transaction(async (tx) => {
      const expired = await tx
        .select({ id: files.id, r2Key: files.r2Key, userId: files.userId })
        .from(files)
        .where(and(
          eq(files.kind, 'output'),
          isNull(files.deletedAt),
          lte(files.expiresAt, now),
        ))
        .orderBy(asc(files.expiresAt))
        .limit(limit)
        .for('update', { skipLocked: true })
      if (expired.length === 0) return { deleted: 0, cleanupJobs: 0 }

      const deleted = await tx
        .update(files)
        .set({ deletedAt: now, updatedAt: now, indexStatus: 'skipped' })
        .where(and(
          inArray(files.id, expired.map((row) => row.id)),
          isNull(files.deletedAt),
        ))
        .returning({ id: files.id })

      let cleanupJobs = 0
      const byUser = new Map<string, string[]>()
      for (const row of expired) {
        if (!row.r2Key) continue
        byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.r2Key])
      }
      for (const [userId, keys] of byUser) {
        cleanupJobs += await enqueueStorageCleanupJobs(tx, {
          dedupeKey: `output-retention:${userId}:${now.getTime()}`,
          keys,
          reason: 'output-retention',
          userId,
        })
      }
      return { deleted: deleted.length, cleanupJobs }
    })
  }
}
