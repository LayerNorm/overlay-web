import { v } from 'convex/values'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server'
import { internal, api } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { calculateGatewayEmbeddingModelCostOrNull } from '../lib/gatewayCatalogPricing'
import { applyMarkupToDollars } from '../../src/shared/billing/billing-pricing'
import {
  KNOWLEDGE_CHUNK_CHARS,
  KNOWLEDGE_CHUNK_OVERLAP,
  chunkKnowledgeText,
} from '../../src/shared/knowledge/chunking'

export type HybridSearchChunk = {
  text: string
  title?: string
  sourceKind: 'file' | 'memory'
  sourceId: string
  chunkIndex: number
  score: number
}

/** Larger chunks reduce embedding/storage row counts while preserving retrieval context. */
export const CHUNK_CHARS = KNOWLEDGE_CHUNK_CHARS
export const CHUNK_OVERLAP = KNOWLEDGE_CHUNK_OVERLAP
const RRF_K = 60
const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const EMBEDDING_DIM = 1536
const GATEWAY_EMBED_URL =
  process.env.AI_GATEWAY_EMBED_URL?.trim() || 'https://ai-gateway.vercel.sh/v1/embeddings'

function estimateEmbeddingTokens(texts: string[]): number {
  return Math.max(1, Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4))
}

function getServerSecretForBackground(): string | null {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  return secret ? secret : null
}

export function chunkText(full: string): Array<{ text: string; chunkIndex: number; startOffset: number }> {
  return chunkKnowledgeText(full)
}

function truncateSearchQuery(q: string, maxTerms = 16): string {
  const terms = q.trim().split(/\s+/).filter(Boolean)
  return terms.slice(0, maxTerms).join(' ')
}

