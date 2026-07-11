import 'server-only'

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import {
  durableJobs,
  files,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  memories,
  memoryExtractionRuns,
  users,
} from '@/server/database/postgres/schema'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { PostgresDurableJobRepository } from '@/server/jobs/PostgresDurableJobRepository'
import { createPostgresRuntime } from '@/server/jobs/postgres-runtime'
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  PostgresKnowledgeMaintenanceService,
  type EmbeddingProvider,
} from '@/server/knowledge'
import { PostgresMemoryRepository, type MemoryExtractionProvider } from '@/server/memory'
import { PostgresProjectRepository } from '@/server/projects/PostgresProjectRepository'
import { PostgresFileRepository } from '@/server/files/PostgresFileRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres P4d knowledge lifecycle', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const embeddingsV1 = fakeEmbeddings('contract-v1')
  const extractor: MemoryExtractionProvider = {
    modelId: 'contract-memory-extractor',
    extract: async () => [{
      confidence: 0.95,
      content: 'User requires pilot data to remain inside private AWS infrastructure.',
      rationale: 'This is a durable deployment constraint.',
      type: 'decision',
    }],
  }

  try {
    await t.test('completed user turns enqueue extraction and chain into indexing', async () => {
      await db.delete(durableJobs)
      const userId = `p4d_extract_${randomUUID()}`
      await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
      try {
        const conversations = new PostgresActConversationRepository(db)
        const conversationId = await conversations.createConversation({
          actModelId: 'openrouter/free',
          askModelIds: ['openrouter/free'],
          title: 'Extraction contract',
          userId,
        })
        const messageId = await conversations.addMessage({
          content: 'I require all pilot data to remain inside our private AWS infrastructure.',
          contentType: 'text',
          mode: 'act',
          role: 'user',
          turnId: `turn_${randomUUID()}`,
          userId,
          conversationId,
        })
        assert.ok(messageId)
        const [queued] = await db.select().from(durableJobs).where(eq(durableJobs.type, 'memory.extract-turn'))
        assert.equal(queued?.status, 'queued')

        const runtime = createPostgresRuntime({
          db,
          embeddingProvider: embeddingsV1,
          leaseMs: 5_000,
          memoryExtractionProvider: extractor,
          workerId: `p4d-extract-${randomUUID()}`,
        })
        assert.equal(await runtime.worker.runOnce(), 'succeeded')
        assert.equal(await runtime.worker.runOnce(), 'succeeded')
        const [memory] = await db.select().from(memories).where(eq(memories.userId, userId))
        assert.equal(memory?.type, 'decision')
        assert.equal(memory?.conversationId, conversationId)
        assert.equal(memory?.indexStatus, 'indexed')
        const [run] = await db.select().from(memoryExtractionRuns).where(eq(memoryExtractionRuns.userId, userId))
        assert.equal(run?.status, 'succeeded')
        assert.equal(run?.insertedCount, 1)
        assert.ok((await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, memory!.id))).length > 0)
      } finally {
        await db.delete(users).where(eq(users.id, userId))
        await db.delete(durableJobs)
      }
    })

    await t.test('expired indexing lease recovers after worker crash', async () => {
      await db.delete(durableJobs)
      const userId = `p4d_crash_${randomUUID()}`
      await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
      try {
        const memory = await new PostgresMemoryRepository(db).create({
          content: 'Crash recovery marker for durable indexing.',
          source: 'manual',
          userId,
        })
        const jobs = new PostgresDurableJobRepository(db)
        const now = Date.now()
        const claimed = await jobs.claim({ leaseMs: 1_000, now, workerId: 'crashed-worker' })
        assert.equal(claimed?.type, 'knowledge.reindex-source')

        const runtime = createPostgresRuntime({
          db,
          embeddingProvider: embeddingsV1,
          leaseMs: 5_000,
          workerId: `replacement-worker-${randomUUID()}`,
        })
        assert.equal(await runtime.worker.runOnce(now + 1_010), 'succeeded')
        const [row] = await db.select().from(memories).where(eq(memories.id, memory._id))
        assert.equal(row?.indexStatus, 'indexed')
        assert.equal(row?.embeddingModelVersion, 'contract-v1')
      } finally {
        await db.delete(users).where(eq(users.id, userId))
        await db.delete(durableJobs)
      }
    })

    await t.test('model backfill, failed recovery, and retention are operational', async () => {
      await db.delete(durableJobs)
      const userId = `p4d_maintenance_${randomUUID()}`
      await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
      try {
        const repository = new PostgresMemoryRepository(db)
        const memory = await repository.create({
          content: 'Embedding migration marker for the maintenance contract.',
          source: 'manual',
          userId,
        })
        const runtimeV1 = createPostgresRuntime({
          db,
          embeddingProvider: embeddingsV1,
          leaseMs: 5_000,
          workerId: `maintenance-v1-${randomUUID()}`,
        })
        assert.equal(await runtimeV1.worker.runOnce(), 'succeeded')

        const maintenance = new PostgresKnowledgeMaintenanceService(db)
        assert.equal(await maintenance.enqueueModelBackfill({ modelVersion: 'contract-v2' }), 1)
        const runtimeV2 = createPostgresRuntime({
          db,
          embeddingProvider: fakeEmbeddings('contract-v2'),
          leaseMs: 5_000,
          workerId: `maintenance-v2-${randomUUID()}`,
        })
        assert.equal(await runtimeV2.worker.runOnce(Date.now() + 5_000), 'succeeded')
        let [row] = await db.select().from(memories).where(eq(memories.id, memory._id))
        assert.equal(row?.embeddingModelVersion, 'contract-v2')

        await db.update(memories).set({ indexError: 'forced failure', indexStatus: 'failed' })
          .where(eq(memories.id, memory._id))
        await db.update(durableJobs).set({ status: 'dead_letter' })
          .where(and(
            eq(durableJobs.type, 'knowledge.reindex-source'),
            sql`${durableJobs.payload}->>'sourceId' = ${memory._id}`,
          ))
        assert.equal(await maintenance.recoverFailedIndexes({ modelVersion: 'contract-v2' }), 1)
        const [revived] = await db.select().from(durableJobs).where(and(
          eq(durableJobs.type, 'knowledge.reindex-source'),
          eq(durableJobs.status, 'queued'),
          sql`${durableJobs.payload}->>'sourceId' = ${memory._id}`,
        ))
        assert.ok(revived)

        await db.update(memories).set({ updatedAt: new Date('2020-01-01') }).where(eq(memories.id, memory._id))
        assert.equal(await maintenance.applyMemoryRetention({ days: 1, now: new Date('2026-07-11') }), 1)
        row = (await db.select().from(memories).where(eq(memories.id, memory._id)))[0]
        assert.ok(row?.deletedAt)
        assert.equal((await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, memory._id))).length, 0)
      } finally {
        await db.delete(users).where(eq(users.id, userId))
        await db.delete(durableJobs)
      }
    })

    await t.test('project deletion removes project memories, chunks, and embeddings', async () => {
      await db.delete(durableJobs)
      const userId = `p4d_project_${randomUUID()}`
      await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
      try {
        const projects = new PostgresProjectRepository(db)
        const project = await projects.createProject({ name: 'Private project', userId })
        const memory = await new PostgresMemoryRepository(db).create({
          content: 'Project-only retrieval marker.',
          projectId: project._id,
          source: 'manual',
          userId,
        })
        const content = 'Project-only file retrieval marker.'
        const fileId = await new PostgresFileRepository(db).createFile({
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
          kind: 'upload',
          name: 'project.txt',
          projectId: project._id,
          type: 'file',
          userId,
        })
        assert.ok(fileId)
        const runtime = createPostgresRuntime({
          db,
          embeddingProvider: embeddingsV1,
          leaseMs: 5_000,
          workerId: `project-worker-${randomUUID()}`,
        })
        assert.equal(await runtime.worker.runOnce(), 'succeeded')
        assert.equal(await runtime.worker.runOnce(), 'succeeded')
        const sourceIds = [memory._id, fileId!]
        const chunkIds = (await db.select({ id: knowledgeChunks.id }).from(knowledgeChunks)
          .where(inArray(knowledgeChunks.sourceId, sourceIds))).map(({ id }) => id)
        assert.ok(chunkIds.length >= 2)

        const result = await projects.deleteProjectTree({ projectId: project._id, userId })
        assert.deepEqual(result?.deletedMemoryIds, [memory._id])
        assert.equal((await db.select().from(knowledgeChunks).where(inArray(knowledgeChunks.sourceId, sourceIds))).length, 0)
        assert.equal((await db.select().from(knowledgeChunkEmbeddings).where(inArray(
          knowledgeChunkEmbeddings.chunkId,
          chunkIds,
        ))).length, 0)
        assert.equal((await db.select().from(files).where(eq(files.id, fileId!)))[0]?.indexStatus, 'skipped')
      } finally {
        await db.delete(users).where(eq(users.id, userId))
        await db.delete(durableJobs)
      }
    })
  } finally {
    await pool.end()
  }
})

function fakeEmbeddings(modelVersion: string): EmbeddingProvider {
  return {
    identity: {
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      modelId: 'contract-embedding',
      modelVersion,
      provider: 'openai',
    },
    embed: async (texts) => texts.map((text) => {
      const vector = Array<number>(KNOWLEDGE_EMBEDDING_DIMENSIONS).fill(0)
      for (const token of text.toLowerCase().split(/\W+/).filter(Boolean)) {
        const slot = createHash('sha256').update(token).digest().readUInt16BE(0) % KNOWLEDGE_EMBEDDING_DIMENSIONS
        vector[slot] += 1
      }
      const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
      return vector.map((value) => value / magnitude)
    }),
  }
}
