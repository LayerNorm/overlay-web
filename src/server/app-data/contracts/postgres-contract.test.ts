import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq, inArray, sql } from 'drizzle-orm'
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
import {
  durableJobs,
  files,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  memories,
  projects,
  users,
} from '@/server/database/postgres/schema'
import { KNOWLEDGE_EMBEDDING_DIMENSIONS, type EmbeddingProvider } from '@/server/knowledge'
import { PostgresKnowledgeSearchRepository } from '@/server/knowledge'
import {
  enqueueStorageCleanupJobs,
  STORAGE_DELETE_OBJECTS_JOB,
} from '@/server/storage/PostgresStorageCleanupJobs'
import { PostgresStorageReconciliationService } from '@/server/storage/PostgresStorageReconciliationService'
import { createPostgresRuntime } from '@/server/jobs/postgres-runtime'
import { PostgresDaytonaWorkspaceRepository } from '@/server/ai/sandbox/PostgresDaytonaWorkspaceRepository'
import { PostgresOutputRetentionService } from '@/server/outputs/PostgresOutputRetentionService'
import { PostgresMemoryRepository } from '@/server/memory'
import { PostgresChatSuggestionRepository } from '@/server/chat-suggestions/PostgresChatSuggestionRepository'

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
    await t.test('Postgres memories preserve CRUD, dedupe, scope, and deletion semantics', async () => {
      const suffix = randomUUID()
      const userId = `contract_memory_${suffix}`
      const otherUserId = `contract_memory_other_${suffix}`
      await db.insert(users).values([
        { id: userId, email: `${userId}@example.com` },
        { id: otherUserId, email: `${otherUserId}@example.com` },
      ])
      const repository = new PostgresMemoryRepository(db)
      try {
        const created = await repository.create({
          clientId: `memory-client-${suffix}`,
          content: 'The pilot uses a private AWS deployment.',
          source: 'manual',
          tags: ['pilot'],
          userId,
        })
        const duplicate = await repository.create({
          content: '  the PILOT uses a private AWS deployment.  ',
          source: 'manual',
          userId,
        })
        assert.equal(duplicate._id, created._id)
        assert.equal((await repository.list({ userId })).length, 1)
        assert.equal(await repository.get({ memoryId: created._id, userId: otherUserId }), null)

        const updated = await repository.update({
          content: 'The pilot uses private AWS infrastructure in ap-south-1.',
          memoryId: created._id,
          source: 'manual',
          tags: ['pilot', 'aws'],
          userId,
        })
        assert.deepEqual(updated?.tags, ['pilot', 'aws'])
        const removed = await repository.remove({ memoryId: created._id, userId })
        assert.equal(removed?.memoryId, created._id)
        assert.equal(await repository.get({ memoryId: created._id, userId }), null)
        assert.ok(await repository.get({ includeDeleted: true, memoryId: created._id, userId }))
      } finally {
        await db.delete(users).where(eq(users.id, userId))
        await db.delete(users).where(eq(users.id, otherUserId))
      }
    })
    await t.test('Postgres worker indexes and replaces memory knowledge with versioned vectors', async () => {
      await db.delete(durableJobs)
      const suffix = randomUUID()
      const userId = `contract_index_${suffix}`
      await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
      const projectId = `project_${suffix}`
      const otherProjectId = `project_other_${suffix}`
      await db.insert(projects).values([
        { id: projectId, name: 'Target', userId },
        { id: otherProjectId, name: 'Other', userId },
      ])
      const repository = new PostgresMemoryRepository(db)
      const embeddings: EmbeddingProvider = {
        identity: {
          dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
          modelId: 'contract-embedding',
          modelVersion: 'contract-v1',
          provider: 'openai',
        },
        embed: async (texts) => texts.map((text) => {
          const vector = Array<number>(KNOWLEDGE_EMBEDDING_DIMENSIONS).fill(0)
          vector[0] = Math.min(1, text.length / 10_000)
          vector[1] = 1
          return vector
        }),
      }
      try {
        const memory = await repository.create({
          content: 'JPGS keeps pilot knowledge inside its private AWS account. '.repeat(50),
          source: 'manual',
          userId,
        })
        const projectMemory = await repository.create({
          content: 'Target project AWS knowledge for the scoped pilot.',
          projectId,
          source: 'manual',
          userId,
        })
        const otherProjectMemory = await repository.create({
          content: 'Other project AWS knowledge that must remain out of scope.',
          projectId: otherProjectId,
          source: 'manual',
          userId,
        })
        const runtime = createPostgresRuntime({
          db,
          embeddingProvider: embeddings,
          leaseMs: 5_000,
          workerId: `knowledge-worker-${suffix}`,
        })
        assert.equal(await runtime.worker.runOnce(), 'succeeded')
        assert.equal(await runtime.worker.runOnce(), 'succeeded')
        assert.equal(await runtime.worker.runOnce(), 'succeeded')
        const indexedChunks = await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, memory._id))
        assert.ok(indexedChunks.length >= 2)
        const vectorRows = await db.select().from(knowledgeChunkEmbeddings).where(eq(knowledgeChunkEmbeddings.userId, userId))
        assert.ok(vectorRows.length >= indexedChunks.length)
        assert.equal(vectorRows[0]?.modelVersion, 'contract-v1')
        const [indexedMemory] = await db.select().from(memories).where(eq(memories.id, memory._id))
        assert.equal(indexedMemory?.indexStatus, 'indexed')
        assert.equal(indexedMemory?.embeddingModelVersion, 'contract-v1')

        const search = await new PostgresKnowledgeSearchRepository({ db, embeddings }).hybridSearch({
          projectId: undefined,
          query: 'private AWS account',
          userId,
        })
        assert.ok(search.chunks.some((chunk) => chunk.sourceId === memory._id))
        assert.ok(search.chunks.every((chunk) => chunk.sourceKind === 'memory'))
        const foreignSearch = await new PostgresKnowledgeSearchRepository({ db, embeddings }).hybridSearch({
          query: 'private AWS account',
          userId: `not_${userId}`,
        })
        assert.deepEqual(foreignSearch.chunks, [])
        const scopedSearch = await new PostgresKnowledgeSearchRepository({ db, embeddings }).hybridSearch({
          projectId,
          query: 'AWS knowledge pilot',
          userId,
        })
        assert.ok(scopedSearch.chunks.some((chunk) => chunk.sourceId === projectMemory._id))
        assert.ok(scopedSearch.chunks.some((chunk) => chunk.sourceId === memory._id))
        assert.equal(scopedSearch.chunks.some((chunk) => chunk.sourceId === otherProjectMemory._id), false)
        assert.equal(scopedSearch.chunks[0]?.sourceId, projectMemory._id)

        await repository.remove({ memoryId: memory._id, userId })
        assert.equal((await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, memory._id))).length, 0)
        assert.equal((await db.select().from(knowledgeChunkEmbeddings).where(inArray(
          knowledgeChunkEmbeddings.chunkId,
          indexedChunks.map((chunk) => chunk.id),
        ))).length, 0)
      } finally {
        await db.delete(users).where(eq(users.id, userId))
        await db.delete(durableJobs)
      }
    })
    await runAppDataRepositoryContractSuite(t, {
      name: 'postgres',
      provider: 'postgres',
      authProvider: 'better-auth',
      chatSuggestions: new PostgresChatSuggestionRepository(db),
      accountDeletionRepository: new PostgresAccountDataDeletionRepository(db),
      conversations: new PostgresActConversationRepository(
        db,
        notifier,
      ),
      daytonaWorkspaces: new PostgresDaytonaWorkspaceRepository(db),
      files: new PostgresFileRepository(db),
      memories: new PostgresMemoryRepository(db),
      notes: new PostgresNoteRepository(db),
      projects: new PostgresProjectRepository(db),
      usagePolicy: new UnlimitedUsagePolicy(),
      users: new PostgresUserRepository(db),
    })
    await t.test('Postgres output retention soft-deletes metadata and queues object cleanup', async () => {
      const userId = `retention_${randomUUID()}`
      await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
      const repository = new PostgresFileRepository(db)
      const outputId = await repository.createFile({
        userId,
        name: 'expired.png',
        kind: 'output',
        type: 'file',
        r2Key: `users/${userId}/outputs/expired/expired.png`,
        outputType: 'image',
        outputSource: 'image_generation',
        outputStatus: 'completed',
        expiresAt: Date.now() - 1_000,
      })
      assert.ok(outputId)
      const result = await new PostgresOutputRetentionService(db).purgeExpired()
      assert.equal(result.deleted, 1)
      assert.ok(result.cleanupJobs >= 1)
      assert.equal(await repository.getFile({ fileId: outputId, userId }), null)
      await db.delete(users).where(eq(users.id, userId))
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
      assert.equal(await enqueueStorageCleanupJobs(db, {
        dedupeKey: `contract-worker:${randomUUID()}`,
        keys: [key],
        reason: 'contract-worker',
        userId,
      }), 1)
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
