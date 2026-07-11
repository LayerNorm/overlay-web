import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq, sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { PostgresConversationEventNotifier } from '@/server/conversations/PostgresConversationEventNotifier'
import { UnlimitedUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import { PostgresFileRepository } from '@/server/files/PostgresFileRepository'
import { PostgresNoteRepository } from '@/server/notes'
import { PostgresProjectRepository } from '@/server/projects/PostgresProjectRepository'
import { PostgresUserRepository } from '@/server/users/PostgresUserRepository'
import { runAppDataRepositoryContractSuite } from './app-data-repository-contract'
import { durableJobs, files, users } from '@/server/database/postgres/schema'
import {
  enqueueStorageCleanupJobs,
  STORAGE_DELETE_OBJECTS_JOB,
} from '@/server/storage/PostgresStorageCleanupJobs'
import { PostgresStorageReconciliationService } from '@/server/storage/PostgresStorageReconciliationService'
import { createPostgresRuntime } from '@/server/jobs/postgres-runtime'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres app-data repository contracts', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres app-data contracts',
}, async (t) => {
  if (!connectionString) return

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const notifier = new PostgresConversationEventNotifier(pool)

  try {
    await t.test('Postgres project and file lifecycle constraints are installed', async () => {
      const result = await db.execute(sql`
        SELECT conname
        FROM pg_constraint
        WHERE conname IN (
          'projects_parent_id_projects_id_fk',
          'projects_parent_not_self_check',
          'files_parent_id_files_id_fk',
          'files_duplicate_of_file_id_files_id_fk',
          'files_parent_not_self_check',
          'files_duplicate_not_self_check'
        )
      `)
      assert.deepEqual(
        result.rows.map((row) => String(row.conname)).sort(),
        [
          'files_duplicate_not_self_check',
          'files_duplicate_of_file_id_files_id_fk',
          'files_parent_id_files_id_fk',
          'files_parent_not_self_check',
          'projects_parent_id_projects_id_fk',
          'projects_parent_not_self_check',
        ],
      )
      const index = await db.execute<{ indexdef: string }>(sql`
        SELECT indexdef
        FROM pg_indexes
        WHERE indexname = 'r2_upload_intents_r2_key_idx'
      `)
      assert.match(index.rows[0]?.indexdef ?? '', /CREATE UNIQUE INDEX/i)
    })
    await db.delete(durableJobs)
    await runAppDataRepositoryContractSuite(t, {
      name: 'postgres',
      provider: 'postgres',
      authProvider: 'better-auth',
      accountDeletionRepository: new PostgresAccountDataDeletionRepository(db),
      conversations: new PostgresActConversationRepository(
        db,
        notifier,
      ),
      files: new PostgresFileRepository(db),
      notes: new PostgresNoteRepository(db),
      projects: new PostgresProjectRepository(db),
      usagePolicy: new UnlimitedUsagePolicy(),
      users: new PostgresUserRepository(db),
    })
    await t.test('Postgres file and account lifecycle enqueue durable object cleanup', async () => {
      const queued = await db
        .select({ id: durableJobs.id })
        .from(durableJobs)
        .where(eq(durableJobs.type, STORAGE_DELETE_OBJECTS_JOB))
      assert.ok(queued.length >= 2)
    })
    await t.test('Postgres worker executes durable object cleanup jobs', async () => {
      await db.delete(durableJobs)
      const deleted: string[] = []
      const userId = `contract_worker_${randomUUID()}`
      const key = `users/${userId}/files/file_1/report.pdf`
      await enqueueStorageCleanupJobs(db, {
        dedupeKey: `contract-worker:${randomUUID()}`,
        keys: [key],
        reason: 'contract-worker',
        userId,
      })
      const runtime = createPostgresRuntime({
        db,
        leaseMs: 5_000,
        objectStore: {
          deleteObject: async (objectKey) => { deleted.push(objectKey) },
          listObjects: async () => [],
        },
        workerId: `contract-worker-${randomUUID()}`,
      })
      assert.equal(await runtime.worker.runOnce(), 'succeeded')
      assert.deepEqual(deleted, [key])
    })

    await t.test('Postgres storage reconciliation queues orphans and marks missing objects', async () => {
      const suffix = randomUUID()
      const userId = `contract_storage_${suffix}`
      const fileId = `file_${suffix}`
      const missingKey = `users/${userId}/files/${fileId}/missing.txt`
      const orphanKey = `users/${userId}/files/orphan/orphan.txt`
      const now = Date.now()
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        createdAt: new Date(now - 120_000),
        updatedAt: new Date(now - 120_000),
      })
      await db.insert(files).values({
        id: fileId,
        userId,
        name: 'missing.txt',
        type: 'file',
        kind: 'upload',
        r2Key: missingKey,
        sizeBytes: 10,
        indexable: false,
        indexStatus: 'skipped',
        createdAt: new Date(now - 120_000),
        updatedAt: new Date(now - 120_000),
      })
      try {
        const service = new PostgresStorageReconciliationService(db, {
          listObjects: async () => [{
            key: orphanKey,
            lastModified: new Date(now - 120_000).toISOString(),
            sizeBytes: 10,
          }],
        })
        const result = await service.run({ missingGraceMs: 60_000, now, orphanGraceMs: 60_000 })
        assert.equal(result.missingObjects, 1)
        assert.equal(result.orphanObjects, 1)
        assert.equal(result.orphanCleanupJobs, 1)
        const [missing] = await db.select().from(files).where(eq(files.id, fileId)).limit(1)
        assert.equal(missing?.indexStatus, 'failed')
        assert.match(missing?.indexError ?? '', /missing/i)
      } finally {
        await db.delete(users).where(eq(users.id, userId))
      }
    })
    await db.delete(durableJobs)
  } finally {
    await notifier.close()
    await pool.end()
  }
})
