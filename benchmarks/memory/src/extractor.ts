import {
  AGENT_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  buildMemoryDedupDecisionPrompt,
  buildMemoryExtractionPrompt,
  DEDUP_AUTO_NOOP_VEC_SCORE,
  DEDUP_MIN_VEC_SCORE,
  filterExtractionCandidates,
  HUMAN_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  isExtractableTargetText,
  MAX_CANDIDATES_PER_MESSAGE,
  MEMORY_DEDUP_DECISION_SYSTEM_PROMPT,
  MemoryDedupDecisionSchema,
  MemoryExtractionSchema,
  parseMemoryDate,
  type MemoryDedupDecision,
  type MemoryExtractionResult,
  type MemoryExtractionTargetActor,
} from '../../../src/shared/knowledge/memory-extraction-shared'
import { addMemory, getMemoriesByIds, hybridSearch, supersedeMemory, touchMemory, updateMemory } from './convex-client'
import { config } from './config'
import { benchObject, withRetry } from './gateway'

/**
 * Faithful replica of convex/knowledge/memoryExtractorNode.ts extractFromTurn.
 * The Convex version is an internalAction and cannot be invoked externally, so
 * the harness runs the identical prompt/schema/filters itself and writes
 * through the same public `memories:add` mutation (real dedup + reindex path).
 */

export type BenchTurn = {
  /** Unique id for this message within the case (dia_id / step id). */
  turnId: string
  role: 'user' | 'assistant' | 'speaker'
  /** Display name when the corpus has named speakers (LoCoMo). */
  speaker?: string
  text: string
  /** ISO date or unix ms — prepended into the text the extractor sees. */
  timestamp?: string
}

export type ExtractionOutcome = {
  extracted: number
  inserted: number
  duplicates: number
  updated: number
  superseded: number
  /** memoryIds written for this turn — enables turnId→memory recall checks. */
  writtenIds: string[]
  reason?: string
}

export async function extractAndStore(args: {
  userId: string
  caseId: string
  target: BenchTurn
  context: BenchTurn[]
  targetActor?: MemoryExtractionTargetActor
}): Promise<ExtractionOutcome> {
  const targetActor = args.targetActor ?? 'human'
  const targetText = formatTargetText(args.target)
  const extractable = isExtractableTargetText(targetText)
  if (extractable !== 'ok') {
    return { extracted: 0, inserted: 0, duplicates: 0, updated: 0, superseded: 0, writtenIds: [], reason: extractable }
  }

  const contextMessages = args.context
    .filter((m) => m.turnId !== args.target.turnId)
    .slice(-8)
    .map((m) => ({ role: m.speaker ?? m.role, text: formatTargetText(m).slice(0, 800) }))

  const prompt = buildMemoryExtractionPrompt(targetText, contextMessages, targetActor)
  const system =
    targetActor === 'agent'
      ? AGENT_MEMORY_EXTRACTION_SYSTEM_PROMPT
      : HUMAN_MEMORY_EXTRACTION_SYSTEM_PROMPT

  let object: MemoryExtractionResult
  try {
    object = await withRetry(
      () =>
        benchObject({
          modelId: config.extractorModel,
          schema: MemoryExtractionSchema,
          system,
          prompt,
          maxOutputTokens: 1200,
        }),
      `extract:${args.target.turnId}`,
    )
  } catch (err) {
    return {
      extracted: 0,
      inserted: 0,
      duplicates: 0,
      updated: 0,
      superseded: 0,
      writtenIds: [],
      reason: `error:${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}`,
    }
  }

  const candidates = filterExtractionCandidates(object.candidates)
  let inserted = 0
  let duplicates = 0
  let updated = 0
  let superseded = 0
  const writtenIds: string[] = []
  const actor = targetActor === 'agent' ? 'agent' : 'user'
  for (const candidate of candidates.slice(0, MAX_CANDIDATES_PER_MESSAGE)) {
    const content = candidate.content.trim()
    const expiresAt = parseMemoryDate(candidate.expiresOn)
    const eventAt = parseMemoryDate(candidate.eventAt)

    // Semantic dedup — same flow as extractFromTurn: owner-scoped hybridSearch
    // (no workspaceId), auto-noop on near-identical hits, LLM decision in the
    // ambiguous band. Bench rows carry no workspaceId, so the workspace match
    // is trivially satisfied.
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
      // Dedup search failed — fall back to add (pre-M1 behavior).
    }

    if (neighbors.length === 0) {
      const id = await addMemory({
        userId: args.userId,
        content,
        source: 'chat',
        type: candidate.type,
        actor,
        conversationId: args.caseId,
        turnId: args.target.turnId,
        expiresAt,
        eventAt,
      })
      writtenIds.push(id)
      inserted++
      continue
    }

    // chunk.score is RRF-fused; auto-noop needs the raw vector score.
    const autoNoop = neighbors.find((n) => (n.vecScore ?? 0) >= DEDUP_AUTO_NOOP_VEC_SCORE)
    if (autoNoop) {
      await touchMemory({ userId: args.userId, memoryId: autoNoop.memoryId })
      duplicates++
      continue
    }

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
          }),
        `dedupe:${args.target.turnId}`,
      )
    } catch {
      // Decision call failed — treat as add (pre-M1 behavior).
    }
    const target = neighbors[Math.min(decision.targetIndex ?? 0, neighbors.length - 1)]!

    switch (decision.decision) {
      case 'noop':
        await touchMemory({ userId: args.userId, memoryId: target.memoryId })
        duplicates++
        break
      case 'update':
        await updateMemory({
          userId: args.userId,
          memoryId: target.memoryId,
          content: (decision.mergedContent ?? content).trim(),
          type: candidate.type,
          expiresAt,
          eventAt,
        })
        writtenIds.push(target.memoryId)
        updated++
        break
      case 'supersede': {
        const id = await supersedeMemory({
          userId: args.userId,
          memoryId: target.memoryId,
          content: (decision.mergedContent ?? content).trim(),
          source: 'chat',
          type: candidate.type,
          actor,
          conversationId: args.caseId,
          turnId: args.target.turnId,
          expiresAt,
          eventAt,
        })
        writtenIds.push(id)
        superseded++
        break
      }
      default: {
        const id = await addMemory({
          userId: args.userId,
          content,
          source: 'chat',
          type: candidate.type,
          actor,
          conversationId: args.caseId,
          turnId: args.target.turnId,
          expiresAt,
          eventAt,
        })
        writtenIds.push(id)
        inserted++
      }
    }
  }
  return { extracted: candidates.length, inserted, duplicates, updated, superseded, writtenIds }
}

function formatTargetText(turn: BenchTurn): string {
  const date = formatDate(turn.timestamp)
  const who = turn.speaker ? `${turn.speaker}: ` : ''
  return `${date ? `[${date}] ` : ''}${who}${turn.text}`
}

export function formatDate(timestamp?: string): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return timestamp.slice(0, 10)
  return d.toISOString().slice(0, 10)
}
