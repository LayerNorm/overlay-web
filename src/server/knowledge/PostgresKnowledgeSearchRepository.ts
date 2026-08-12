import 'server-only'

import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type { HybridSearchChunk, HybridSearchResult } from '@/shared/knowledge/hybrid-search'
import type { EmbeddingProvider } from './EmbeddingProvider'
import type { KnowledgeSearchArgs, KnowledgeSearchRepository } from './KnowledgeSearchRepository'
import { calculateEmbeddingModelCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { ServerProviderUsageMeter } from '@/server/billing/ServerProviderUsageMeter'

const RRF_K = 60
const PROJECT_CHUNK_BOOST = 1.85
const PACK_MAX_TOTAL_CHARS = 12_000
const PACK_MAX_PER_SOURCE = 3

type SearchRow = {
  chunk_index: number
  id: string
  project_id: string | null
  source_id: string
  source_kind: 'file' | 'memory'
  text: string
  title: string | null
}

export class PostgresKnowledgeSearchRepository implements KnowledgeSearchRepository {
  constructor(private readonly deps: {
    db: OverlayPostgresDb
    embeddings: EmbeddingProvider
    usageMeter?: ServerProviderUsageMeter
  }) {}

  async hybridSearch(args: KnowledgeSearchArgs): Promise<HybridSearchResult> {
    const query = args.query.trim()
    if (!query) return { chunks: [] }
    const kVec = normalizeLimit(args.kVec, 48, 256)
    const kLex = normalizeLimit(args.kLex, 48, 1024)
    const maxChunks = normalizeLimit(args.m, 12, 50)
    const estimatedInputTokens = Math.ceil(query.length / 4)
    const pricingModelId = this.deps.embeddings.identity.modelId.includes('/')
      ? this.deps.embeddings.identity.modelId
      : `openai/${this.deps.embeddings.identity.modelId}`
    const providerCostUsd = await calculateEmbeddingModelCostOrNull(pricingModelId, estimatedInputTokens)
    if (providerCostUsd === null) throw new Error(`pricing_missing:${pricingModelId}`)
    const embed = () => this.deps.embeddings.embed([query])
    const [queryVector] = this.deps.usageMeter
      ? await this.deps.usageMeter.run({
          execute: embed,
          idempotencyKey: args.billing.idempotencyKey,
          kind: 'embedding',
          modelId: pricingModelId,
          operationId: args.billing.operationId,
          programmaticSubjectId: args.billing.programmaticSubjectId,
          providerCostUsd,
          requestFingerprint: args.billing.requestFingerprint,
          usageEvent: { inputTokens: estimatedInputTokens },
          userId: args.billing.actorUserId,
          workspaceId: args.workspaceId,
        })
      : await embed()
    if (!queryVector) throw new Error('Embedding provider returned no query vector')

    const sourceFilter = args.sourceKind
      ? sql`AND chunk.source_kind = ${args.sourceKind}`
      : sql``
    const projectFilter = args.projectId
      ? sql`AND (chunk.project_id IS NULL OR chunk.project_id = ${args.projectId})`
      : sql``
    const workspaceFilter = args.workspaceId
      ? sql`AND chunk.workspace_id = ${args.workspaceId}`
      : sql``
    const vectorLiteral = JSON.stringify(queryVector)
    const vectorRows = await this.deps.db.execute<SearchRow & { similarity: number }>(sql`
      SELECT
        chunk.id,
        chunk.project_id,
        chunk.source_kind,
        chunk.source_id,
        chunk.chunk_index,
        chunk.text,
        chunk.title,
        1 - (embedding.embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM knowledge_chunk_embeddings embedding
      JOIN knowledge_chunks chunk ON chunk.id = embedding.chunk_id
      WHERE embedding.user_id = ${args.userId}
        AND embedding.provider = ${this.deps.embeddings.identity.provider}
        AND embedding.model_id = ${this.deps.embeddings.identity.modelId}
        AND embedding.model_version = ${this.deps.embeddings.identity.modelVersion}
        ${sourceFilter}
        ${projectFilter}
        ${workspaceFilter}
        ${args.minVecScore !== undefined
          ? sql`AND 1 - (embedding.embedding <=> ${vectorLiteral}::vector) >= ${args.minVecScore}`
          : sql``}
      ORDER BY embedding.embedding <=> ${vectorLiteral}::vector
      LIMIT ${kVec}
    `)
    const lexicalRows = await this.deps.db.execute<SearchRow & { lexical_score: number }>(sql`
      SELECT
        chunk.id,
        chunk.project_id,
        chunk.source_kind,
        chunk.source_id,
        chunk.chunk_index,
        chunk.text,
        chunk.title,
        ts_rank_cd(
          to_tsvector('simple', coalesce(chunk.title, '') || ' ' || chunk.text),
          websearch_to_tsquery('simple', ${query})
        ) AS lexical_score
      FROM knowledge_chunks chunk
      WHERE chunk.user_id = ${args.userId}
        ${sourceFilter}
        ${projectFilter}
        ${workspaceFilter}
        AND to_tsvector('simple', coalesce(chunk.title, '') || ' ' || chunk.text)
          @@ websearch_to_tsquery('simple', ${query})
      ORDER BY lexical_score DESC, chunk.id
      LIMIT ${kLex}
    `)

    const rows = new Map<string, SearchRow>()
    const scores = new Map<string, number>()
    addRankedRows(vectorRows.rows, rows, scores)
    addRankedRows(lexicalRows.rows, rows, scores)
    if (args.projectId) {
      for (const [id, row] of rows) {
        if (row.project_id === args.projectId) scores.set(id, (scores.get(id) ?? 0) * PROJECT_CHUNK_BOOST)
      }
    }
    const ordered = [...rows.values()].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
    return { chunks: packChunks(ordered, scores, maxChunks) }
  }
}

function addRankedRows(
  ranked: SearchRow[],
  rows: Map<string, SearchRow>,
  scores: Map<string, number>,
): void {
  for (let index = 0; index < ranked.length; index += 1) {
    const row = ranked[index]!
    rows.set(row.id, row)
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + index + 1))
  }
}

function packChunks(rows: SearchRow[], scores: Map<string, number>, maxChunks: number): HybridSearchChunk[] {
  const perSource = new Map<string, number>()
  const result: HybridSearchChunk[] = []
  let totalChars = 0
  for (const row of rows) {
    if (result.length >= maxChunks) break
    const sourceKey = `${row.source_kind}:${row.source_id}`
    if ((perSource.get(sourceKey) ?? 0) >= PACK_MAX_PER_SOURCE) continue
    if (totalChars + row.text.length > PACK_MAX_TOTAL_CHARS && result.length > 0) break
    perSource.set(sourceKey, (perSource.get(sourceKey) ?? 0) + 1)
    totalChars += row.text.length
    result.push({
      chunkIndex: Number(row.chunk_index),
      score: scores.get(row.id) ?? 0,
      sourceId: row.source_id,
      sourceKind: row.source_kind,
      text: row.text,
      title: row.title ?? undefined,
    })
  }
  return result
}

function normalizeLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(1, Math.floor(value!)))
}
