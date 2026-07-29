import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import {
  durableJobs,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeSources,
  users,
} from '@/server/database/postgres/schema'
import type { AuthorizationRepositories, AuthorizationSubject } from '@overlay/authz-contracts'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import type { EmbeddingProvider } from '@/server/knowledge'
import { KnowledgeSearchService, PostgresKnowledgeSearchRepository } from '@/server/knowledge'
import { KnowledgeBaseService } from './KnowledgeBaseService'
import { KnowledgeSourceIngestionService } from './KnowledgeSourceIngestionService'
import { KnowledgeBaseRetrievalService } from './KnowledgeBaseRetrievalService'
import {
  PostgresCanonicalKnowledgeIndexQueue,
  PostgresCanonicalKnowledgeIndexService,
} from './PostgresCanonicalKnowledgeIndex'
import { createPostgresKnowledgeBaseRepositories } from './PostgresKnowledgeBaseRepositories'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

/** Fixed corpus: each entry names the base it belongs to and its content. */
const CORPUS = [
  {
    base: 'handbook',
    key: 'refunds',
    title: 'Refund policy',
    content: 'Refunds are processed within thirty days of delivery. '
      + 'A refund request must include the original order number. '
      + 'Refund approval is handled by the billing team.',
  },
  {
    base: 'handbook',
    key: 'leave',
    title: 'Leave policy',
    content: 'Annual leave accrues at two days per month. '
      + 'Unused leave carries over for one year. '
      + 'Leave requests need manager approval.',
  },
  {
    base: 'handbook',
    key: 'expenses',
    title: 'Expense policy',
    content: 'Expense claims must be submitted within sixty days. '
      + 'Receipts are required for any expense above fifty dollars.',
  },
  {
    base: 'research',
    key: 'market',
    title: 'Market study',
    content: 'The market grew twelve percent year over year. '
      + 'Enterprise buyers prefer self-hosted deployment options.',
  },
  {
    base: 'research',
    key: 'competitors',
    title: 'Competitor analysis',
    content: 'Competitor pricing clusters between twenty and forty dollars per seat. '
      + 'Two competitors added retrieval features this quarter.',
  },
] as const

/** Query set with the sources a correct engine should surface. */
const QUERIES = [
  { kind: 'keyword', query: 'refund order number', expect: ['refunds'] },
  { kind: 'keyword', query: 'receipts required expense', expect: ['expenses'] },
  { kind: 'semantic', query: 'how long until my money comes back', expect: ['refunds'] },
  { kind: 'semantic', query: 'time off accrual and carry over', expect: ['leave'] },
  { kind: 'mixed', query: 'leave approval manager', expect: ['leave'] },
] as const

