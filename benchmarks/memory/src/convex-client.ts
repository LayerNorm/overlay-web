import { ConvexHttpClient } from 'convex/browser'
import { config, fingerprint } from './config'
import { withRetry } from './gateway'

/**
 * Thin Convex wrapper for the benchmark. Uses string function references so
 * the harness does not depend on the generated api tree, and always
 * authenticates with INTERNAL_API_SECRET (the same serverSecret the BFF uses).
 */

let client: ConvexHttpClient | null = null

export function benchConvex(): ConvexHttpClient {
  if (!client) {
    client = new ConvexHttpClient(config.convexUrl)
  }
  return client
}

export type BenchMemoryRow = {
  _id: string
  content: string
  createdAt: number
  updatedAt?: number
  deletedAt?: number
  turnId?: string
  conversationId?: string
  type?: string
}

export async function addMemory(args: {
  userId: string
  content: string
  source?: 'chat' | 'note' | 'manual'
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  actor?: 'user' | 'agent'
  conversationId?: string
  turnId?: string
  importance?: number
  tags?: string[]
  expiresAt?: number
  eventAt?: number
}): Promise<string> {
  const id = await withRetry(
    () =>
      benchConvex().mutation('knowledge/memories:add' as never, {
        ...args,
        source: args.source ?? 'chat',
        serverSecret: config.serverSecret,
      } as never),
    'memories:add',
  )
  return id as string
}

export async function updateMemory(args: {
  userId: string
  memoryId: string
  content: string
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  expiresAt?: number
  eventAt?: number
}): Promise<void> {
  await withRetry(
    () =>
      benchConvex().mutation('knowledge/memories:update' as never, {
        ...args,
        serverSecret: config.serverSecret,
      } as never),
    'memories:update',
  )
}

export async function touchMemory(args: { userId: string; memoryId: string }): Promise<void> {
  await withRetry(
    () =>
      benchConvex().mutation('knowledge/memories:touch' as never, {
        ...args,
        serverSecret: config.serverSecret,
      } as never),
    'memories:touch',
  )
}

export async function supersedeMemory(args: {
  userId: string
  memoryId: string
  content: string
  source?: 'chat' | 'note' | 'manual'
  type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  actor?: 'user' | 'agent'
  conversationId?: string
  turnId?: string
  expiresAt?: number
  eventAt?: number
}): Promise<string> {
  const id = await withRetry(
    () =>
      benchConvex().mutation('knowledge/memories:supersede' as never, {
        ...args,
        source: args.source ?? 'chat',
        serverSecret: config.serverSecret,
      } as never),
    'memories:supersede',
  )
  return id as string
}

export async function getMemoriesByIds(args: {
  userId: string
  memoryIds: string[]
  includeDeleted?: boolean
}): Promise<BenchMemoryRow[]> {
  const rows = await withRetry(
    () =>
      benchConvex().query('knowledge/memories:getByIds' as never, {
        ...args,
        serverSecret: config.serverSecret,
      } as never),
    'memories:getByIds',
  )
  return (rows as BenchMemoryRow[]) ?? []
}

export async function removeMemory(args: { userId: string; memoryId: string }): Promise<void> {
  await withRetry(
    () =>
      benchConvex().mutation('knowledge/memories:remove' as never, {
        ...args,
        serverSecret: config.serverSecret,
      } as never),
    'memories:remove',
  )
}

export async function listMemories(args: {
  userId: string
  includeDeleted?: boolean
  updatedSince?: number
}): Promise<BenchMemoryRow[]> {
  const rows = await withRetry(
    () =>
      benchConvex().query('knowledge/memories:list' as never, {
        ...args,
        serverSecret: config.serverSecret,
      } as never),
    'memories:list',
  )
  return (rows as BenchMemoryRow[]) ?? []
}

/**
 * Full row set past the 100-row page cap, via updatedSince watermark
 * pagination (updatedAt ≈ createdAt for bench rows; dedupe by _id anyway).
 */
