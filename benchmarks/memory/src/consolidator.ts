import { z } from 'zod'
import {
  buildMemoryDedupDecisionPrompt,
  DEDUP_AUTO_NOOP_VEC_SCORE,
  DEDUP_MIN_VEC_SCORE,
  MEMORY_DEDUP_DECISION_SYSTEM_PROMPT,
  MemoryDedupDecisionSchema,
  type MemoryDedupDecision,
} from '../../../src/shared/knowledge/memory-extraction-shared'
import {
  addMemory,
  getMemoriesByIds,
  hybridSearch,
  listAllMemories,
  touchMemory,
  type BenchMemoryRow,
} from './convex-client'
import { config } from './config'
import { benchObject, normalizeDedupJson, withRetry } from './gateway'

/**
 * Stage 2 "dreaming" pass — derive cross-memory inferences after ingest.
 *
 * Faithful replica of the planned Convex `consolidateOwner` internalAction:
 * same inputs (recent live stated memories), same outputs (inferred memory
 * rows with `derivedFrom` edges). Running it harness-side keeps the LLM call
 * on the bench's free gateway with no billing plumbing; a prod cron version
 * ships only if the flagged bench run moves the needle.
 *
 * Dedup for inferred candidates is the extraction gate restricted to
 * add/noop — a decision of update/supersede means an existing stated memory
 * already covers the inference, so it becomes touch (sourceCount++).
 */

const DerivationSchema = z.object({
  inferences: z.array(
    z.object({
      content: z.string(),
      type: z.enum(['preference', 'fact', 'project', 'decision', 'agent']).optional(),
      /** 0-based indexes into the digest, in order of importance. */
      supportIndexes: z.array(z.number()).min(2),
    }),
  ).max(20),
})
type Derivation = z.infer<typeof DerivationSchema>

const DERIVATION_TYPES = new Set(['preference', 'fact', 'project', 'decision', 'agent'])

/**
 * Free models emit `inferences` under misspelled keys, as plain strings, or
 * with supports under alias names (supports/sources/evidence). An inference
 * without ≥2 resolvable supports can't satisfy the derivation rule — drop it
 * here (same outcome as the post-parse support check).
 */
const normalizeDerivationJson = (json: unknown): unknown => {
  if (!json || typeof json !== 'object') return json
  const rec = json as Record<string, unknown>
  const items = Array.isArray(rec.inferences)
    ? rec.inferences
    : Object.values(rec).find((v) => Array.isArray(v))
  if (!Array.isArray(items)) return json

  const SUPPORT_KEYS = ['supportIndexes', 'supports', 'support', 'sourceIndexes', 'supportingIndexes', 'evidence']
  const parseSupport = (v: unknown): number[] => {
    const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : v === undefined || v === null ? [] : [v]
    return list.map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10))).filter((n) => Number.isInteger(n) && n >= 0)
  }

  const cleaned = items
    .map((i): Record<string, unknown> | null => {
      if (!i || typeof i !== 'object') return null // plain strings carry no supports — always <2
      const r = i as Record<string, unknown>
      if (typeof r.content !== 'string' || !r.content.trim()) return null
      const supportIndexes = [...new Set(SUPPORT_KEYS.flatMap((k) => parseSupport(r[k])))]
      if (supportIndexes.length < 2) return null
      const out: Record<string, unknown> = { content: r.content, supportIndexes }
      if (typeof r.type === 'string' && DERIVATION_TYPES.has(r.type)) out.type = r.type
      return out
    })
    .filter((x): x is Record<string, unknown> => x !== null)

  return { inferences: cleaned }
}

const DERIVATION_SYSTEM_PROMPT = `You are the memory consolidation pass for an agent memory system. Given a digest of facts already extracted from a user's conversations, derive ONLY non-obvious inferences that are strongly supported by at least two stated facts.

Rules:
- An inference must NOT be a restatement or trivial paraphrase of any single fact.
- Good inferences: a stable pattern across separate statements, a preference revealed by multiple choices, a consequence connecting a project fact and a preference.
- Do NOT speculate, hedge, or extrapolate beyond what the facts directly support.
- Each inference must cite the index of every supporting fact (at least 2).
- Prefer fewer, stronger inferences — return an empty list when nothing qualifies.
- Write each inference as a single declarative sentence about the user, in the same style as the facts.`

export type ConsolidationOutcome = {
  sources: number
  proposed: number
  inserted: number
  duplicates: number
  /** Ids of inferred rows written — lets the runner wait for their index. */
  writtenIds: string[]
  /** First inserted inference text — index-readiness probe term. */
  probe?: string
  reason?: string
}

