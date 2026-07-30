import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { durableJobs, users } from '@/server/database/postgres/schema'
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

/**
 * Regression test for the reported `@Notes` failure.
 *
 * A user created a knowledge base called "Notes" holding five IGCSE Biology PDFs.
 * Asked to "take me through what is in @Notes", the assistant answered with
 * eleven unrelated in-app notes and four company documents that were not in the
 * base at all, while omitting most of the sources that were.
 *
 * The cause was that the knowledge boundary only guarded the passive retrieval
 * injection, while the agent's account-wide tools stayed unscoped. This test
 * reproduces the same shape of account -- an ambiguously named base plus a pile
 * of unrelated indexed material -- and pins the properties that were violated.
 */

const KB_SOURCES = [
  { key: 'syllabus', title: '697203-2026-2028-syllabus.pdf', content: 'Cambridge IGCSE Biology 0610 syllabus for 2026 to 2028. Twenty-one topics from characteristics of living organisms through biotechnology. Assessment objectives, core and extended content, experimental skills.' },
  { key: 'excretion', title: 'Excretion.pdf', content: 'Excretion removes metabolic waste. The kidney filters blood at the glomerulus, reabsorbing glucose and water in the tubule. Urea forms in the liver from excess amino acids by deamination.' },
  { key: 'nutrition', title: 'Human-Nutrition.pdf', content: 'A balanced diet supplies carbohydrates, proteins, lipids, vitamins, minerals, water and fibre. Vitamin D deficiency causes rickets. Iron deficiency causes anaemia. Scurvy follows lack of vitamin C.' },
  { key: 'respiration', title: 'Respiration.pdf', content: 'Aerobic respiration releases energy from glucose using oxygen, producing carbon dioxide and water. Anaerobic respiration in muscle produces lactic acid and yields far less energy per glucose molecule.' },
  { key: 'transport', title: 'Transport-in-Animals.pdf', content: 'The circulatory system carries blood through the heart, arteries, veins and capillaries. The left ventricle has a thicker wall to pump blood around the whole body. Valves prevent backflow.' },
] as const

/** Material the user owns that must never be attributed to the knowledge base. */
const DECOY_SOURCES = [
  { key: 'jpis', title: 'Overlay for Jayshree Periwal Group of Schools.pdf', content: 'Overlay proposal for JPIS covering the opportunity, use cases for teachers, students, parents and administrators, platform primitives, custom dashboards, and pricing compared with ChatGPT, Claude and Perplexity.' },
  { key: 'critique', title: 'here-is-an-honest-structured-critique.txt', content: 'Structured critique of the JPIS proposal. Strengths and gaps including the ask, templating, under-development caveats, INR pricing, and DPDP compliance.' },
  { key: 'overlaymd', title: 'OVERLAY.md', content: 'Technical architecture for overlay-desktop. Retrieval pipeline, memory extraction policy, and notebook architecture.' },
  { key: 'hormozi', title: '100M Money Models (Alex Hormozi).pdf', content: 'Book notes on money models, attraction offers and upsell offers.' },
  { key: 'integration', title: 'integration', content: 'Calculus integration tutorial. Indefinite and definite integrals, the fundamental theorem, the power rule, u-substitution, integration by parts, and trigonometric integrals.' },
  { key: 'mercedes', title: 'mercedes rend', content: 'Mercedes loves coffee and pizza, lives in NYC, studies biomedical engineering at Johns Hopkins, watches Criminal Minds and House MD.' },
] as const

