import { v } from 'convex/values'
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server'
import { internal, api } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { validateServerSecret } from '../lib/auth'
import { calculateGatewayEmbeddingModelCostOrNull } from '../lib/gatewayCatalogPricing'
import { applyMarkupToDollars } from '../../src/shared/billing/billing-pricing'
import {
  resolveWorkspaceBillingRollout,
  workspaceBillingRolloutConfigFromEnv,
} from '../../src/shared/billing/workspace-billing-rollout'
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

type KnowledgeBillingPayer =
  | { scope: 'personal' }
  | { billingAccountId: string; scope: 'workspace'; workspaceId: string }

export const resolveKnowledgeBillingPayer = internalQuery({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<KnowledgeBillingPayer> => {
    if (!args.workspaceId || !resolveWorkspaceBillingRollout(
      workspaceBillingRolloutConfigFromEnv(process.env),
      args.workspaceId,
    ).eligible) {
      return { scope: 'personal' }
    }
    const workspace = await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId!))
      .unique()
    if (!workspace || workspace.kind !== 'organization') return { scope: 'personal' }
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId!))
      .unique()
    if (!account) throw new Error('workspace_wallet_not_configured')
    if (account.status !== 'active') throw new Error('billing_account_inactive')
    return {
      billingAccountId: account.billingAccountId,
      scope: 'workspace',
      workspaceId: args.workspaceId,
    }
  },
})

async function reserveKnowledgeProviderBudget(ctx: ActionCtx, args: {
  billingAccountId?: string
  idempotencyKey: string
  kind: 'embedding'
  modelId: string
  operationId: string
  programmaticSubjectId?: string
  requestFingerprint: string
  reservedCents: number
  serverSecret: string
  spendSubjectId?: string
  spendSubjectKind?: 'member' | 'programmatic'
  userId: string
  workspaceId?: string
}) {
  const hasExplicitWorkspacePayer = Boolean(
    args.billingAccountId || args.spendSubjectId || args.spendSubjectKind,
  )
  if (hasExplicitWorkspacePayer && (
    !args.billingAccountId || !args.spendSubjectId || !args.spendSubjectKind || !args.workspaceId
  )) {
    throw new Error('workspace_billing_payer_incomplete')
  }
  const payer: KnowledgeBillingPayer = hasExplicitWorkspacePayer
    ? {
        billingAccountId: args.billingAccountId!,
        scope: 'workspace',
        workspaceId: args.workspaceId!,
      }
    : await ctx.runQuery(internal.knowledge.knowledge.resolveKnowledgeBillingPayer, {
        userId: args.userId,
        workspaceId: args.workspaceId,
      })
  const reservationId = `embedding_${(await sha256Hex([
    args.userId,
    payer.scope === 'workspace' ? payer.billingAccountId : 'personal',
    args.operationId,
    args.idempotencyKey,
    args.requestFingerprint,
    args.modelId,
  ].join(':'))).slice(0, 40)}`
  const reservation = payer.scope === 'workspace'
    ? await ctx.runMutation(api.platform.usage.reserveWorkspaceBudgetByServer, {
        billingAccountId: payer.billingAccountId,
        kind: args.kind,
        modelId: args.modelId,
        operationId: args.operationId,
        requestFingerprint: args.requestFingerprint,
        reservationId,
        reservedCents: args.reservedCents,
        serverSecret: args.serverSecret,
        spendSubjectId: args.spendSubjectId ?? (args.programmaticSubjectId?.trim() || args.userId),
        spendSubjectKind: args.spendSubjectKind ?? (args.programmaticSubjectId?.trim() ? 'programmatic' : 'member'),
        userId: args.userId,
        workspaceId: payer.workspaceId,
      })
    : await ctx.runMutation(api.platform.usage.reserveBudgetByServer, {
        kind: args.kind,
        modelId: args.modelId,
        operationId: args.operationId,
        requestFingerprint: args.requestFingerprint,
        reservationId,
        reservedCents: args.reservedCents,
        serverSecret: args.serverSecret,
        userId: args.userId,
      })
  return { reservation, reservationId }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

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
    workspaceId: v.optional(v.string()),
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
        workspaceId: args.workspaceId,
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
      workspaceId: f.workspaceId,
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
    return { userId: m.userId, workspaceId: m.workspaceId, projectId: m.projectId, content: m.content }
  },
})