export async function consolidateUser(args: {
  userId: string
  caseId?: string
  maxSources?: number
  maxInferences?: number
}): Promise<ConsolidationOutcome> {
  const maxSources = args.maxSources ?? 200
  const maxInferences = args.maxInferences ?? 10

  const all = await listAllMemories({ userId: args.userId })
  const now = Date.now()
  const live = all
    .filter((m) => !m.deletedAt && !m.inferred && (!m.expiresAt || m.expiresAt > now))
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    .slice(0, maxSources)

  if (live.length < 2) {
    return { sources: live.length, proposed: 0, inserted: 0, duplicates: 0, writtenIds: [], reason: 'too_few_sources' }
  }

  const digest = live
    .map((m, i) => `[${i}] ${m.content}`)
    .join('\n')

  let derivation: Derivation
  try {
    derivation = await withRetry(
      () =>
        benchObject({
          modelId: config.extractorModel,
          schema: DerivationSchema,
          system: DERIVATION_SYSTEM_PROMPT,
          prompt: `Digest of stated memories:\n\n${digest}`,
          maxOutputTokens: 2000,
          normalize: normalizeDerivationJson,
        }),
      `consolidate:${args.caseId ?? args.userId}`,
    )
  } catch (err) {
    return {
      sources: live.length,
      proposed: 0,
      inserted: 0,
      duplicates: 0,
      writtenIds: [],
      reason: `error:${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}`,
    }
  }

  let inserted = 0
  let duplicates = 0
  const writtenIds: string[] = []
  let probe: string | undefined
  for (const inf of derivation.inferences.slice(0, maxInferences)) {
    const content = inf.content.trim()
    if (!content) continue
    const support = [...new Set(inf.supportIndexes)]
      .map((i) => live[i])
      .filter((m): m is BenchMemoryRow => m !== undefined)
    if (support.length < 2) continue

    // Same dedup gate as extraction: owner-scoped hybridSearch, auto-noop on
    // near-identical hits, LLM decision in the ambiguous band — with the
    // decision space restricted to noop/add for inferred candidates.
    let neighbors: Array<{ memoryId: string; content: string; score: number; vecScore?: number }> = []
    try {
      const chunks = await hybridSearch({
        userId: args.userId,
        query: content,
        sourceKind: 'memory',
        kVec: 3,
        kLex: 1,
        m: 3,
        minVecScore: DEDUP_MIN_VEC_SCORE,
      })
      const sourceIds = [...new Set(chunks.map((c) => c.sourceId))]
      if (sourceIds.length > 0) {
        const docs = await getMemoriesByIds({ userId: args.userId, memoryIds: sourceIds })
        const byId = new Map(docs.map((d) => [d._id, d.content]))
        const seen = new Set<string>()
        neighbors = chunks
          .filter((c) => byId.has(c.sourceId) && !seen.has(c.sourceId) && seen.add(c.sourceId))
          .map((c) => ({ memoryId: c.sourceId, content: byId.get(c.sourceId)!, score: c.score, vecScore: c.vecScore }))
      }
    } catch {
      // Dedup search failed — fall back to add.
    }

    const autoNoop = neighbors.find((n) => (n.vecScore ?? 0) >= DEDUP_AUTO_NOOP_VEC_SCORE)
    if (autoNoop) {
      await touchMemory({ userId: args.userId, memoryId: autoNoop.memoryId })
      duplicates++
      continue
    }

    if (neighbors.length > 0) {
      let decision: MemoryDedupDecision = { decision: 'add' }
      try {
        decision = await withRetry(
          () =>
            benchObject({
              modelId: config.extractorModel,
              schema: MemoryDedupDecisionSchema,
              system: MEMORY_DEDUP_DECISION_SYSTEM_PROMPT,
              prompt: buildMemoryDedupDecisionPrompt(content, neighbors.map((n) => ({ content: n.content }))),
              maxOutputTokens: 400,
              normalize: normalizeDedupJson,
            }),
          `consolidate-dedup:${args.caseId ?? args.userId}:${inserted + duplicates}`,
        )
      } catch {
        // Decision call failed — treat as add.
      }
      if (decision.decision === 'noop' || decision.decision === 'update' || decision.decision === 'supersede') {
        // An existing memory already covers this inference — corroborate it.
        const target = neighbors[Math.min(decision.targetIndex ?? 0, neighbors.length - 1)]!
        await touchMemory({ userId: args.userId, memoryId: target.memoryId })
        duplicates++
        continue
      }
    }

    const id = await addMemory({
      userId: args.userId,
      content,
      source: 'chat',
      type: inf.type,
      actor: 'user',
      conversationId: args.caseId,
      inferred: true,
      derivedFrom: support.map((m) => m._id),
    })
    writtenIds.push(id)
    probe = probe ?? content.slice(0, 80)
    inserted++
  }

  return { sources: live.length, proposed: derivation.inferences.length, inserted, duplicates, writtenIds, probe }
}
