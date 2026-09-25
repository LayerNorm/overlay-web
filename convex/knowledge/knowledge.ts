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
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { calculateGatewayEmbeddingModelCostOrNull } from '../lib/gatewayCatalogPricing'
import { applyMarkupToDollars } from '../../src/shared/billing/billing-pricing'
import { agentMemoryOwnerId } from '../../src/shared/agents/agent-memory'
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
  sourceKind: 'file' | 'memory' | 'message'
  sourceId: string
  chunkIndex: number
  score: number
  /** Raw vector similarity when ranked via vector search (absent for lexical-only hits). `score` is the fused RRF value. */
  vecScore?: number
}

const KNOWLEDGE_SOURCE_KINDS = v.union(
  v.literal('file'),
  v.literal('memory'),
  v.literal('message'),
)

/** Recency decay for memory chunks — OpenClaw's 30-day half-life on the fused score. */
const MEMORY_HALF_LIFE_DAYS = 30
const DAY_MS = 86_400_000

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
    sourceKind: KNOWLEDGE_SOURCE_KINDS,
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
    sourceKind: KNOWLEDGE_SOURCE_KINDS,
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
    // Denormalized memory-lifecycle fields so search filters need no join.
    expiresAt: v.optional(v.number()),
    visibility: v.optional(v.union(v.literal('owner'), v.literal('workspace'))),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    superseded: v.optional(v.boolean()),
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
        sourceKind: args.sourceKind,
        sourceId: args.sourceId,
        chunkIndex: seg.chunkIndex,
        startOffset: seg.startOffset,
        text: seg.text,
        title: args.title,
        expiresAt: args.expiresAt,
        visibility: args.visibility,
        createdAt: args.createdAt,
        updatedAt: args.updatedAt,
        superseded: args.superseded,
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
    return {
      userId: m.userId,
      workspaceId: m.workspaceId,
      content: m.content,
      tags: m.tags,
      expiresAt: m.expiresAt,
      visibility: m.visibility,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt ?? m.createdAt,
      superseded: m.supersededBy !== undefined,
    }
  },
})

