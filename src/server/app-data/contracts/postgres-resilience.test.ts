import 'server-only'

import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import {
  durableJobs,
  files,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  scheduledTasks,
  users,
} from '@/server/database/postgres/schema'
import { PostgresIdempotencyRepository } from '@/server/idempotency'
import {
  POSTGRES_RUNTIME_SCHEDULES,
  PostgresDurableJobRepository,
  PostgresSchedulerService,
} from '@/server/jobs'
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  PostgresKnowledgeSearchRepository,
  type EmbeddingProvider,
} from '@/server/knowledge'
import { PostgresStorageReconciliationService } from '@/server/storage/PostgresStorageReconciliationService'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
const p95LimitMs = positiveNumber(process.env.OVERLAY_P5_VECTOR_P95_LIMIT_MS, 2_000)
const requireHnswPlan = process.env.OVERLAY_P5_REQUIRE_HNSW_PLAN === 'true'
const vectorCorpusSize = positiveInteger(process.env.OVERLAY_P5_VECTOR_CORPUS_SIZE, 2_000)

test('Postgres P5 scale and resilience gates', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for P5 Postgres resilience contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 8,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `p5_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`

  try {
    await db.insert(users).values({ email: `${scope}@example.com`, id: userId })

    await t.test('pool replaces a discarded connection without restarting the process', async () => {
      const failedClient = await pool.connect()
      const failedPid = Number((await failedClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid)
      failedClient.release(new Error('P5 simulated connection failure'))
      const recovered = await pool.query<{ pid: number; value: number }>('SELECT pg_backend_pid() AS pid, 1 AS value')
      assert.equal(Number(recovered.rows[0]?.value), 1)
      assert.notEqual(Number(recovered.rows[0]?.pid), failedPid)
    })

    await t.test('concurrent app instances reserve one idempotency owner', async () => {
      const repositories = Array.from({ length: 32 }, () => new PostgresIdempotencyRepository(db))
      const args = {
        expiresAt: Date.now() + 60_000,
        keyHash: `${scope}:idempotency`,
        method: 'POST',
        path: '/api/v1/conversations/act',
        requestHash: `${scope}:request`,
        userId,
      }
      const results = await Promise.all(repositories.map((repository) => repository.reserve(args)))
      assert.equal(results.filter((result) => result.status === 'reserved').length, 1)
      assert.equal(results.filter((result) => result.status === 'in_flight').length, 31)
    })

    await t.test('competing workers drain jobs exactly once and dead-letter deterministically', async () => {
      await db.delete(durableJobs)
      const repository = new PostgresDurableJobRepository(db)
      const jobIds = await Promise.all(Array.from({ length: 48 }, (_, index) => repository.enqueue({
        dedupeKey: `${scope}:load:${index}`,
        type: `${scope}.load`,
      })))
      const completed = new Set<string>()
      const workers = Array.from({ length: 8 }, (_, index) => ({
        id: `${scope}:worker:${index}`,
        repository: new PostgresDurableJobRepository(db),
      }))
      while (completed.size < jobIds.length) {
        const claims = (await Promise.all(workers.map(async (worker) => ({
          job: await worker.repository.claim({ leaseMs: 5_000, workerId: worker.id }),
          worker,
        })))).filter((claim) => claim.job)
        assert.ok(claims.length > 0, 'workers stopped before the queue drained')
        for (const { job, worker } of claims) {
          assert.equal(completed.has(job!.id), false, `job ${job!.id} was claimed twice`)
          assert.equal(await worker.repository.complete({ jobId: job!.id, workerId: worker.id }), true)
          completed.add(job!.id)
        }
      }
      assert.equal(completed.size, jobIds.length)

      const deadLetterId = await repository.enqueue({
        dedupeKey: `${scope}:dead-letter`,
        maxAttempts: 1,
        type: `${scope}.failure`,
      })
      const failed = await repository.claim({ leaseMs: 5_000, workerId: `${scope}:failing-worker` })
      assert.equal(failed?.id, deadLetterId)
      assert.equal(await repository.fail({
        error: 'P5 deterministic failure',
        jobId: deadLetterId,
        retryDelayMs: 0,
        workerId: `${scope}:failing-worker`,
      }), 'dead_letter')
    })

    await t.test('scheduler stampede enqueues each due schedule once', async () => {
      await db.delete(durableJobs)
      await db.delete(scheduledTasks)
      const schedulers = Array.from({ length: 12 }, () => new PostgresSchedulerService(db))
      const now = Date.now()
      await schedulers[0]!.registerDefaults(now)
      const ticks = await Promise.all(schedulers.map((scheduler) => scheduler.tick({ now })))
      assert.equal(ticks.reduce((sum, tick) => sum + tick.enqueued, 0), POSTGRES_RUNTIME_SCHEDULES.length)
      const jobs = await db.select({ dedupeKey: durableJobs.dedupeKey }).from(durableJobs)
      assert.equal(jobs.length, POSTGRES_RUNTIME_SCHEDULES.length)
      assert.equal(new Set(jobs.map((job) => job.dedupeKey)).size, jobs.length)
    })

    await t.test('pgvector index and query plan are characterized within the latency budget', async () => {
      const chunkId = `${scope}_chunk`
      const sourceId = `${scope}_source`
      const vector = Array<number>(KNOWLEDGE_EMBEDDING_DIMENSIONS).fill(0)
      vector[0] = 1
      for (let offset = 0; offset < vectorCorpusSize; offset += 100) {
        const indexes = Array.from(
          { length: Math.min(100, vectorCorpusSize - offset) },
          (_, index) => offset + index,
        )
        await db.insert(knowledgeChunks).values(indexes.map((index) => ({
          chunkIndex: 0,
          contentHash: `${scope}_hash_${index}`,
          id: index === 0 ? chunkId : `${scope}_chunk_${index}`,
          sourceId: index === 0 ? sourceId : `${scope}_source_${index}`,
          sourceKind: 'memory' as const,
          startOffset: 0,
          text: index === 0
            ? 'P5 resilience marker for pgvector latency and plan characterization.'
            : `Representative pgvector corpus document ${index}.`,
          title: index === 0 ? 'P5 resilience marker' : `Corpus document ${index}`,
          userId,
        })))
        await db.insert(knowledgeChunkEmbeddings).values(indexes.map((index) => {
          const embedding = [...vector]
          if (index > 0) {
            embedding[0] = 0
            embedding[(index % 128) + 1] = 1
          }
          return {
            chunkId: index === 0 ? chunkId : `${scope}_chunk_${index}`,
            contentHash: `${scope}_hash_${index}`,
            dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
            embedding,
            modelId: 'p5-contract',
            modelVersion: 'p5-v1',
            provider: 'openai',
            sourceKind: 'memory' as const,
            userId,
          }
        }))
      }
      const planClient = await pool.connect()
      try {
        await planClient.query('ANALYZE knowledge_chunk_embeddings')
        const index = await planClient.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes
           WHERE schemaname = 'public' AND indexname = 'knowledge_chunk_embeddings_hnsw_idx'`,
        )
        assert.match(index.rows[0]?.indexdef ?? '', /USING hnsw \(embedding vector_cosine_ops\)/i)
        await planClient.query('SET enable_seqscan = off')
        const plan = await planClient.query(
          `EXPLAIN (FORMAT JSON) SELECT chunk_id FROM knowledge_chunk_embeddings
           WHERE user_id = $1 AND provider = 'openai' AND model_id = 'p5-contract'
             AND model_version = 'p5-v1'
           ORDER BY embedding <=> $2::vector LIMIT 10`,
          [userId, JSON.stringify(vector)],
        )
        const serializedPlan = JSON.stringify(plan.rows)
        const planIndexes = [...serializedPlan.matchAll(/"Index Name":"([^"]+)"/g)]
          .map((match) => match[1]!)
        assert.ok(planIndexes.length > 0, 'pgvector query plan did not use an index')
        if (requireHnswPlan) {
          assert.ok(
            planIndexes.includes('knowledge_chunk_embeddings_hnsw_idx'),
            `representative corpus did not select HNSW: ${planIndexes.join(', ')}`,
          )
        }
        console.log(JSON.stringify({
          corpusSize: vectorCorpusSize,
          event: 'p5_vector_plan',
          planIndexes,
          requireHnswPlan,
        }))
      } finally {
        planClient.release()
      }

      const embeddings: EmbeddingProvider = {
        identity: {
          dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
          modelId: 'p5-contract',
          modelVersion: 'p5-v1',
          provider: 'openai',
        },
        embed: async () => [vector],
      }
      const search = new PostgresKnowledgeSearchRepository({ db, embeddings })
      const samples: number[] = []
      for (let index = 0; index < 20; index += 1) {
        const startedAt = performance.now()
        const result = await search.hybridSearch({ query: 'resilience marker', userId })
        samples.push(performance.now() - startedAt)
        assert.equal(result.chunks[0]?.sourceId, sourceId)
      }
      const p95Ms = percentile(samples, 0.95)
      console.log(JSON.stringify({ event: 'p5_vector_latency', p95LimitMs, p95Ms, samples: samples.length }))
      assert.ok(p95Ms <= p95LimitMs, `pgvector p95 ${p95Ms.toFixed(1)}ms exceeded ${p95LimitMs}ms`)
    })

    await t.test('storage reconciliation fails without partial mutation and recovers on retry', async () => {
      const fileId = `${scope}_file`
      const objectKey = `users/${userId}/files/${fileId}/report.txt`
      const orphanKey = `users/${userId}/files/${scope}_orphan/orphan.txt`
      const old = new Date(Date.now() - 120_000)
      await db.insert(files).values({
        createdAt: old,
        id: fileId,
        indexStatus: 'skipped',
        indexable: false,
        kind: 'upload',
        name: 'report.txt',
        r2Key: objectKey,
        type: 'file',
        updatedAt: old,
        userId,
      })
      const failing = new PostgresStorageReconciliationService(db, {
        listObjects: async () => { throw new Error('simulated S3 outage') },
      })
      await assert.rejects(failing.run(), /simulated S3 outage/)
      const [unchanged] = await db.select().from(files).where(eq(files.id, fileId)).limit(1)
      assert.equal(unchanged?.indexStatus, 'skipped')

      const recovered = await new PostgresStorageReconciliationService(db, {
        listObjects: async () => [
          { key: objectKey, lastModified: old.toISOString(), sizeBytes: 10 },
          { key: orphanKey, lastModified: old.toISOString(), sizeBytes: 10 },
        ],
      }).run({ missingGraceMs: 60_000, now: Date.now(), orphanGraceMs: 60_000 })
      assert.equal(recovered.missingObjects, 0)
      assert.equal(recovered.orphanObjects, 1)
      assert.equal(recovered.orphanCleanupJobs, 1)
    })
  } finally {
    await db.delete(users).where(eq(users.id, userId))
    await db.delete(durableJobs)
    await db.delete(scheduledTasks)
    await pool.end()
  }
})

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  return Math.max(1, Math.floor(positiveNumber(raw, fallback)))
}