test('a knowledge base never answers with material outside it', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const userId = `kb_leak_${randomUUID().replaceAll('-', '')}`
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

    // The reported setup: a vaguely named base, and a separate base standing in
    // for the rest of the account's indexed material.
    const notes = await bases.createKnowledgeBase({
      title: 'Notes',
      description: 'Stuff from class',
      userId,
    })
    const elsewhere = await bases.createKnowledgeBase({ title: 'Everything else', userId })

    const kbSourceIds = new Map<string, string>()
    const decoySourceIds = new Map<string, string>()
    for (const [entries, baseId, sink] of [
      [KB_SOURCES, notes.id, kbSourceIds],
      [DECOY_SOURCES, elsewhere.id, decoySourceIds],
    ] as const) {
      for (const entry of entries) {
        const created = await ingestion.createTextSource({
          content: entry.content,
          knowledgeBaseId: baseId,
          title: entry.title,
          userId,
        })
        sink.set(entry.key, created.source.id)
        await indexService.index({
          contentHash: created.source.contentHash!,
          sourceId: created.source.id,
          sourceVersionId: created.version.id,
          userId,
        })
        // Indexing is driven directly here, so the queued job is redundant. Drain
        // it immediately rather than only in `finally`: durable_jobs is shared,
        // and a job left behind can be claimed by another suite's worker, which
        // then reports success while its own source stays `indexing`.
        await db.delete(durableJobs)
          .where(sql`${durableJobs.payload}->>'sourceId' = ${created.source.id}`)
      }
    }
    const decoyIds = new Set(decoySourceIds.values())

    await t.test('the manifest lists every source and only those sources', async () => {
      const sources = await bases.listSources({ knowledgeBaseId: notes.id, userId })
      assert.deepEqual(
        sources.map(({ source }) => source.title).sort(),
        KB_SOURCES.map(({ title }) => title).sort(),
        'the manifest is what a "what is in X" answer must be built from',
      )
      assert.equal(sources.length, 5)
      assert.ok(sources.every(({ source }) => source.status === 'ready'))
    })

    await t.test('no query leaks the rest of the account into the base', async () => {
      // Includes queries deliberately worded toward the decoy material.
      for (const query of [
        'take me through what is in Notes',
        'what is in here',
        'overlay proposal for schools',
        'pricing compared with ChatGPT and Claude',
        'money models and upsell offers',
        'integration by parts',
        'who likes coffee and pizza',
        'notes',
      ]) {
        const result = await retrieval.search({
          billing: {
            idempotencyKey: 'fixture-idempotency-key',
            operationId: 'knowledge-base.search',
            requestFingerprint: 'fixture-request-fingerprint',
          },
          knowledgeBaseIds: [notes.id],
          limit: 10,
          query,
          userId,
        })
        const leaked = result.citations.filter(({ sourceId }) => decoyIds.has(sourceId))
        assert.deepEqual(
          leaked.map(({ title }) => title),
          [],
          `query "${query}" leaked material from outside the knowledge base`,
        )
        assert.ok(
          result.citations.every(({ knowledgeBaseId }) => knowledgeBaseId === notes.id),
          `query "${query}" attributed a citation to the wrong knowledge base`,
        )
      }
    })

    await t.test('a corpus-wide question covers every source rather than one', async () => {
      const result = await retrieval.search({
        billing: {
          idempotencyKey: 'fixture-idempotency-key',
          operationId: 'knowledge-base.search',
          requestFingerprint: 'fixture-request-fingerprint',
        },
        knowledgeBaseIds: [notes.id],
        limit: 10,
        query: 'can you take me through what is in Notes',
        userId,
      })
      const distinct = new Set(result.citations.map(({ sourceId }) => sourceId))
      // The original failure surfaced only two of five sources. Breadth-first
      // selection must reach every document when the question is about the corpus.
      assert.equal(
        distinct.size,
        KB_SOURCES.length,
        `expected all ${KB_SOURCES.length} sources, got ${distinct.size}`,
      )
    })

    await t.test('a narrow factual question still answers from the right source', async () => {
      const result = await retrieval.search({
        billing: {
          idempotencyKey: 'fixture-idempotency-key',
          operationId: 'knowledge-base.search',
          requestFingerprint: 'fixture-request-fingerprint',
        },
        knowledgeBaseIds: [notes.id],
        limit: 5,
        query: 'which deficiency causes rickets',
        userId,
      })
      assert.equal(
        result.citations[0]?.sourceId,
        kbSourceIds.get('nutrition'),
        'the nutrition source should rank first for a nutrition question',
      )
    })

    await t.test('an unrelated question returns nothing rather than something wrong', async () => {
      const result = await retrieval.search({
        billing: {
          idempotencyKey: 'fixture-idempotency-key',
          operationId: 'knowledge-base.search',
          requestFingerprint: 'fixture-request-fingerprint',
        },
        knowledgeBaseIds: [notes.id],
        limit: 10,
        query: 'kubernetes ingress controller TLS termination',
        userId,
      })
      // Empty is the correct answer here; the model is instructed to say the base
      // does not cover it instead of falling back to account-wide search.
      assert.equal(
        result.citations.filter(({ sourceId }) => decoyIds.has(sourceId)).length,
        0,
      )
    })
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`)
    await db.delete(durableJobs).where(sql`${durableJobs.payload}->>'userId' = ${userId}`)
    await pool.end()
  }
})

function bagOfWordsEmbeddings(): EmbeddingProvider {
  const dimensions = 1536
  return {
    identity: {
      dimensions,
      modelId: 'kb-leak-bag-of-words',
      modelVersion: 'kb-leak-v1',
      provider: 'openai',
    },
    async embed(texts) {
      return texts.map((text) => {
        const vector = Array<number>(dimensions).fill(0)
        for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
          const token = raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss')
            ? raw.slice(0, -1)
            : raw
          if (token.length < 3) continue
          vector[hashToken(token) % dimensions]! += 1
        }
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
        if (norm === 0) {
          vector[0] = 1
          return vector
        }
        return vector.map((value) => value / norm)
      })
    },
  }
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