export const searchChunksLexical = internalQuery({
  args: {
    userId: v.string(),
    sourceKind: v.optional(KNOWLEDGE_SOURCE_KINDS),
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

export const listWorkspaceMemoryUserIds = internalQuery({
  args: {
    requestingUserId: v.string(),
    workspaceId: v.string(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, { requestingUserId, workspaceId }) => {
    const [principals, memberships] = await Promise.all([
      ctx.db
        .query('workspacePrincipals')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(200),
      ctx.db
        .query('workspaceMemberships')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
        .take(200),
    ])
    const activePrincipalIds = new Set(
      memberships
        .filter((membership) => membership.status === 'active')
        .map((membership) => membership.principalId),
    )
    // Agents own memories the same way members do, under a synthetic owner id
    // derived from the agent id. Their memories are workspace knowledge, so
    // they join the recall scope for every member of the workspace rather than
    // staying private to the agent that wrote them.
    const userIds = principals.flatMap((principal) => {
      if (principal.archivedAt || !activePrincipalIds.has(principal.principalId)) return []
      if (principal.type === 'human' && principal.userId) return [principal.userId]
      if (principal.type === 'agent' && principal.agentId) return [agentMemoryOwnerId(principal.agentId)]
      return []
    })
    if (!userIds.includes(requestingUserId)) throw new Error('WORKSPACE_ACCESS_DENIED')
    return [...new Set(userIds)]
  },
})

export const embeddingChunkIdsForVectorResults = internalQuery({
  args: {
    embeddingIds: v.array(v.id('knowledgeChunkEmbeddings')),
    sourceKind: v.optional(KNOWLEDGE_SOURCE_KINDS),
    sourceKinds: v.optional(v.array(KNOWLEDGE_SOURCE_KINDS)),
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, { embeddingIds, sourceKind, sourceKinds, workspaceId }) => {
    const kinds = sourceKinds ?? (sourceKind !== undefined ? [sourceKind] : undefined)
    const ordered: Array<{ chunkId: Id<'knowledgeChunks'> | null }> = []
    for (const id of embeddingIds) {
      const row = await ctx.db.get(id)
      if (!row) {
        ordered.push({ chunkId: null })
        continue
      }
      if (kinds !== undefined && !kinds.includes(row.sourceKind)) {
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
    const { userId, name } = meta
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

/**
 * Billed embed-and-store for one source's chunks: background-work gate →
 * budget reservation → embed → replaceKnowledgeSource → finalize/reconcile.
 * Shared by the memory and message reindex paths.
 */
async function indexSourceTextBilled(
  ctx: ActionCtx,
  args: {
    userId: string
    workspaceId?: string
    sourceKind: 'file' | 'memory' | 'message'
    sourceId: string
    title: string
    indexText: string
    expiresAt?: number
    visibility?: 'owner' | 'workspace'
    createdAt?: number
    updatedAt?: number
    superseded?: boolean
    /** Stable per-source string making the budget reservation idempotent. */
    operationId: string
    /**
     * Server-secret-authenticated callers (benchmarks, internal tooling) skip
     * the per-user daily background-work cap — that gate bounds real-account
     * embedding spend, not synthetic harness users.
     */
    trustedInternal?: boolean
    /**
     * Optional discriminator mixed into the reservation idempotency key.
     * Purge-then-reindex of identical content would otherwise hit the stale
     * reservation and skip before chunks are rewritten.
     */
    reservationNonce?: string
  },
): Promise<'indexed' | 'skipped'> {
  const segments = chunkText(args.indexText)
  if (segments.length === 0) {
    await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
      sourceKind: args.sourceKind,
      sourceId: args.sourceId,
    })
    return 'skipped'
  }
  if (!args.trustedInternal) {
    const indexingReservation = await ctx.runMutation(internal.platform.usage.tryReserveBackgroundWorkInternal, {
      userId: args.userId,
      kind: 'indexing',
      chunkCount: segments.length,
      bytes: new TextEncoder().encode(args.indexText).byteLength,
    })
    if (!indexingReservation.allowed) return 'skipped'
  }

  const serverSecret = getServerSecretForBackground()
  if (!serverSecret) return 'skipped'
  const estimatedTokens = estimateEmbeddingTokens(segments.map((s) => s.text))
  const estimatedCostUsd = await calculateGatewayEmbeddingModelCostOrNull(ctx, EMBEDDING_MODEL, estimatedTokens)
  if (estimatedCostUsd === null) return 'skipped'
  const requestFingerprint = await sha256Hex(`${args.sourceKind}:${args.sourceId}:${args.indexText}`)
  let reservationId: string
  try {
    const reserved = await reserveKnowledgeProviderBudget(ctx, {
      idempotencyKey: `${args.sourceKind}:${args.sourceId}${args.reservationNonce ? `:${args.reservationNonce}` : ''}`,
      kind: 'embedding',
      modelId: EMBEDDING_MODEL,
      operationId: args.operationId,
      programmaticSubjectId: `knowledge-index:${args.sourceKind}:${args.sourceId}`,
      requestFingerprint,
      reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
      serverSecret,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
    reservationId = reserved.reservationId
    if (reserved.reservation.idempotent) return 'skipped'
  } catch {
    return 'skipped'
  }

  let promptTokens = 0
  try {
    await ctx.runMutation(api.platform.usage.markBudgetReservationStartedByServer, {
      serverSecret,
      userId: args.userId,
      reservationId,
    })
    const embedded = await embedViaGateway(segments.map((s) => s.text))
    promptTokens = embedded.promptTokens
    await ctx.runMutation(internal.knowledge.knowledge.replaceKnowledgeSource, {
      userId: args.userId,
      workspaceId: args.workspaceId,
      sourceKind: args.sourceKind,
      sourceId: args.sourceId,
      title: args.title,
      expiresAt: args.expiresAt,
      visibility: args.visibility,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      superseded: args.superseded,
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
        userId: args.userId,
        reservationId,
        errorMessage: `pricing_missing:${EMBEDDING_MODEL}`,
      }).catch(() => {})
      return 'indexed'
    }
    const costCents = applyMarkupToDollars({ providerCostUsd: actualCostUsd })
    await ctx.runMutation(api.platform.usage.finalizeBudgetReservationByServer, {
      serverSecret,
      userId: args.userId,
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
    return 'indexed'
  } catch (err) {
    const message = err instanceof Error ? err.message : 'indexing_failed'
    await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
      serverSecret,
      userId: args.userId,
      reservationId,
      errorMessage: message,
    }).catch(() => {})
    throw err
  }
}

export const reindexMemoryInternal = internalAction({
  args: { memoryId: v.id('memories'), trustedInternal: v.optional(v.boolean()) },
  handler: async (ctx, { memoryId, trustedInternal }) => {
    const meta = await ctx.runQuery(internal.knowledge.knowledge.getMemoryForReindex, { memoryId })
    if (!meta) {
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'memory',
        sourceId: memoryId,
      })
      return
    }
    // Tags are stored on the row but were never indexed — append them so both
    // lexical and semantic search can hit them.
    const indexText = meta.tags?.length
      ? `${meta.content}\nTags: ${meta.tags.join(', ')}`
      : meta.content
    await indexSourceTextBilled(ctx, {
      userId: meta.userId,
      workspaceId: meta.workspaceId,
      sourceKind: 'memory',
      sourceId: memoryId,
      title: 'Memory',
      indexText,
      expiresAt: meta.expiresAt,
      visibility: meta.visibility,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      superseded: meta.superseded,
      operationId: 'knowledge.reindex-memory',
      trustedInternal,
    })
  },
})

// ─── Message indexing (M2): the verbatim evidence layer ─────────────────────
//
// Memory rows are the curated layer; messages are the raw corpus. When the
// extractor paraphrases away a date or entity, `sourceKind: 'message'` chunks
// still surface the original turn verbatim.

const MIN_MESSAGE_INDEX_CHARS = 8

function messageTextForIndex(m: {
  content: string
  parts?: unknown
}): string {
  const parts = m.parts as Array<{ type?: string; text?: string }> | undefined
  const textParts = parts
    ?.filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text!) ?? []
  return (textParts.join(' ').trim() || m.content).trim()
}

function messageSpeakerLabel(m: {
  role: string
  authorKind?: string
  importedAuthorName?: string
}): string {
  if (m.importedAuthorName?.trim()) return m.importedAuthorName.trim()
  if (m.authorKind === 'agent' || m.role === 'assistant') return 'Assistant'
  return 'User'
}

function messageIndexText(createdAt: number, speaker: string, text: string): string {
  const date = new Date(createdAt).toISOString().slice(0, 10)
  return `[${date}] ${speaker}: ${text}`
}

export const getMessageForReindex = internalQuery({
  args: { messageId: v.id('conversationMessages') },
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId)
    if (!m || m.deletedAt) return null
    const text = messageTextForIndex(m)
    if (text.length < MIN_MESSAGE_INDEX_CHARS) return null
    const convo = await ctx.db.get(m.conversationId)
    return {
      userId: m.userId,
      workspaceId: convo?.workspaceId,
      turnId: m.turnId,
      speaker: messageSpeakerLabel(m),
      text,
      createdAt: m.createdAt,
    }
  },
})

export const reindexMessageInternal = internalAction({
  args: { messageId: v.id('conversationMessages') },
  handler: async (ctx, { messageId }) => {
    const meta = await ctx.runQuery(internal.knowledge.knowledge.getMessageForReindex, { messageId })
    if (!meta) {
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'message',
        sourceId: messageId,
      })
      return
    }
    await indexSourceTextBilled(ctx, {
      userId: meta.userId,
      workspaceId: meta.workspaceId,
      sourceKind: 'message',
      sourceId: messageId,
      title: `${new Date(meta.createdAt).toISOString().slice(0, 10)} · ${meta.speaker}`,
      indexText: messageIndexText(meta.createdAt, meta.speaker, meta.text),
      createdAt: meta.createdAt,
      updatedAt: meta.createdAt,
      // Workspace conversations are shared context; personal chats are not.
      visibility: meta.workspaceId ? 'workspace' : 'owner',
      operationId: 'knowledge.reindex-message',
    })
  },
})

/** Page of a conversation's messages for the backfill action. */
export const listConversationMessagesPage = internalQuery({
  args: {
    conversationId: v.id('conversations'),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { conversationId, cursor }) => {
    const convo = await ctx.db.get(conversationId)
    const page = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('asc')
      .paginate({ cursor: cursor ?? null, numItems: 50 })
    return {
      workspaceId: convo?.workspaceId,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      messages: page.page
        .filter((m) => !m.deletedAt && m.status === 'completed')
        .map((m) => ({
          messageId: m._id,
          userId: m.userId,
          speaker: messageSpeakerLabel(m),
          text: messageTextForIndex(m),
          createdAt: m.createdAt,
        }))
        .filter((m) => m.text.length >= MIN_MESSAGE_INDEX_CHARS),
    }
  },
})

/**
 * Backfills `sourceKind: 'message'` chunks for a conversation written before
 * M2. Pages forward and reschedules itself; each message is billed-indexed
 * once (idempotent re-runs skip via the reservation fingerprint).
 */
export const backfillConversationMessages = internalAction({
  args: {
    conversationId: v.id('conversations'),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { conversationId, cursor }) => {
    const page = await ctx.runQuery(internal.knowledge.knowledge.listConversationMessagesPage, {
      conversationId,
      cursor,
    })
    for (const m of page.messages) {
      await indexSourceTextBilled(ctx, {
        userId: m.userId,
        workspaceId: page.workspaceId,
        sourceKind: 'message',
        sourceId: m.messageId,
        title: `${new Date(m.createdAt).toISOString().slice(0, 10)} · ${m.speaker}`,
        indexText: messageIndexText(m.createdAt, m.speaker, m.text),
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
        visibility: page.workspaceId ? 'workspace' : 'owner',
        operationId: 'knowledge.backfill-message',
      })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.backfillConversationMessages, {
        conversationId,
        cursor: page.continueCursor,
      })
    }
  },
})