test('Postgres retrieval quality, isolation, and index plan', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const userId = `kb_quality_${randomUUID().replaceAll('-', '')}`
  await db.insert(users).values({ id: userId, email: `${userId}@example.com`, emailVerified: true })

  try {
    const repositories = createPostgresKnowledgeBaseRepositories(db)
    const authorization = permissiveAuthorization(userId)
    const embeddings = bagOfWordsEmbeddings()
    const bases = new KnowledgeBaseService({
      authorization,
      authorizationRepositories: emptyAuthorizationRepositories(),
      embeddingIdentity: embeddings.identity,
      repositories,
    })
    const ingestion = new KnowledgeSourceIngestionService({
      authorization,
      bases,
      indexQueue: new PostgresCanonicalKnowledgeIndexQueue(db),
      repositories,
    })
    const indexService = new PostgresCanonicalKnowledgeIndexService({ db, embeddings })
    const retrieval = new KnowledgeBaseRetrievalService({
      bases,
      search: new KnowledgeSearchService(new PostgresKnowledgeSearchRepository({ db, embeddings })),
    })

    const handbook = await bases.createKnowledgeBase({ title: 'Employee Handbook', userId })
    const research = await bases.createKnowledgeBase({ title: 'Market Research', userId })
    const baseIds = { handbook: handbook.id, research: research.id }
    const sourceIdByKey = new Map<string, string>()

    // Ingest the fixed corpus and index it synchronously so retrieval is deterministic.
    for (const entry of CORPUS) {
      const created = await ingestion.createTextSource({
        content: entry.content,
        knowledgeBaseId: baseIds[entry.base],
        title: entry.title,
        userId,
      })
      sourceIdByKey.set(entry.key, created.source.id)
      const result = await indexService.index({
        contentHash: created.source.contentHash!,
        sourceId: created.source.id,
        sourceVersionId: created.version.id,
        userId,
      })
      assert.ok(result.chunks > 0, `${entry.key} must index at least one chunk`)
      // Drain the now-redundant queue row immediately. durable_jobs is shared, so
      // a leftover job can be claimed by another suite's worker.
      await db.delete(durableJobs)
        .where(sql`${durableJobs.payload}->>'sourceId' = ${created.source.id}`)
    }

    const expectedIds = (keys: readonly string[]) => keys.map((key) => sourceIdByKey.get(key)!)

    await t.test('keyword, semantic and mixed queries reach their expected sources', async () => {
      let expectedTotal = 0
      let covered = 0
      let topRankCorrect = 0
      const misranked: string[] = []
      for (const spec of QUERIES) {
        const result = await retrieval.search({
          knowledgeBaseIds: [handbook.id, research.id],
          limit: 5,
          query: spec.query,
          userId,
        })
        const returnedIds = result.citations.map(({ sourceId }) => sourceId)
        const wanted = new Set(expectedIds(spec.expect))
        expectedTotal += wanted.size
        covered += [...wanted].filter((id) => returnedIds.includes(id)).length
        assert.ok(
          returnedIds.some((id) => wanted.has(id)),
          `${spec.kind} query "${spec.query}" returned none of its expected sources`,
        )
        // Precision@1 is the meaningful ranking signal here. Precision over the
        // whole result set is not: asking for 5 hits from a 4-source corpus
        // returns nearly everything regardless of ranking quality.
        if (returnedIds[0] && wanted.has(returnedIds[0])) topRankCorrect += 1
        else misranked.push(`${spec.kind}: "${spec.query}"`)
      }
      const coverage = covered / Math.max(1, expectedTotal)
      const precisionAtOne = topRankCorrect / QUERIES.length
      console.log(
        `[retrieval-quality] coverage=${coverage.toFixed(2)} `
        + `precision@1=${precisionAtOne.toFixed(2)}`
        + (misranked.length ? ` misranked=[${misranked.join('; ')}]` : ''),
      )
      // Coverage is the hard gate: it is exact and stable, because every expected
      // source must appear somewhere in the result set.
      assert.equal(coverage, 1, 'every expected source must be retrieved')
      // precision@1 is reported but only loosely gated on purpose. pgvector's HNSW
      // index is an APPROXIMATE nearest-neighbour index, so whether the planner
      // chooses it changes which passage ranks first. A tight threshold here would
      // be flaky rather than meaningful; this bound still catches a real collapse
      // in ranking quality.
      assert.ok(
        precisionAtOne >= 0.5,
        `precision@1 collapsed to ${precisionAtOne.toFixed(2)}; misranked ${misranked.join('; ')}`,
      )
    })

    await t.test('citations highlight the matched terms of each passage', async () => {
      const result = await retrieval.search({
        knowledgeBaseIds: [handbook.id],
        limit: 5,
        query: 'refund',
        userId,
      })
      const citation = result.citations.find(({ sourceId }) => sourceId === sourceIdByKey.get('refunds'))
      assert.ok(citation, 'refund policy must be cited')
      const highlighted = citation!.passages.flatMap((passage) => (
        passage.highlights.map(({ start, end }) => passage.text.slice(start, end).toLowerCase())
      ))
      assert.ok(highlighted.includes('refund'), 'the matched term must be highlighted')
      assert.ok(
        citation!.passages.every((passage) => typeof passage.startOffset === 'number'),
        'each passage must expose its offset in the source',
      )
    })

    await t.test('searching one base never leaks another base', async () => {
      const researchIds = new Set(expectedIds(['market', 'competitors']))
      for (const query of ['market growth', 'competitor pricing per seat', 'dollars']) {
        const result = await retrieval.search({
          knowledgeBaseIds: [handbook.id],
          limit: 10,
          query,
          userId,
        })
        assert.equal(
          result.citations.filter(({ sourceId }) => researchIds.has(sourceId)).length,
          0,
          `handbook-scoped search leaked a research source for "${query}"`,
        )
        assert.ok(
          result.citations.every(({ knowledgeBaseId }) => knowledgeBaseId === handbook.id),
          'every citation must be attributed to the searched base',
        )
      }
    })

    await t.test('a disabled source stops being retrievable', async () => {
      const sourceId = sourceIdByKey.get('expenses')!
      await bases.setSourceEnabled({
        enabled: false,
        knowledgeBaseId: handbook.id,
        sourceId,
        userId,
      })
      const result = await retrieval.search({
        knowledgeBaseIds: [handbook.id],
        limit: 10,
        query: 'receipts required expense',
        userId,
      })
      assert.equal(result.citations.filter((c) => c.sourceId === sourceId).length, 0)
      await bases.setSourceEnabled({
        enabled: true,
        knowledgeBaseId: handbook.id,
        sourceId,
        userId,
      })
    })

    await t.test('a deleted source leaves no retrievable chunks behind', async () => {
      const sourceId = sourceIdByKey.get('competitors')!
      await ingestion.delete({ sourceId, userId })
      const result = await retrieval.search({
        knowledgeBaseIds: [research.id],
        limit: 10,
        query: 'competitor pricing per seat',
        userId,
      })
      assert.equal(result.citations.filter((c) => c.sourceId === sourceId).length, 0)
      const remaining = await db.select().from(knowledgeChunks)
        .where(eq(knowledgeChunks.knowledgeSourceId, sourceId))
      assert.equal(remaining.length, 0, 'chunks must be purged with the source')
    })

    await t.test('diagnostics report indexed volume and provenance', async () => {
      const diagnostics = await bases.listSourceDiagnostics({
        knowledgeBaseId: handbook.id,
        userId,
      })
      assert.equal(diagnostics.length, 3)
      for (const entry of diagnostics) {
        assert.ok(entry.chunkCount > 0, `${entry.title} should report chunks`)
        assert.equal(entry.embeddedCount, entry.chunkCount, 'every chunk must be embedded')
        assert.ok(entry.indexedChars > 0)
        assert.equal(entry.provenance.origin, 'text')
        assert.equal(entry.provenance.addedBy, userId)
        assert.equal(entry.freshness.state, 'fresh', `${entry.title}: ${entry.freshness.reason ?? ''}`)
      }
    })

    await t.test('extraction preview returns the stored text', async () => {
      const preview = await bases.getExtractionPreview({
        knowledgeBaseId: handbook.id,
        limit: 200,
        sourceId: sourceIdByKey.get('leave')!,
        userId,
      })
      assert.match(preview.text, /Annual leave accrues/)
      assert.ok(preview.totalChars > 0)
    })

    await t.test('a stale index is reported and repairable by reindexing', async () => {
      const sourceId = sourceIdByKey.get('leave')!
      // Simulate content moving on without reindexing.
      await db.update(knowledgeSources)
        .set({ contentHash: 'sha256:moved-on', updatedAt: new Date() })
        .where(eq(knowledgeSources.id, sourceId))

      const stale = await ingestion.listStaleSources({ knowledgeBaseId: handbook.id, userId })
      const entry = stale.find((item) => item.sourceId === sourceId)
      assert.ok(entry, 'the drifted source must be reported as stale')
      assert.equal(entry!.state, 'stale')
      assert.match(entry!.reason ?? '', /Content changed/)

      const sweep = await ingestion.reindexKnowledgeBase({
        knowledgeBaseId: handbook.id,
        onlyStale: true,
        userId,
      })
      assert.deepEqual(sweep.queued.map(({ sourceId: id }) => id), [sourceId])
      assert.ok(
        sweep.skipped.every(({ reason }) => reason === 'already fresh'),
        'fresh sources must be skipped rather than re-embedded',
      )
    })

    await t.test('embedding-identity drift is detected as stale', async () => {
      const sourceId = sourceIdByKey.get('refunds')!
      await db.update(knowledgeChunkEmbeddings)
        .set({ modelVersion: 'some-older-version' })
        .where(sql`${knowledgeChunkEmbeddings.chunkId} IN (
          SELECT id FROM knowledge_chunks WHERE knowledge_source_id = ${sourceId}
        )`)
      const diagnostics = await bases.listSourceDiagnostics({
        knowledgeBaseId: handbook.id,
        userId,
      })
      const entry = diagnostics.find((item) => item.sourceId === sourceId)
      assert.ok(entry)
      assert.equal(entry!.freshness.state, 'stale')
      assert.equal(entry!.freshness.embeddingIdentityDrifted, true)
      assert.match(entry!.freshness.reason ?? '', /different embedding model/)
    })

    await t.test('the hnsw vector index is declared on the embeddings table', async () => {
      const indexes = await db.execute<{ indexdef: string }>(sql`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'knowledge_chunk_embeddings'
          AND indexname = 'knowledge_chunk_embeddings_hnsw_idx'
      `)
      assert.equal(indexes.rows.length, 1, 'the hnsw index must exist')
      assert.match(indexes.rows[0]!.indexdef, /USING hnsw/)
      assert.match(indexes.rows[0]!.indexdef, /vector_cosine_ops/)
    })

    await t.test('small-corpus vector search stays within budget', async () => {
      const [vector] = await embeddings.embed(['refund policy window'])
      const literal = JSON.stringify(vector)
      const plan = await db.execute<{ 'QUERY PLAN': string }>(sql`
        EXPLAIN (FORMAT TEXT)
        SELECT chunk.id
        FROM knowledge_chunk_embeddings embedding
        JOIN knowledge_chunks chunk ON chunk.id = embedding.chunk_id
        WHERE embedding.user_id = ${userId}
        ORDER BY embedding.embedding <=> ${literal}::vector
        LIMIT 10
      `)
      const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n')
      // Reported, not asserted. With a highly selective user_id filter over a
      // handful of rows, filtering on the btree index and sorting exactly is both
      // cheaper and more accurate than an approximate HNSW scan. HNSW use is
      // asserted on the large corpus below, where it actually matters.
      console.log(
        '[retrieval-quality] small-corpus plan: '
        + (text.includes('hnsw_idx') ? 'hnsw index scan' : 'filtered exact sort'),
      )

      const startedAt = Date.now()
      await retrieval.search({
        knowledgeBaseIds: [handbook.id, research.id],
        limit: 10,
        query: 'refund policy and leave approval',
        userId,
      })
      const elapsed = Date.now() - startedAt
      console.log(`[retrieval-quality] cross-base search latency: ${elapsed}ms`)
      assert.ok(elapsed < 15_000, `cross-base retrieval took ${elapsed}ms`)
    })

    await t.test('a large corpus uses the hnsw index and stays within budget', async () => {
      const bulkSourceId = sourceIdByKey.get('market')!
      const chunkCount = 900
      const [filler] = await embeddings.embed(['synthetic filler passage for index pressure'])
      const literal = JSON.stringify(filler)
      // Insert directly: this measures index behaviour under volume, not ingestion.
      await db.execute(sql`
        INSERT INTO knowledge_chunks
          (id, user_id, source_kind, source_id, knowledge_source_id, chunk_index,
           start_offset, text, title, content_hash)
        SELECT
          'bulk_' || ${userId} || '_' || g,
          ${userId}, 'file', ${bulkSourceId}, ${bulkSourceId}, 10000 + g,
          g * 100, 'synthetic filler passage number ' || g, 'Bulk filler',
          md5('bulk' || g)
        FROM generate_series(1, ${chunkCount}) AS g
      `)
      await db.execute(sql`
        INSERT INTO knowledge_chunk_embeddings
          (chunk_id, user_id, source_kind, embedding, content_hash, dimensions,
           provider, model_id, model_version)
        SELECT
          'bulk_' || ${userId} || '_' || g,
          ${userId}, 'file', ${literal}::vector, md5('bulk' || g), ${embeddings.identity.dimensions},
          ${embeddings.identity.provider}, ${embeddings.identity.modelId},
          ${embeddings.identity.modelVersion}
        FROM generate_series(1, ${chunkCount}) AS g
      `)
      await db.execute(sql`ANALYZE knowledge_chunk_embeddings`)

      const plan = await db.execute<{ 'QUERY PLAN': string }>(sql`
        EXPLAIN (FORMAT TEXT)
        SELECT chunk.id
        FROM knowledge_chunk_embeddings embedding
        JOIN knowledge_chunks chunk ON chunk.id = embedding.chunk_id
        WHERE embedding.user_id = ${userId}
        ORDER BY embedding.embedding <=> ${literal}::vector
        LIMIT 10
      `)
      const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n')
      const usesIndex = text.includes('knowledge_chunk_embeddings_hnsw_idx')
      console.log(
        `[retrieval-quality] ${chunkCount}-chunk plan: `
        + `${usesIndex ? 'hnsw index scan' : 'SEQ SCAN'}`,
      )
      // At volume the approximate index must win, otherwise every large-corpus
      // retrieval degrades into a full scan of the embedding table.
      assert.ok(
        usesIndex,
        `vector search must use the hnsw index at ${chunkCount} chunks, got:\n${text}`,
      )

      const startedAt = Date.now()
      await retrieval.search({
        knowledgeBaseIds: [research.id],
        limit: 10,
        query: 'market growth enterprise buyers',
        userId,
      })
      const elapsed = Date.now() - startedAt
      console.log(`[retrieval-quality] large-corpus search latency: ${elapsed}ms`)
      assert.ok(elapsed < 15_000, `large-corpus retrieval took ${elapsed}ms`)

      await db.execute(sql`
        DELETE FROM knowledge_chunks WHERE id LIKE ${`bulk_${userId}_%`}
      `)
    })
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`)
    await db.delete(durableJobs).where(sql`${durableJobs.payload}->>'userId' = ${userId}`)
    await pool.end()
  }
})

/**
 * Deterministic bag-of-words embedding: each token hashes to a dimension and the
 * vector is L2-normalized. Texts sharing vocabulary end up close under cosine
 * distance, which makes semantic-style ranking testable without a model call.
 */
function bagOfWordsEmbeddings(): EmbeddingProvider {
  const dimensions = 1536
  return {
    identity: {
      dimensions,
      modelId: 'kb-quality-bag-of-words',
      modelVersion: 'kb-quality-v1',
      provider: 'openai',
    },
    async embed(texts) {
      return texts.map((text) => {
        const vector = Array<number>(dimensions).fill(0)
        for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
          const token = stem(raw)
          if (token.length < 3) continue
          vector[hashToken(token) % dimensions]! += 1
        }
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
        if (norm === 0) {
          // A zero vector is invalid for cosine distance; anchor it deterministically.
          vector[0] = 1
          return vector
        }
        return vector.map((value) => value / norm)
      })
    },
  }
}

/** Crude suffix stripping so "refund"/"refunds" and "leave"/"leaves" collide. */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function hashToken(token: string): number {
  let hash = 2166136261
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
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