export const searchChunksLexical = internalQuery({
  args: {
    userId: v.string(),
    sourceKind: v.optional(v.union(v.literal('file'), v.literal('memory'))),
    workspaceId: v.optional(v.string()),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, { userId, sourceKind, workspaceId, query, limit }) => {
    const qStr = truncateSearchQuery(query)
    if (!qStr) return []
    return await ctx.db
      .query('knowledgeChunks')
      .withSearchIndex('search_text', (q) => {
        let chain = q.search('text', qStr).eq('userId', userId)
        if (sourceKind !== undefined) {
          chain = chain.eq('sourceKind', sourceKind)
        }
        if (workspaceId !== undefined) {
          chain = chain.eq('workspaceId', workspaceId)
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
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, { embeddingIds, sourceKind, workspaceId }) => {
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
      if (workspaceId !== undefined) {
        const chunk = await ctx.db.get(row.chunkId)
        if (!chunk || chunk.workspaceId !== workspaceId) {
          ordered.push({ chunkId: null })
          continue
        }
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
    const requestFingerprint = await sha256Hex(`file:${fileId}:${content}`)
    let reservationId: string
    try {
      const reserved = await reserveKnowledgeProviderBudget(ctx, {
        idempotencyKey: `file:${fileId}`,
        kind: 'embedding',
        modelId: EMBEDDING_MODEL,
        operationId: 'knowledge.reindex-file',
        programmaticSubjectId: `knowledge-index:file:${fileId}`,
        requestFingerprint,
        reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
        serverSecret,
        userId,
        workspaceId: meta.workspaceId,
      })
      reservationId = reserved.reservationId
      if (reserved.reservation.idempotent) return
    } catch {
      return
    }

    const BATCH = 32
    const allEmb: number[][] = []
    let totalTokens = 0
    try {
      await ctx.runMutation(api.platform.usage.markBudgetReservationStartedByServer, {
        serverSecret,
        userId,
        reservationId,
      })
      for (let i = 0; i < segments.length; i += BATCH) {
        const batch = segments.slice(i, i + BATCH).map((s) => s.text)
        const { vectors, promptTokens } = await embedViaGateway(batch)
        allEmb.push(...vectors)
        totalTokens += promptTokens
      }
      await ctx.runMutation(internal.knowledge.knowledge.replaceKnowledgeSource, {
        userId,
        workspaceId: meta.workspaceId,
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
          providerCostUsd: actualCostUsd,
          cost: costCents,
          timestamp: Date.now(),
        }],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'file_indexing_failed'
      await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
        serverSecret,
        userId,
        reservationId,
        errorMessage: message,
      }).catch(() => {})
      throw err
    }
  },
})

export const reindexCanonicalSourceInternal = internalAction({
  args: {
    contentHash: v.string(),
    sourceId: v.string(),
    sourceVersionId: v.string(),
    userId: v.string(),
  },
  handler: async () => {
    // Stub: canonical source reindexing is performed by the Postgres-backed
    // indexing service. This internal action exists so the BFF can schedule it
    // via the Convex scheduler without a TypeScript error against the generated
    // `internal.knowledge.knowledge` API surface.
    return { reindexed: false }
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
    const requestFingerprint = await sha256Hex(`memory:${memoryId}:${meta.content}`)
    let reservationId: string
    try {
      const reserved = await reserveKnowledgeProviderBudget(ctx, {
        idempotencyKey: `memory:${memoryId}`,
        kind: 'embedding',
        modelId: EMBEDDING_MODEL,
        operationId: 'knowledge.reindex-memory',
        programmaticSubjectId: `knowledge-index:memory:${memoryId}`,
        requestFingerprint,
        reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
        serverSecret,
        userId: meta.userId,
        workspaceId: meta.workspaceId,
      })
      reservationId = reserved.reservationId
      if (reserved.reservation.idempotent) return
    } catch {
      return
    }

    let promptTokens = 0
    try {
      await ctx.runMutation(api.platform.usage.markBudgetReservationStartedByServer, {
        serverSecret,
        userId: meta.userId,
        reservationId,
      })
      const embedded = await embedViaGateway(segments.map((s) => s.text))
      promptTokens = embedded.promptTokens
      await ctx.runMutation(internal.knowledge.knowledge.replaceKnowledgeSource, {
        userId: meta.userId,
        workspaceId: meta.workspaceId,
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
          providerCostUsd: actualCostUsd,
          cost: costCents,
          timestamp: Date.now(),
        }],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'memory_indexing_failed'
      await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
        serverSecret,
        userId: meta.userId,
        reservationId,
        errorMessage: message,
      }).catch(() => {})
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

// ─── Server-brokered hybrid search ───────────────────────────────────────────

export const hybridSearch = action({
  args: {
    userId: v.string(),
    billingUserId: v.string(),
    billingAccountId: v.optional(v.string()),
    serverSecret: v.string(),
    idempotencyKey: v.string(),
    operationId: v.string(),
    programmaticSubjectId: v.optional(v.string()),
    spendSubjectId: v.optional(v.string()),
    spendSubjectKind: v.optional(v.union(v.literal('member'), v.literal('programmatic'))),
    requestFingerprint: v.string(),
    query: v.string(),
    projectId: v.optional(v.string()),
    sourceKind: v.optional(v.union(v.literal('file'), v.literal('memory'))),
    workspaceId: v.optional(v.string()),
    kVec: v.optional(v.number()),
    kLex: v.optional(v.number()),
    m: v.optional(v.number()),
    minVecScore: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ chunks: HybridSearchChunk[] }> => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')

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
    const serverSecret = args.serverSecret
    let reservationId: string
    try {
      const reserved = await reserveKnowledgeProviderBudget(ctx, {
        billingAccountId: args.billingAccountId,
        idempotencyKey: args.idempotencyKey,
        kind: 'embedding',
        modelId: EMBEDDING_MODEL,
        operationId: args.operationId,
        programmaticSubjectId: args.programmaticSubjectId,
        requestFingerprint: args.requestFingerprint,
        reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
        serverSecret,
        spendSubjectId: args.spendSubjectId,
        spendSubjectKind: args.spendSubjectKind,
        userId: args.billingUserId,
        workspaceId: args.workspaceId,
      })
      reservationId = reserved.reservationId
      if (reserved.reservation.idempotent || reserved.reservation.status !== 'reserved') {
        throw new Error(`provider_operation_already_reserved:${reserved.reservation.status}`)
      }
    } catch {
      throw new Error('background_budget_exhausted')
    }

    let vectors: number[][] = []
    let promptTokens = 0
    try {
      await ctx.runMutation(api.platform.usage.markBudgetReservationStartedByServer, {
        serverSecret,
        userId: args.billingUserId,
        reservationId,
      })
      const embedded = await embedViaGateway([q])
      vectors = embedded.vectors
      promptTokens = embedded.promptTokens
    } catch (err) {
      await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
        serverSecret,
        userId: args.billingUserId,
        reservationId,
        errorMessage: err instanceof Error ? err.message : 'embedding_search_failed',
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
          userId: args.billingUserId,
          reservationId,
          errorMessage: `pricing_missing:${EMBEDDING_MODEL}`,
        }).catch(() => {})
      } else {
        const costCents = applyMarkupToDollars({ providerCostUsd: actualCostUsd })
        await ctx.runMutation(api.platform.usage.finalizeBudgetReservationByServer, {
          serverSecret,
          userId: args.billingUserId,
          reservationId,
          actualCents: costCents,
          events: [{
            type: 'embedding',
            modelId: EMBEDDING_MODEL,
            inputTokens: actualTokens,
            outputTokens: 0,
            cachedTokens: 0,
            providerCostUsd: actualCostUsd,
            cost: costCents,
            timestamp: Date.now(),
          }],
        }).catch(async (err) => {
          await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
            serverSecret,
            userId: args.billingUserId,
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
        workspaceId: args.workspaceId,
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
      workspaceId: args.workspaceId,
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
