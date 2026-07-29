import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import {
  durableJobs,
  conversations,
  knowledgeChunks,
  knowledgeSources,
  knowledgeSourceVersions,
  users,
} from '@/server/database/postgres/schema'
import { PostgresDurableJobRepository } from '@/server/jobs/PostgresDurableJobRepository'
import { PostgresJobWorker } from '@/server/jobs/PostgresJobWorker'
import type { AuthorizationRepositories, AuthorizationSubject } from '@overlay/authz-contracts'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import type { EmbeddingProvider } from '@/server/knowledge'
import { KnowledgeSearchService, PostgresKnowledgeSearchRepository } from '@/server/knowledge'
import { KnowledgeBaseService } from './KnowledgeBaseService'
import { KnowledgeSourceIngestionService } from './KnowledgeSourceIngestionService'
import { KnowledgeBaseRetrievalService } from './KnowledgeBaseRetrievalService'
import {
  CANONICAL_KNOWLEDGE_INDEX_JOB,
  PostgresCanonicalKnowledgeIndexQueue,
  PostgresCanonicalKnowledgeIndexService,
} from './PostgresCanonicalKnowledgeIndex'
import { createPostgresKnowledgeBaseRepositories } from './PostgresKnowledgeBaseRepositories'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres canonical knowledge source lifecycle', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const userId = `kb_ingestion_${randomUUID()}`
  await db.insert(users).values({ id: userId, email: `${userId}@example.com`, emailVerified: true })
  try {
    const repositories = createPostgresKnowledgeBaseRepositories(db)
    const authorization = permissiveAuthorization(userId)
    const bases = new KnowledgeBaseService({
      authorization,
      authorizationRepositories: emptyAuthorizationRepositories(),
      repositories,
    })
    const indexQueue = new PostgresCanonicalKnowledgeIndexQueue(db)
    const ingestion = new KnowledgeSourceIngestionService({
      authorization,
      bases,
      indexQueue,
      repositories,
    })
    const base = await bases.createKnowledgeBase({ title: 'Organic Chemistry', userId })
    const conversationId = `kb_conversation_${randomUUID()}`
    await db.insert(conversations).values({
      id: conversationId,
      userId,
      title: 'Grounded chemistry chat',
      lastMode: 'act',
      actModelId: 'openrouter/free',
    })
    await bases.attachConversation({ conversationId, knowledgeBaseId: base.id, userId })
    assert.equal((await bases.getConversationKnowledgeBase({ conversationId, userId }))?.id, base.id)
    const created = await ingestion.createTextSource({
      content: 'A nucleophile donates an electron pair to form a new covalent bond.',
      knowledgeBaseId: base.id,
      title: 'Nucleophilic substitution',
      userId,
    })
    assert.equal(created.source.status, 'indexing')
    assert.equal(created.version.version, 1)
    assert.equal((await db.select().from(durableJobs).where(eq(durableJobs.id, created.jobId)))[0]?.status, 'queued')
    assert.equal(await indexQueue.enqueue({
      contentHash: created.source.contentHash!,
      sourceId: created.source.id,
      sourceVersionId: created.version.id,
      userId,
    }), created.jobId)

    const indexer = new PostgresCanonicalKnowledgeIndexService({ db, embeddings: fakeEmbeddings() })
    const jobs = new PostgresDurableJobRepository(db)
    const crashAt = Date.now() + 1_000
    const abandoned = await jobs.claim({
      leaseMs: 1_000,
      now: crashAt,
      supportedTypes: [CANONICAL_KNOWLEDGE_INDEX_JOB],
      workerId: 'crashed-kb-worker',
    })
    assert.equal(abandoned?.id, created.jobId)
    const worker = new PostgresJobWorker({
      handlers: {
        [CANONICAL_KNOWLEDGE_INDEX_JOB]: async (job) => await indexer.index({
          contentHash: String(job.payload.contentHash),
          sourceId: String(job.payload.sourceId),
          sourceVersionId: String(job.payload.sourceVersionId),
          userId: String(job.payload.userId),
        }),
      },
      leaseMs: 5_000,
      repository: jobs,
      workerId: `kb-worker-${randomUUID()}`,
    })
    assert.equal(await worker.runOnce(crashAt + 1_001), 'succeeded')
    const [recoveredJob] = await db.select().from(durableJobs)
      .where(eq(durableJobs.id, created.jobId))
    assert.equal(recoveredJob?.attempts, 2)
    assert.equal(recoveredJob?.status, 'succeeded')
    assert.equal((await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, created.source.id)))[0]?.status, 'ready')
    let chunks = await db.select().from(knowledgeChunks)
      .where(eq(knowledgeChunks.knowledgeSourceId, created.source.id))
    assert.ok(chunks.some((chunk) => chunk.text.includes('nucleophile')))
    assert.ok(chunks.every((chunk) => chunk.knowledgeSourceVersionId === created.version.id))

    const replaced = await ingestion.replaceTextSource({
      content: 'Electrophiles accept an electron pair during a reaction mechanism.',
      sourceId: created.source.id,
      userId,
    })
    assert.equal(replaced.unchanged, false)
    assert.equal(replaced.version.version, 2)
    assert.equal(await worker.runOnce(Date.now() + 1_000), 'succeeded')
    chunks = await db.select().from(knowledgeChunks)
      .where(eq(knowledgeChunks.knowledgeSourceId, created.source.id))
    assert.ok(chunks.some((chunk) => chunk.text.includes('Electrophiles')))
    assert.equal(chunks.some((chunk) => chunk.text.includes('nucleophile')), false)
    assert.ok(chunks.every((chunk) => chunk.knowledgeSourceVersionId === replaced.version.id))

    const unchanged = await ingestion.replaceTextSource({
      content: 'Electrophiles accept an electron pair during a reaction mechanism.',
      sourceId: created.source.id,
      userId,
    })
    assert.equal(unchanged.unchanged, true)
    assert.equal((await repositories.sources.listVersions(created.source.id)).length, 2)

    const otherBase = await bases.createKnowledgeBase({ title: 'Private Biology', userId })
    const other = await ingestion.createTextSource({
      content: 'Isolation marker: mitochondrial inheritance is maternal.',
      knowledgeBaseId: otherBase.id,
      title: 'Biology marker',
      userId,
    })
    assert.equal(await worker.runOnce(Date.now() + 1_000), 'succeeded')
    const retrieval = new KnowledgeBaseRetrievalService({
      bases,
      search: new KnowledgeSearchService(new PostgresKnowledgeSearchRepository({
        db,
        embeddings: fakeEmbeddings(),
      })),
    })
    const chemistrySearch = await retrieval.search({
      knowledgeBaseIds: [base.id],
      query: 'electron pair mechanism',
      userId,
    })
    assert.ok(chemistrySearch.chunks.some((chunk) => chunk.text.includes('Electrophiles')))
    assert.equal(chemistrySearch.chunks.some((chunk) => chunk.text.includes('mitochondrial')), false)
    assert.deepEqual(chemistrySearch.citations.map(({ sourceId }) => sourceId), [created.source.id])
    const biologySearch = await retrieval.search({
      knowledgeBaseIds: [otherBase.id],
      query: 'maternal mitochondrial inheritance',
      userId,
    })
    assert.ok(biologySearch.chunks.every((chunk) => chunk.knowledgeSourceId === other.source.id))

    await db.update(knowledgeSources).set({ status: 'failed', statusMessage: 'forced failure' })
      .where(eq(knowledgeSources.id, created.source.id))
    await db.update(knowledgeSourceVersions).set({ status: 'failed' })
      .where(eq(knowledgeSourceVersions.id, replaced.version.id))
    const retryJobId = await ingestion.retry({ sourceId: created.source.id, userId })
    assert.ok(retryJobId)
    assert.equal((await repositories.sources.get(created.source.id))?.status, 'indexing')

    await ingestion.delete({ sourceId: created.source.id, userId })
    assert.equal(await repositories.sources.get(created.source.id), null)
    assert.equal((await db.select().from(knowledgeChunks)
      .where(eq(knowledgeChunks.knowledgeSourceId, created.source.id))).length, 0)
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`)
    await db.delete(durableJobs).where(sql`${durableJobs.payload}->>'userId' = ${userId}`)
    await pool.end()
  }
})

function fakeEmbeddings(): EmbeddingProvider {
  return {
    identity: {
      dimensions: 1536,
      modelId: 'kb-contract-embedding',
      modelVersion: 'kb-contract-v1',
      provider: 'openai',
    },
    async embed(texts) {
      return texts.map((text) => {
        const vector = Array<number>(1536).fill(0)
        vector[Math.abs([...text].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % vector.length] = 1
        return vector
      })
    },
  }
}

function permissiveAuthorization(userId: string): AuthorizationService {
  const subject: AuthorizationSubject = {
    userId,
    isDeploymentOwner: false,
    capabilities: [
      'knowledge.create', 'knowledge.read', 'knowledge.edit', 'knowledge.delete',
      'conversations.read', 'conversations.edit',
    ],
    groupIds: [],
    roleIds: [],
  }
  return {
    assertCapability: async () => subject,
    assertResourceAccess: async () => subject,
    checkResolvedResourceAccess: async () => ({ allowed: true, reason: 'owner' }),
    getResourceOwner: async () => userId,
    listAccessibleResourceIds: async () => [],
    resolveSubject: async () => subject,
  } as unknown as AuthorizationService
}

function emptyAuthorizationRepositories(): AuthorizationRepositories {
  return {
    resourceGrants: {
      listForResource: async () => [],
      remove: async () => false,
    },
  } as unknown as AuthorizationRepositories
}
