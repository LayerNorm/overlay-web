import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { durableJobs, users } from '@/server/database/postgres/schema'
import { PostgresFileRepository } from '@/server/files/PostgresFileRepository'
import { createPostgresRuntime } from '@/server/jobs/postgres-runtime'
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  PostgresKnowledgeSearchRepository,
  type EmbeddingProvider,
} from '@/server/knowledge'
import { PostgresMemoryRepository } from '@/server/memory'
import { PostgresProjectRepository } from '@/server/projects/PostgresProjectRepository'
import { PostgresUserRepository } from '@/server/users/PostgresUserRepository'
import { runKnowledgeCharacterizationContract } from './knowledge-characterization-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres pgvector knowledge characterization', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const embeddings = characterizationEmbeddings()
  const runtime = createPostgresRuntime({
    db,
    embeddingProvider: embeddings,
    leaseMs: 1_000,
    workerId: `p4e-${randomUUID()}`,
  })

  try {
    await db.delete(durableJobs)
    await runKnowledgeCharacterizationContract(t, {
      awaitIndexed: async () => {
        for (let count = 0; count < 20; count += 1) {
          if (await runtime.worker.runOnce() === 'idle') return
        }
        throw new Error('Postgres characterization indexing did not drain')
      },
      cleanupUser: async (userId) => {
        await db.delete(users).where(eq(users.id, userId))
      },
      files: new PostgresFileRepository(db),
      memories: new PostgresMemoryRepository(db),
      name: 'postgres-pgvector',
      projects: new PostgresProjectRepository(db),
      search: new PostgresKnowledgeSearchRepository({ db, embeddings }),
      users: new PostgresUserRepository(db),
    })
  } finally {
    await db.delete(durableJobs)
    await pool.end()
  }
})

function characterizationEmbeddings(): EmbeddingProvider {
  return {
    identity: {
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      modelId: 'characterization-hash-embedding',
      modelVersion: 'p4e-v1',
      provider: 'openai',
    },
    embed: async (texts) => texts.map((text) => {
      const vector = Array<number>(KNOWLEDGE_EMBEDDING_DIMENSIONS).fill(0)
      for (const token of text.toLowerCase().split(/\W+/).filter(Boolean)) {
        const slot = createHash('sha256').update(token).digest().readUInt16BE(0) % vector.length
        vector[slot] += 1
      }
      const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
      return vector.map((value) => value / magnitude)
    }),
  }
}