export async function embedViaGateway(texts: string[]): Promise<{ vectors: number[][]; promptTokens: number }> {
  const key = process.env.AI_GATEWAY_API_KEY
  if (!key) {
    throw new Error('Missing AI_GATEWAY_API_KEY in Convex environment')
  }
  const res = await fetch(GATEWAY_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts.length === 1 ? texts[0]! : texts,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Embeddings HTTP ${res.status}: ${t.slice(0, 500)}`)
  }
  const data = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>
    usage?: { prompt_tokens?: number; total_tokens?: number }
  }
  const sorted = [...data.data].sort((a, b) => a.index - b.index)
  const vectors = sorted.map((d) => {
    const e = d.embedding
    if (e.length !== EMBEDDING_DIM) {
      throw new Error(`Expected ${EMBEDDING_DIM} dims, got ${e.length}`)
    }
    return e
  })
  const promptTokens = data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0
  return { vectors, promptTokens }
}

// ─── Internal: purge + replace indexed content ───────────────────────────────

export const purgeKnowledgeSource = internalMutation({
  args: {
    sourceKind: v.union(v.literal('file'), v.literal('memory')),
    sourceId: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { sourceKind, sourceId, userId }) => {
    const existing = await ctx.db
      .query('knowledgeChunks')
      .withIndex('by_source', (q) => q.eq('sourceKind', sourceKind).eq('sourceId', sourceId))
      .collect()
    for (const c of existing) {
      if (userId && c.userId !== userId) continue
      const emb = await ctx.db
        .query('knowledgeChunkEmbeddings')
        .withIndex('by_chunkId', (q) => q.eq('chunkId', c._id))
        .first()
      if (emb) await ctx.db.delete(emb._id)
      await ctx.db.delete(c._id)
    }
  },
})

export const replaceKnowledgeSource = internalMutation({
  args: {
    userId: v.string(),
    projectId: v.optional(v.string()),
    sourceKind: v.union(v.literal('file'), v.literal('memory')),
    sourceId: v.string(),
    title: v.optional(v.string()),
    segments: v.array(
      v.object({
        text: v.string(),
        chunkIndex: v.number(),
        startOffset: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('knowledgeChunks')
      .withIndex('by_source', (q) => q.eq('sourceKind', args.sourceKind).eq('sourceId', args.sourceId))
      .collect()
    for (const c of existing) {
      const emb = await ctx.db
        .query('knowledgeChunkEmbeddings')
        .withIndex('by_chunkId', (q) => q.eq('chunkId', c._id))
        .first()
      if (emb) await ctx.db.delete(emb._id)
      await ctx.db.delete(c._id)
    }
    for (const seg of args.segments) {
      const chunkId = await ctx.db.insert('knowledgeChunks', {
        userId: args.userId,
        projectId: args.projectId,
        sourceKind: args.sourceKind,
        sourceId: args.sourceId,
        chunkIndex: seg.chunkIndex,
        startOffset: seg.startOffset,
        text: seg.text,
        title: args.title,
      })
      await ctx.db.insert('knowledgeChunkEmbeddings', {
        chunkId,
        userId: args.userId,
        sourceKind: args.sourceKind,
        embedding: seg.embedding,
      })
    }
  },
})

// ─── Internal queries for hybrid search ──────────────────────────────────────

export const getFileForReindex = internalQuery({
  args: { fileId: v.id('files') },
  handler: async (ctx, { fileId }) => {
    const f = await ctx.db.get(fileId)
    if (!f || f.deletedAt || f.type !== 'file') return null
    const binaryOnly =
      (f.storageId || f.r2Key) && !((f.textContent ?? f.content ?? '').trim().length > 0)
    if (binaryOnly) return { kind: 'skip' as const, reason: 'binary' as const }
    if (f.duplicateOfFileId) return { kind: 'skip' as const, reason: 'duplicate' as const }
    if (f.indexable === false) return { kind: 'skip' as const, reason: 'not_indexable' as const }
    const content = f.textContent ?? f.content ?? ''
    return {
      kind: 'ok' as const,
      userId: f.userId,
      projectId: f.projectId,
      name: f.name,
      content,
    }
  },
})

export const getMemoryForReindex = internalQuery({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, { memoryId }) => {
    const m = await ctx.db.get(memoryId)
    if (!m || m.deletedAt) return null
    return { userId: m.userId, projectId: m.projectId, content: m.content }
  },
})

export const searchChunksLexical = internalQuery({
  args: {
    userId: v.string(),
    sourceKind: v.optional(v.union(v.literal('file'), v.literal('memory'))),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, { userId, sourceKind, query, limit }) => {
    const qStr = truncateSearchQuery(query)
    if (!qStr) return []
    return await ctx.db
      .query('knowledgeChunks')
      .withSearchIndex('search_text', (q) => {
        const chain = q.search('text', qStr).eq('userId', userId)
        if (sourceKind !== undefined) {
          return chain.eq('sourceKind', sourceKind)
        }
        return chain
      })
      .take(limit)
  },
})

export const embeddingChunkIdsForVectorResults = internalQuery({
  args: {
    embeddingIds: v.array(v.id('knowledgeChunkEmbeddings')),
    sourceKind: v.optional(v.union(v.literal('file'), v.literal('memory'))),
  },
  handler: async (ctx, { embeddingIds, sourceKind }) => {
    const ordered: Array<{ chunkId: Id<'knowledgeChunks'> | null }> = []
    for (const id of embeddingIds) {
      const row = await ctx.db.get(id)
      if (!row) {
        ordered.push({ chunkId: null })
        continue
      }
      if (sourceKind !== undefined && row.sourceKind !== sourceKind) {
        ordered.push({ chunkId: null })
        continue
      }
      ordered.push({ chunkId: row.chunkId })
    }
    return ordered
  },
})

export const fetchChunkPayloads = internalQuery({
  args: { ids: v.array(v.id('knowledgeChunks')) },
  handler: async (ctx, { ids }) => {
    const out = []
    for (const id of ids) {
      const row = await ctx.db.get(id)
      if (row) out.push(row)
    }
    return out
  },
})

// ─── Reindex (scheduled / internal) ─────────────────────────────────────────

export const getCanonicalSourceForReindex = internalQuery({
  args: {
    contentHash: v.string(),
    sourceId: v.string(),
    sourceVersionId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.query('knowledgeSources')
      .withIndex('by_sourceId', (q) => q.eq('sourceId', args.sourceId)).unique()
    const version = await ctx.db.query('knowledgeSourceVersions')
      .withIndex('by_sourceVersionId', (q) => q.eq('sourceVersionId', args.sourceVersionId)).unique()
    if (!source || source.deletedAt || source.ownerUserId !== args.userId || !version) return null
    if (source.contentHash !== args.contentHash || version.contentHash !== args.contentHash) {
      return { kind: 'stale' as const }
    }
    const versionMetadata = version.metadata as Record<string, unknown>
    const sourceMetadata = source.metadata as Record<string, unknown>
    const content = typeof versionMetadata.content === 'string'
      ? versionMetadata.content
      : typeof sourceMetadata.content === 'string' ? sourceMetadata.content : ''
    return {
      kind: 'ready' as const,
      content,
      source,
      version,
    }
  },
})

export const replaceCanonicalSource = internalMutation({
  args: {
    sourceId: v.string(),
    sourceVersionId: v.string(),
    userId: v.string(),
    segments: v.array(v.object({
      chunkIndex: v.number(),
      embedding: v.array(v.float64()),
      startOffset: v.number(),
      text: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.query('knowledgeSources')
      .withIndex('by_sourceId', (q) => q.eq('sourceId', args.sourceId)).unique()
    const version = await ctx.db.query('knowledgeSourceVersions')
      .withIndex('by_sourceVersionId', (q) => q.eq('sourceVersionId', args.sourceVersionId)).unique()
    if (!source || source.deletedAt || source.ownerUserId !== args.userId || !version) return { replaced: false }
    const existing = await ctx.db.query('knowledgeChunks')
      .withIndex('by_knowledgeSourceId', (q) => q.eq('knowledgeSourceId', args.sourceId)).collect()
    for (const chunk of existing) {
      const embedding = await ctx.db.query('knowledgeChunkEmbeddings')
        .withIndex('by_chunkId', (q) => q.eq('chunkId', chunk._id)).first()
      if (embedding) await ctx.db.delete(embedding._id)
      await ctx.db.delete(chunk._id)
    }
    const sourceKind = source.kind === 'memory' ? 'memory' as const : 'file' as const
    for (const segment of args.segments) {
      const chunkId = await ctx.db.insert('knowledgeChunks', {
        chunkIndex: segment.chunkIndex,
        knowledgeSourceId: args.sourceId,
        knowledgeSourceVersionId: args.sourceVersionId,
        sourceId: args.sourceId,
        sourceKind,
        startOffset: segment.startOffset,
        text: segment.text,
        title: source.title,
        userId: args.userId,
      })
      await ctx.db.insert('knowledgeChunkEmbeddings', {
        chunkId,
        embedding: segment.embedding,
        sourceKind,
        userId: args.userId,
      })
    }
    const now = Date.now()
    await ctx.db.patch(version._id, {
      status: 'ready',
      metadata: { ...(version.metadata as Record<string, unknown>), chunks: args.segments.length },
      updatedAt: now,
    })
    await ctx.db.patch(source._id, { status: 'ready', statusMessage: undefined, updatedAt: now })
    return { replaced: true }
  },
})

export const markCanonicalSourceFailed = internalMutation({
  args: { sourceId: v.string(), sourceVersionId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const source = await ctx.db.query('knowledgeSources')
      .withIndex('by_sourceId', (q) => q.eq('sourceId', args.sourceId)).unique()
    const version = await ctx.db.query('knowledgeSourceVersions')
      .withIndex('by_sourceVersionId', (q) => q.eq('sourceVersionId', args.sourceVersionId)).unique()
    const now = Date.now()
    if (source) await ctx.db.patch(source._id, { status: 'failed', statusMessage: args.message.slice(0, 2000), updatedAt: now })
    if (version) await ctx.db.patch(version._id, { status: 'failed', updatedAt: now })
  },
})

export const reindexCanonicalSourceInternal = internalAction({
  args: {
    contentHash: v.string(),
    sourceId: v.string(),
    sourceVersionId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<{ chunks: number; skipped?: 'stale' | 'deleted' }> => {
    const value: {
      kind: 'stale' | 'ready'
      content?: string
    } | null = await ctx.runQuery(internal.knowledge.knowledge.getCanonicalSourceForReindex, args)
    if (!value || value.kind === 'stale') return { chunks: 0, skipped: value ? 'stale' : 'deleted' }
    const content = (value.content ?? '').trim()
    if (!content) {
      await ctx.runMutation(internal.knowledge.knowledge.markCanonicalSourceFailed, {
        sourceId: args.sourceId,
        sourceVersionId: args.sourceVersionId,
        message: 'Extracted source content is unavailable',
      })
      throw new Error('Extracted source content is unavailable')
    }
    const segments = chunkText(content)
    try {
      const { vectors } = await embedViaGateway(segments.map((segment) => segment.text))
      await ctx.runMutation(internal.knowledge.knowledge.replaceCanonicalSource, {
        sourceId: args.sourceId,
        sourceVersionId: args.sourceVersionId,
        userId: args.userId,
        segments: segments.map((segment, index) => ({ ...segment, embedding: vectors[index]! })),
      })
      return { chunks: segments.length }
    } catch (error) {
      await ctx.runMutation(internal.knowledge.knowledge.markCanonicalSourceFailed, {
        sourceId: args.sourceId,
        sourceVersionId: args.sourceVersionId,
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
})

export const reindexFileInternal = internalAction({
  args: { fileId: v.id('files') },
  handler: async (ctx, { fileId }) => {
    const meta = await ctx.runQuery(internal.knowledge.knowledge.getFileForReindex, { fileId })
    if (!meta || meta.kind === 'skip') return
    const { userId, projectId, name } = meta
    const MAX_INDEXABLE_BYTES = 2 * 1024 * 1024 // 2 MB
    const content = new TextEncoder().encode(meta.content).byteLength > MAX_INDEXABLE_BYTES
      ? meta.content.slice(0, MAX_INDEXABLE_BYTES)
      : meta.content
    const segments = chunkText(content)
    if (segments.length === 0) {
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'file',
        sourceId: fileId,
      })
      return
    }
    const indexingReservation = await ctx.runMutation(internal.platform.usage.tryReserveBackgroundWorkInternal, {
      userId,
      kind: 'indexing',
      chunkCount: segments.length,
      bytes: new TextEncoder().encode(content).byteLength,
    })
    if (!indexingReservation.allowed) return

    const serverSecret = getServerSecretForBackground()
    if (!serverSecret) return
    const estimatedTokens = estimateEmbeddingTokens(segments.map((s) => s.text))
    const estimatedCostUsd = await calculateGatewayEmbeddingModelCostOrNull(ctx, EMBEDDING_MODEL, estimatedTokens)
    if (estimatedCostUsd === null) return
    const reservationId = `embedding_${crypto.randomUUID()}`
    try {
      await ctx.runMutation(api.platform.usage.reserveBudgetByServer, {
        serverSecret,
        userId,
        reservationId,
        kind: 'embedding',
        modelId: EMBEDDING_MODEL,
        reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
      })
    } catch {
      return
    }

    const BATCH = 32
    const allEmb: number[][] = []
    let totalTokens = 0
    try {
      for (let i = 0; i < segments.length; i += BATCH) {
        const batch = segments.slice(i, i + BATCH).map((s) => s.text)
        const { vectors, promptTokens } = await embedViaGateway(batch)
        allEmb.push(...vectors)
        totalTokens += promptTokens
      }
      await ctx.runMutation(internal.knowledge.knowledge.replaceKnowledgeSource, {
        userId,
        projectId,
        sourceKind: 'file',
        sourceId: fileId,
        title: name,
        segments: segments.map((s, i) => ({
          text: s.text,
          chunkIndex: s.chunkIndex,
          startOffset: s.startOffset,
          embedding: allEmb[i]!,
        })),
      })
      const actualCostUsd = await calculateGatewayEmbeddingModelCostOrNull(ctx, EMBEDDING_MODEL, totalTokens || estimatedTokens)
      if (actualCostUsd === null) {
        await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
          serverSecret,
          userId,
          reservationId,
          errorMessage: `pricing_missing:${EMBEDDING_MODEL}`,
        }).catch(() => {})
        return
      }
      const costCents = applyMarkupToDollars({ providerCostUsd: actualCostUsd })
      await ctx.runMutation(api.platform.usage.finalizeBudgetReservationByServer, {
        serverSecret,
        userId,
        reservationId,
        actualCents: costCents,
        events: [{
          type: 'embedding',
          modelId: EMBEDDING_MODEL,
          inputTokens: totalTokens || estimatedTokens,
          outputTokens: 0,
          cachedTokens: 0,
          cost: costCents,
          timestamp: Date.now(),
        }],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'file_indexing_failed'
      const providerStarted = totalTokens > 0
      if (providerStarted) {
        await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
          serverSecret,
          userId,
          reservationId,
          errorMessage: message,
        }).catch(() => {})
      } else {
        await ctx.runMutation(api.platform.usage.releaseBudgetReservationByServer, {
          serverSecret,
          userId,
          reservationId,
          reason: message,
        }).catch(() => {})
      }
      throw err
    }
  },
})

export const reindexMemoryInternal = internalAction({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, { memoryId }) => {
    const meta = await ctx.runQuery(internal.knowledge.knowledge.getMemoryForReindex, { memoryId })
    if (!meta) {
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'memory',
        sourceId: memoryId,
      })
      return
    }
    const segments = chunkText(meta.content)
    if (segments.length === 0) {
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'memory',
        sourceId: memoryId,
      })
      return
    }
    const indexingReservation = await ctx.runMutation(internal.platform.usage.tryReserveBackgroundWorkInternal, {
      userId: meta.userId,
      kind: 'indexing',
      chunkCount: segments.length,
      bytes: new TextEncoder().encode(meta.content).byteLength,
    })
    if (!indexingReservation.allowed) return

    const serverSecret = getServerSecretForBackground()
    if (!serverSecret) return
    const estimatedTokens = estimateEmbeddingTokens(segments.map((s) => s.text))
    const estimatedCostUsd = await calculateGatewayEmbeddingModelCostOrNull(ctx, EMBEDDING_MODEL, estimatedTokens)
    if (estimatedCostUsd === null) return
    const reservationId = `embedding_${crypto.randomUUID()}`
    try {
      await ctx.runMutation(api.platform.usage.reserveBudgetByServer, {
        serverSecret,
        userId: meta.userId,
        reservationId,
        kind: 'embedding',
        modelId: EMBEDDING_MODEL,
        reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
      })
    } catch {
      return
    }

    let promptTokens = 0
    try {
      const embedded = await embedViaGateway(segments.map((s) => s.text))
      promptTokens = embedded.promptTokens
      await ctx.runMutation(internal.knowledge.knowledge.replaceKnowledgeSource, {
        userId: meta.userId,
        projectId: meta.projectId,
        sourceKind: 'memory',
        sourceId: memoryId,
        title: 'Memory',
        segments: segments.map((s, i) => ({
          text: s.text,
          chunkIndex: s.chunkIndex,
          startOffset: s.startOffset,
          embedding: embedded.vectors[i]!,
        })),
      })
      const actualCostUsd = await calculateGatewayEmbeddingModelCostOrNull(ctx, EMBEDDING_MODEL, promptTokens || estimatedTokens)
      if (actualCostUsd === null) {
        await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
          serverSecret,
          userId: meta.userId,
          reservationId,
          errorMessage: `pricing_missing:${EMBEDDING_MODEL}`,
        }).catch(() => {})
        return
      }
      const costCents = applyMarkupToDollars({ providerCostUsd: actualCostUsd })
      await ctx.runMutation(api.platform.usage.finalizeBudgetReservationByServer, {
        serverSecret,
        userId: meta.userId,
        reservationId,
        actualCents: costCents,
        events: [{
          type: 'embedding',
          modelId: EMBEDDING_MODEL,
          inputTokens: promptTokens || estimatedTokens,
          outputTokens: 0,
          cachedTokens: 0,
          cost: costCents,
          timestamp: Date.now(),
        }],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'memory_indexing_failed'
      if (promptTokens > 0) {
        await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
          serverSecret,
          userId: meta.userId,
          reservationId,
          errorMessage: message,
        }).catch(() => {})
      } else {
        await ctx.runMutation(api.platform.usage.releaseBudgetReservationByServer, {
          serverSecret,
          userId: meta.userId,
          reservationId,
          reason: message,
        }).catch(() => {})
      }
      throw err
    }
  },
})

function chunkMatchesProject(
  projectId: string | undefined,
  chunkProjectId: string | undefined,
): boolean {
  if (!projectId) return true
  return chunkProjectId === undefined || chunkProjectId === projectId
}

/** Post-processing after RRF: cap total injected characters and diversity per source (step 6). */
const PACK_MAX_TOTAL_CHARS = 12_000
const PACK_MAX_PER_SOURCE = 3

function packChunksForContext(
  ordered: Doc<'knowledgeChunks'>[],
  scores: Map<string, number>,
  maxChunks: number,
): HybridSearchChunk[] {
  const perSource = new Map<string, number>()
  let chars = 0
  const out: HybridSearchChunk[] = []
  for (const row of ordered) {
    if (out.length >= maxChunks) break
    const key = `${row.sourceKind}:${row.sourceId}`
    if ((perSource.get(key) ?? 0) >= PACK_MAX_PER_SOURCE) continue
    const nextLen = row.text.length
    if (chars + nextLen > PACK_MAX_TOTAL_CHARS && out.length > 0) break
    perSource.set(key, (perSource.get(key) ?? 0) + 1)
    chars += nextLen
    out.push({
      text: row.text,
      title: row.title,
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      chunkIndex: row.chunkIndex,
      score: scores.get(row._id) ?? 0,
    })
  }
  return out
}

// ─── Public hybrid search (auth via entitlements query) ──────────────────────

export const hybridSearch = action({
  args: {
    accessToken: v.optional(v.string()),
    userId: v.string(),
    /** When set to INTERNAL_API_SECRET, caller is trusted (e.g. Next.js after session or tool middleware auth). */
    serverSecret: v.optional(v.string()),
    query: v.string(),
    projectId: v.optional(v.string()),
    sourceKind: v.optional(v.union(v.literal('file'), v.literal('memory'))),
    kVec: v.optional(v.number()),
    kLex: v.optional(v.number()),
    m: v.optional(v.number()),
    minVecScore: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ chunks: HybridSearchChunk[] }> => {
    if (!validateServerSecret(args.serverSecret)) {
      await requireAccessToken(args.accessToken ?? '', args.userId)
    }

    const kVec = Math.min(256, Math.max(1, args.kVec ?? 48))
    const kLex = Math.min(1024, Math.max(1, args.kLex ?? 48))
    const m = Math.min(50, Math.max(1, args.m ?? 12))
    const q = args.query.trim()
    if (!q) {
      return { chunks: [] }
    }

    const estimatedTokens = estimateEmbeddingTokens([q])
    const estimatedCostUsd = await calculateGatewayEmbeddingModelCostOrNull(ctx, EMBEDDING_MODEL, estimatedTokens)
    if (estimatedCostUsd === null) {
      throw new Error('pricing_missing: embedding model')
    }
    const serverSecret = validateServerSecret(args.serverSecret) ? args.serverSecret! : getServerSecretForBackground()
    if (!serverSecret) {
      throw new Error('background_budget_exhausted: missing server secret')
    }
    const reservationId = `embedding_${crypto.randomUUID()}`
    try {
      await ctx.runMutation(api.platform.usage.reserveBudgetByServer, {
        serverSecret,
        userId: args.userId,
        reservationId,
        kind: 'embedding',
        modelId: EMBEDDING_MODEL,
        reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
      })
    } catch {
      throw new Error('background_budget_exhausted')
    }

    let vectors: number[][] = []
    let promptTokens = 0
    try {
      const embedded = await embedViaGateway([q])
      vectors = embedded.vectors
      promptTokens = embedded.promptTokens
    } catch (err) {
      await ctx.runMutation(api.platform.usage.releaseBudgetReservationByServer, {
        serverSecret,
        userId: args.userId,
        reservationId,
        reason: err instanceof Error ? err.message : 'embedding_search_failed',
      }).catch(() => {})
      throw err
    }
    const vector = vectors[0]!

    {
      const actualTokens = promptTokens || estimatedTokens
      const actualCostUsd = await calculateGatewayEmbeddingModelCostOrNull(ctx, EMBEDDING_MODEL, actualTokens)
      if (actualCostUsd === null) {
        await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
          serverSecret,
          userId: args.userId,
          reservationId,
          errorMessage: `pricing_missing:${EMBEDDING_MODEL}`,
        }).catch(() => {})
      } else {
        const costCents = applyMarkupToDollars({ providerCostUsd: actualCostUsd })
        await ctx.runMutation(api.platform.usage.finalizeBudgetReservationByServer, {
          serverSecret,
          userId: args.userId,
          reservationId,
          actualCents: costCents,
          events: [{
            type: 'embedding',
            modelId: EMBEDDING_MODEL,
            inputTokens: actualTokens,
            outputTokens: 0,
            cachedTokens: 0,
            cost: costCents,
            timestamp: Date.now(),
          }],
        }).catch(async (err) => {
          await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
            serverSecret,
            userId: args.userId,
            reservationId,
            errorMessage: err instanceof Error ? err.message : 'finalize_failed',
          }).catch(() => {})
        })
      }
    }

    // Vector index filter supports a single equality chain per Convex; filter userId here,
    // then optionally drop rows by sourceKind when resolving embedding → chunk ids.
    let vecRaw = await ctx.vectorSearch('knowledgeChunkEmbeddings', 'by_embedding', {
      vector,
      limit: kVec,
      filter: (fq) => fq.eq('userId', args.userId),
    })
    if (args.minVecScore !== undefined) {
      vecRaw = vecRaw.filter((r) => r._score >= args.minVecScore!)
    }

    const vecOrderedIds = vecRaw.map((r) => r._id)
    const vecChunkPairs: Array<{ chunkId: Id<'knowledgeChunks'> | null }> =
      await ctx.runQuery(internal.knowledge.knowledge.embeddingChunkIdsForVectorResults, {
        embeddingIds: vecOrderedIds,
        sourceKind: args.sourceKind,
      })

    const scores = new Map<string, number>()
    for (let i = 0; i < vecChunkPairs.length; i++) {
      const cid = vecChunkPairs[i]?.chunkId
      if (!cid) continue
      const rank = i + 1
      scores.set(cid, (scores.get(cid) ?? 0) + 1 / (RRF_K + rank))
    }

    const lexDocs = await ctx.runQuery(internal.knowledge.knowledge.searchChunksLexical, {
      userId: args.userId,
      sourceKind: args.sourceKind,
      query: q,
      limit: kLex,
    })
    for (let j = 0; j < lexDocs.length; j++) {
      const id = lexDocs[j]!._id
      const rank = j + 1
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank))
    }

    const rankedIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id as Id<'knowledgeChunks'>)

    const payloads: Doc<'knowledgeChunks'>[] = await ctx.runQuery(
      internal.knowledge.knowledge.fetchChunkPayloads,
      { ids: rankedIds },
    )
    const byId = new Map<Id<'knowledgeChunks'>, Doc<'knowledgeChunks'>>(
      payloads.map((p) => [p._id, p]),
    )
    const filtered = rankedIds
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row)
      .filter((row) => chunkMatchesProject(args.projectId, row.projectId))

    // Prefer chunks whose file was saved under this project when the user is in a project chat.
    const PROJECT_CHUNK_BOOST = 1.85
    const boostedScores = new Map(scores)
    if (args.projectId) {
      for (const row of filtered) {
        if (row.projectId === args.projectId) {
          const id = row._id
          boostedScores.set(id, (boostedScores.get(id) ?? 0) * PROJECT_CHUNK_BOOST)
        }
      }
    }
    const resorted = [...filtered].sort(
      (a, b) => (boostedScores.get(b._id) ?? 0) - (boostedScores.get(a._id) ?? 0),
    )

    const top = packChunksForContext(resorted, boostedScores, m)

    return { chunks: top }
  },
})
