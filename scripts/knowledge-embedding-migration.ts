/**
 * Reports and optionally repairs embedding-identity drift in the Postgres
 * knowledge index.
 *
 * Vectors produced by different providers/models/versions are not comparable, so
 * a mixed index silently degrades retrieval. This script finds chunks embedded
 * under an identity other than the currently configured one and re-enqueues
 * their sources for re-embedding.
 *
 * Depends only on the database connection and the embeddings configuration, so
 * an operator can run it without the full application config.
 *
 *   OVERLAY_DATABASE_URL=... tsx scripts/knowledge-embedding-migration.ts [--apply]
 */
import { randomUUID, createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from '../src/server/knowledge/EmbeddingProvider'

/**
 * Mirrors createEmbeddingProvider's identity selection using only environment
 * variables, so an operator can run this against a database without supplying
 * auth, billing, or vector-search application config.
 */
function resolveConfiguredIdentity(): {
  dimensions: number
  modelId: string
  modelVersion: string
  provider: string
} {
  const provider = process.env.OVERLAY_PROVIDER_EMBEDDINGS?.trim() || 'ai-gateway'
  const modelVersion = process.env.OVERLAY_EMBEDDING_MODEL_VERSION?.trim()
    || 'text-embedding-3-small-v1'
  if (provider !== 'ai-gateway' && provider !== 'openai') {
    throw new Error(`Unsupported embeddings provider for the knowledge index: ${provider}`)
  }
  return {
    dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    modelId: provider === 'ai-gateway' ? 'openai/text-embedding-3-small' : 'text-embedding-3-small',
    modelVersion,
    provider,
  }
}

type DriftRow = {
  sourceId: string
  ownerUserId: string
  provider: string
  modelId: string
  modelVersion: string
  chunkCount: string
}

async function main() {
  const apply = process.argv.includes('--apply')
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('OVERLAY_DATABASE_URL is required to inspect the knowledge index')
  }
  const identity = resolveConfiguredIdentity()
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  try {
    const drift = await db.execute<DriftRow>(sql`
      SELECT
        chunk.knowledge_source_id AS "sourceId",
        chunk.user_id AS "ownerUserId",
        embedding.provider AS "provider",
        embedding.model_id AS "modelId",
        embedding.model_version AS "modelVersion",
        count(*)::text AS "chunkCount"
      FROM knowledge_chunk_embeddings embedding
      JOIN knowledge_chunks chunk ON chunk.id = embedding.chunk_id
      WHERE chunk.knowledge_source_id IS NOT NULL
        AND (
          embedding.provider <> ${identity.provider}
          OR embedding.model_id <> ${identity.modelId}
          OR embedding.model_version <> ${identity.modelVersion}
        )
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1
    `)

    const affected = [...new Map(drift.rows.map((row) => [row.sourceId, row])).values()]
    if (!apply) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'report',
        currentIdentity: identity,
        driftedSources: affected.length,
        driftedChunks: drift.rows.reduce((total, row) => total + Number(row.chunkCount), 0),
        detail: affected.map((row) => ({
          sourceId: row.sourceId,
          indexedWith: `${row.provider}|${row.modelId}|${row.modelVersion}`,
        })),
        hint: 'Re-run with --apply to enqueue re-embedding for these sources.',
      }, null, 2))
      return
    }

    let queued = 0
    const failed: Array<{ sourceId: string; reason: string }> = []
    for (const row of affected) {
      const [version] = (await db.execute<{ id: string; contentHash: string }>(sql`
        SELECT id, content_hash AS "contentHash"
        FROM knowledge_source_versions
        WHERE source_id = ${row.sourceId}
        ORDER BY version DESC
        LIMIT 1
      `)).rows
      if (!version) {
        failed.push({ sourceId: row.sourceId, reason: 'no version to re-index' })
        continue
      }
      const dedupeKey = createHash('sha256')
        .update(`canonical:${row.sourceId}:${version.contentHash}:${version.id}`)
        .digest('hex')
      await db.execute(sql`
        INSERT INTO durable_jobs (id, type, dedupe_key, payload, priority, max_attempts)
        VALUES (
          ${randomUUID()},
          ${'knowledge.index-canonical-source'},
          ${dedupeKey},
          ${JSON.stringify({
            contentHash: version.contentHash,
            sourceId: row.sourceId,
            sourceVersionId: version.id,
            userId: row.ownerUserId,
            authorization: { userId: row.ownerUserId, capabilities: ['knowledge.edit'] },
          })}::jsonb,
          20,
          5
        )
        ON CONFLICT (dedupe_key) DO NOTHING
      `)
      await db.execute(sql`
        UPDATE knowledge_sources SET status = 'indexing', status_message = NULL, updated_at = now()
        WHERE id = ${row.sourceId}
      `)
      queued += 1
    }
    console.log(JSON.stringify({
      ok: true,
      mode: 'apply',
      currentIdentity: identity,
      queued,
      failed,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