export async function listAllMemories(args: {
  userId: string
  includeDeleted?: boolean
}): Promise<BenchMemoryRow[]> {
  const out = new Map<string, BenchMemoryRow>()
  let watermark = 0
  for (let page = 0; page < 60; page++) {
    const rows = await listMemories({ ...args, updatedSince: watermark })
    const fresh = rows.filter((r) => !out.has(r._id))
    for (const r of fresh) out.set(r._id, r)
    if (rows.length < 100) break
    watermark = Math.min(...rows.map((r) => r.updatedAt ?? r.createdAt))
  }
  return [...out.values()]
}

/**
 * Soft-delete every memory owned by the bench user (index purged per row).
 * `list` returns ≤100 rows, so loop until the live set is empty — LoCoMo
 * cases accumulate far more than one page.
 */
export async function purgeBenchUser(userId: string, knownIds?: string[]): Promise<number> {
  let removed = 0
  // `list` takes the newest-100 window then filters deleted, so it can't page
  // past tombstones — purge by the ids recorded during ingest first.
  for (const id of new Set(knownIds ?? [])) {
    try {
      await removeMemory({ userId, memoryId: id })
      removed++
    } catch {
      // Already deleted or never persisted — keep sweeping.
    }
  }
  for (let page = 0; page < 50; page++) {
    const rows = await listMemories({ userId })
    const live = rows.filter((r) => !r.deletedAt)
    if (!live.length) break
    for (const row of live) {
      await removeMemory({ userId, memoryId: row._id })
      removed++
    }
  }
  return removed
}

export type HybridChunk = {
  text: string
  title?: string
  sourceKind: 'file' | 'memory' | 'message'
  sourceId: string
  chunkIndex: number
  score: number
  /** Raw vector similarity (absent for lexical-only hits). `score` is RRF. */
  vecScore?: number
}

/**
 * Index one raw message as searchable `sourceKind: 'message'` chunks — the
 * verbatim evidence layer production writes at save/finalize time.
 */
export async function indexMessage(args: {
  userId: string
  sourceId: string
  text: string
  speaker?: string
  createdAt?: number
  conversationId?: string
  workspaceId?: string
  /** Per-ingest nonce: purge+re-ingest must bypass the stale budget reservation. */
  reservationNonce?: string
}): Promise<boolean> {
  const res = await withRetry(
    () =>
      benchConvex().action('knowledge/knowledge:indexMessageContent' as never, {
        ...args,
        serverSecret: config.serverSecret,
      } as never),
    'indexMessageContent',
  )
  return (res as { indexed?: boolean })?.indexed === true
}

/** Drop one indexed message source — purge parity for `indexMessage`. */
export async function purgeMessageSource(args: {
  userId: string
  sourceId: string
}): Promise<void> {
  await withRetry(
    () =>
      benchConvex().action('knowledge/knowledge:purgeMessageContent' as never, {
        ...args,
        serverSecret: config.serverSecret,
      } as never),
    'purgeMessageContent',
  )
}

export async function hybridSearch(args: {
  userId: string
  query: string
  sourceKind?: 'file' | 'memory' | 'message'
  sourceKinds?: Array<'file' | 'memory' | 'message'>
  kVec?: number
  kLex?: number
  m?: number
  minVecScore?: number
  applyRecencyDecay?: boolean
}): Promise<HybridChunk[]> {
  const billingUserId = config.billingUserId || args.userId
  const res = await withRetry(
    () =>
      benchConvex().action('knowledge/knowledge:hybridSearch' as never, {
        userId: args.userId,
        billingUserId,
        serverSecret: config.serverSecret,
        idempotencyKey: fingerprint('search', args.userId, args.query, Date.now().toString()),
        operationId: 'benchmark.hybrid-search',
        requestFingerprint: fingerprint('req', args.userId, args.query),
        query: args.query,
        sourceKind: args.sourceKind,
        sourceKinds: args.sourceKinds,
        kVec: args.kVec ?? config.retrieval.kVec,
        kLex: args.kLex ?? config.retrieval.kLex,
        m: args.m ?? config.retrieval.m,
        ...(args.minVecScore !== undefined ? { minVecScore: args.minVecScore } : {}),
        ...(args.applyRecencyDecay !== undefined ? { applyRecencyDecay: args.applyRecencyDecay } : {}),
      } as never),
    'hybridSearch',
  )
  const chunks = (res as { chunks?: HybridChunk[] })?.chunks ?? []
  return chunks
}