/**
 * Drops the message-chunk layer for a deleted conversation. Pages through
 * conversationMessages so large threads stay inside mutation limits; reschedules
 * itself until the index walk is done.
 */
export const purgeConversationMessageChunks = internalMutation({
  args: {
    conversationId: v.id('conversations'),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { conversationId, cursor }) => {
    const page = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('asc')
      .paginate({ cursor: cursor ?? null, numItems: 200 })
    for (const m of page.page) {
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'message',
        sourceId: m._id,
      })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.purgeConversationMessageChunks, {
        conversationId,
        cursor: page.continueCursor,
      })
    }
  },
})

/**
 * Public message-index entry for callers that don't have a conversationMessages
 * row — benchmark harness turns and API-ingested content. Same billed path.
 */
export const indexMessageContent = action({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    sourceId: v.string(),
    text: v.string(),
    speaker: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    conversationId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    reservationNonce: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trustedInternal = validateServerSecret(args.serverSecret)
    if (!trustedInternal) {
      await requireAccessToken(args.accessToken ?? '', args.userId)
    }
    const text = args.text.trim()
    if (text.length < MIN_MESSAGE_INDEX_CHARS) return { indexed: false }
    const createdAt = args.createdAt ?? Date.now()
    const speaker = args.speaker?.trim() || 'User'
    const result = await indexSourceTextBilled(ctx, {
      userId: args.userId,
      workspaceId: args.workspaceId,
      sourceKind: 'message',
      sourceId: args.sourceId,
      title: `${new Date(createdAt).toISOString().slice(0, 10)} · ${speaker}`,
      indexText: messageIndexText(createdAt, speaker, text),
      createdAt,
      updatedAt: createdAt,
      visibility: args.workspaceId ? 'workspace' : 'owner',
      operationId: 'knowledge.index-message-content',
      trustedInternal,
      reservationNonce: trustedInternal ? args.reservationNonce : undefined,
    })
    return { indexed: result === 'indexed' }
  },
})

/** Paired with indexMessageContent — drops a caller-owned message source. */
export const purgeMessageContent = action({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) {
      await requireAccessToken(args.accessToken ?? '', args.userId)
    }
    await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
      sourceKind: 'message',
      sourceId: args.sourceId,
    })
    return { purged: true }
  },
})

/** Post-processing after RRF: cap total injected characters and diversity per source (step 6). */
const PACK_MAX_TOTAL_CHARS = 12_000
const PACK_MAX_PER_SOURCE = 3

function packChunksForContext(
  ordered: Doc<'knowledgeChunks'>[],
  scores: Map<string, number>,
  vecScores: Map<string, number>,
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
      vecScore: vecScores.get(row._id),
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
    sourceKind: v.optional(KNOWLEDGE_SOURCE_KINDS),
    /** Multi-kind filter (e.g. memory + message). Overrides sourceKind when set. */
    sourceKinds: v.optional(v.array(KNOWLEDGE_SOURCE_KINDS)),
    /** Recency decay on memory chunks (default on); dedup callers disable it. */
    applyRecencyDecay: v.optional(v.boolean()),
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

    const callerKinds = args.sourceKinds ?? (args.sourceKind !== undefined ? [args.sourceKind] : undefined)
    const wantsMemory = callerKinds === undefined || callerKinds.includes('memory')
    const wantsMessage = callerKinds === undefined || callerKinds.includes('message')
    const memoryUserIds: string[] = args.workspaceId && wantsMemory
      ? await ctx.runQuery(internal.knowledge.knowledge.listWorkspaceMemoryUserIds, {
          requestingUserId: args.userId,
          workspaceId: args.workspaceId,
        })
      : [args.userId]
    const additionalMemoryUserIds = memoryUserIds.filter((userId) => userId !== args.userId)
    // Other members contribute shared-context kinds only — never their files.
    const expansionKinds = (['memory', 'message'] as const).filter(
      (kind) => kind === 'memory' ? wantsMemory : wantsMessage,
    )

    // The current member keeps access to their indexed files. Additional workspace members
    // contribute memory chunks only, preserving file ownership while sharing memory context.
    const currentVectorSearch = ctx.vectorSearch('knowledgeChunkEmbeddings', 'by_embedding', {
      vector,
      limit: kVec,
      filter: (fq) => fq.eq('userId', args.userId),
    })
    const additionalMemorySearches = additionalMemoryUserIds.map((userId) => (
      ctx.vectorSearch('knowledgeChunkEmbeddings', 'by_embedding', {
        vector,
        limit: kVec,
        filter: (fq) => fq.eq('userId', userId),
      })
    ))
    const vectorGroups = (await Promise.all([currentVectorSearch, ...additionalMemorySearches]))
      .map((group) => args.minVecScore === undefined
        ? group
        : group.filter((row) => row._score >= args.minVecScore!))
    const vectorPairGroups = await Promise.all(vectorGroups.map((group, index) => (
      ctx.runQuery(internal.knowledge.knowledge.embeddingChunkIdsForVectorResults, {
        embeddingIds: group.map((row) => row._id),
        sourceKinds: index === 0 ? callerKinds : [...expansionKinds],
        workspaceId: args.workspaceId,
      })
    )))
    const rankedVectorPairs = vectorGroups.flatMap((group, groupIndex) => (
      group.map((row, rowIndex) => ({
        chunkId: vectorPairGroups[groupIndex]?.[rowIndex]?.chunkId ?? null,
        score: row._score,
      }))
    )).sort((a, b) => b.score - a.score).slice(0, kVec)

    const scores = new Map<string, number>()
    const vecScores = new Map<string, number>()
    for (let i = 0; i < rankedVectorPairs.length; i++) {
      const cid = rankedVectorPairs[i]?.chunkId
      if (!cid) continue
      vecScores.set(cid, Math.max(vecScores.get(cid) ?? 0, rankedVectorPairs[i]!.score))
      const rank = i + 1
      scores.set(cid, (scores.get(cid) ?? 0) + 1 / (RRF_K + rank))
    }

    // The search index filters one sourceKind at a time — multi-kind requests
    // run one lexical search per kind and interleave by rank.
    const lexLists = await Promise.all([
      ...(callerKinds ?? [undefined]).map((kind) => ctx.runQuery(internal.knowledge.knowledge.searchChunksLexical, {
        userId: args.userId,
        sourceKind: kind,
        workspaceId: args.workspaceId,
        query: q,
        limit: kLex,
      })),
      ...additionalMemoryUserIds.flatMap((userId) => (
        expansionKinds.map((kind) => ctx.runQuery(internal.knowledge.knowledge.searchChunksLexical, {
          userId,
          sourceKind: kind,
          workspaceId: args.workspaceId,
          query: q,
          limit: kLex,
        }))
      )),
    ])
    const lexDocs = interleaveRankedLists(lexLists, kLex)
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
    const now = Date.now()
    const filtered = rankedIds
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row)
      // M1 memory lifecycle: superseded and expired memory chunks are dropped
      // at retrieval (rows stay in `memories` for audit). Owner-private chunks
      // only surface in the owner's own scope — other members' expansion
      // searches must not see them.
      .filter((row) => !row.superseded)
      .filter((row) => row.expiresAt === undefined || row.expiresAt > now)
      .filter((row) => row.userId === args.userId || row.visibility !== 'owner')

    // Recency decay on memory chunks: fused score halves every 30 days since
    // the fact was last confirmed (updatedAt, which `touch` bumps). Message
    // and file chunks don't decay — verbatim evidence stays findable.
    const ranked = args.applyRecencyDecay === false
      ? scores
      : new Map<string, number>(
          [...scores.entries()].map(([id, score]): [string, number] => {
            const row = byId.get(id as Id<'knowledgeChunks'>)
            const recency = row?.sourceKind === 'memory' ? (row.updatedAt ?? row.createdAt) : undefined
            if (recency === undefined) return [id, score]
            const ageDays = Math.max(0, (now - recency) / DAY_MS)
            return [id, score * Math.pow(0.5, ageDays / MEMORY_HALF_LIFE_DAYS)]
          }),
        )
    const resorted = [...filtered].sort(
      (a, b) => (ranked.get(b._id) ?? 0) - (ranked.get(a._id) ?? 0),
    )

    const top = packChunksForContext(resorted, ranked, vecScores, m)

    return { chunks: top }
  },
})

function interleaveRankedLists<T>(lists: T[][], limit: number): T[] {
  const out: T[] = []
  for (let index = 0; out.length < limit; index += 1) {
    let added = false
    for (const list of lists) {
      const value = list[index]
      if (value === undefined) continue
      out.push(value)
      added = true
      if (out.length >= limit) break
    }
    if (!added) break
  }
  return out
}
