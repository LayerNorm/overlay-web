import 'server-only'

import { MAX_KNOWLEDGE_BASES_PER_TURN } from '@overlay/app-core'
import type { HybridSearchChunk } from '@/shared/knowledge/hybrid-search'
import {
  findPassageHighlights,
  type PassageHighlight,
} from '@/shared/knowledge/passage-highlight'
import { KnowledgeSearchService } from '@/server/knowledge/KnowledgeSearchService'
import { KnowledgeBaseService } from './KnowledgeBaseService'

export type KnowledgeBaseCitationPassage = {
  chunkIndex: number
  /** Offset of the passage within the full extracted source text, when known. */
  startOffset?: number
  text: string
  /** Spans inside `text` that matched the query, for UI highlighting. */
  highlights: PassageHighlight[]
}

export type KnowledgeBaseCitation = {
  knowledgeBaseId: string
  knowledgeBaseTitle: string
  sourceId: string
  sourceVersionId?: string
  title: string
  /** Every retrieved passage from this source, in rank order. */
  passages: KnowledgeBaseCitationPassage[]
}

export type KnowledgeBaseSearchResult = {
  chunks: HybridSearchChunk[]
  citations: KnowledgeBaseCitation[]
  /**
   * Bases that were requested but contributed nothing because they are missing,
   * archived, or not readable by this user. Deliberately does not distinguish
   * between those cases, so callers cannot probe for existence.
   */
  skippedKnowledgeBaseIds: string[]
}

/** Over-fetch factor so fair per-base selection has candidates to choose from. */
const CANDIDATE_MULTIPLIER = 3
const MAX_CANDIDATES = 120

type ResolvedBase = {
  id: string
  title: string
  sources: Array<{ id: string; title: string }>
}

export class KnowledgeBaseRetrievalService {
  constructor(private readonly deps: {
    bases: KnowledgeBaseService
    search: KnowledgeSearchService
  }) {}

  /**
   * Retrieves passages from the given knowledge bases and nothing else.
   *
   * The scope is a hard boundary: every base is re-authorized here, and only
   * enabled memberships pointing at `ready` sources can enter the corpus. When
   * no authorized source survives, this returns empty rather than falling back
   * to the user's general index.
   */
  async search(args: {
    accessToken?: string
    /** Metered search: the caller's billing context is passed through. */
    billing: {
      idempotencyKey: string
      operationId: string
      requestFingerprint: string
    }
    /** Force coverage across sources; inferred from the query when omitted. */
    breadthFirst?: boolean
    knowledgeBaseIds: string[]
    limit?: number
    query: string
    userId: string
  }): Promise<KnowledgeBaseSearchResult> {
    const requested = dedupe(args.knowledgeBaseIds).slice(0, MAX_KNOWLEDGE_BASES_PER_TURN)
    if (requested.length === 0) return emptyResult([])

    const resolved: ResolvedBase[] = []
    const skippedKnowledgeBaseIds: string[] = []
    for (const knowledgeBaseId of requested) {
      const base = await this.resolveBase({ knowledgeBaseId, userId: args.userId })
      if (!base) {
        skippedKnowledgeBaseIds.push(knowledgeBaseId)
        continue
      }
      resolved.push(base)
    }

    // Attribute each source to the first requested base that legitimately holds
    // it, so a source shared across bases yields one stable citation.
    const attribution = new Map<string, { base: ResolvedBase; title: string }>()
    for (const base of resolved) {
      for (const source of base.sources) {
        if (!attribution.has(source.id)) attribution.set(source.id, { base, title: source.title })
      }
    }
    const canonicalSourceIds = [...attribution.keys()]
    if (canonicalSourceIds.length === 0) return emptyResult(skippedKnowledgeBaseIds)

    const limit = clamp(args.limit ?? 12, 1, 50)
    const result = await this.deps.search.hybridSearch({
      accessToken: args.accessToken,
      billing: args.billing,
      canonicalSourceIds,
      m: Math.min(MAX_CANDIDATES, limit * CANDIDATE_MULTIPLIER),
      query: args.query,
      userId: args.userId,
    })

    const selected = selectFairly({
      attribution,
      candidates: result.chunks,
      limit,
      breadthFirst: args.breadthFirst ?? isCorpusWideQuestion(args.query),
    })
    return {
      chunks: selected,
      citations: buildCitations({ attribution, chunks: selected, query: args.query }),
      skippedKnowledgeBaseIds,
    }
  }

  /** Returns null when the base is unreadable, missing, or has no usable source. */
  private async resolveBase(args: {
    knowledgeBaseId: string
    userId: string
  }): Promise<ResolvedBase | null> {
    try {
      const base = await this.deps.bases.getKnowledgeBase(args)
      const details = await this.deps.bases.listSources(args)
      const sources = details
        .filter(({ membership, source }) => membership.enabled && source.status === 'ready')
        .map(({ source }) => ({ id: source.id, title: source.title }))
      return { id: base.id, title: base.title, sources }
    } catch (_error) {
      // Denials surface as not-found from KnowledgeBaseService; either way this
      // base simply does not contribute.
      return null
    }
  }
}

/**
 * Round-robins across bases so a large corpus cannot crowd out a small one,
 * while preserving score order within each base. Chunks whose normalized text
 * already appeared are dropped, which collapses duplicate documents that live
 * in more than one base.
 */
function selectFairly(args: {
  attribution: Map<string, { base: ResolvedBase; title: string }>
  candidates: HybridSearchChunk[]
  limit: number
  /**
   * When true, round-robin by *source* rather than by base, so every document
   * contributes before any single one contributes twice. Broad questions ("take
   * me through this") need coverage across the corpus; narrow factual questions
   * are better served by depth on the best-matching source.
   */
  breadthFirst?: boolean
}): HybridSearchChunk[] {
  const groups = new Map<string, HybridSearchChunk[]>()
  for (const chunk of args.candidates) {
    const owner = chunk.knowledgeSourceId
      ? args.attribution.get(chunk.knowledgeSourceId)
      : undefined
    if (!owner) continue
    const key = args.breadthFirst
      ? `${owner.base.id}:${chunk.knowledgeSourceId}`
      : owner.base.id
    const bucket = groups.get(key)
    if (bucket) bucket.push(chunk)
    else groups.set(key, [chunk])
  }
  for (const bucket of groups.values()) bucket.sort((a, b) => b.score - a.score)

  const seenText = new Set<string>()
  const selected: HybridSearchChunk[] = []
  const cursors = new Map<string, number>()
  let exhausted = false
  while (selected.length < args.limit && !exhausted) {
    exhausted = true
    for (const [key, bucket] of groups) {
      if (selected.length >= args.limit) break
      let cursor = cursors.get(key) ?? 0
      while (cursor < bucket.length) {
        const chunk = bucket[cursor]!
        cursor += 1
        const fingerprint = normalizeText(chunk.text)
        if (seenText.has(fingerprint)) continue
        seenText.add(fingerprint)
        selected.push(chunk)
        exhausted = false
        break
      }
      cursors.set(key, cursor)
    }
  }
  return selected
}

function buildCitations(args: {
  attribution: Map<string, { base: ResolvedBase; title: string }>
  chunks: HybridSearchChunk[]
  query: string
}): KnowledgeBaseCitation[] {
  const citations = new Map<string, KnowledgeBaseCitation>()
  for (const chunk of args.chunks) {
    const canonicalId = chunk.knowledgeSourceId
    if (!canonicalId) continue
    const owner = args.attribution.get(canonicalId)
    if (!owner) continue
    const key = `${owner.base.id}:${canonicalId}`
    const passage: KnowledgeBaseCitationPassage = {
      chunkIndex: chunk.chunkIndex,
      startOffset: chunk.startOffset,
      text: chunk.text,
      highlights: findPassageHighlights(chunk.text, args.query),
    }
    const existing = citations.get(key)
    if (existing) {
      // Several passages of one source keep one citation entry.
      existing.passages.push(passage)
      continue
    }
    citations.set(key, {
      knowledgeBaseId: owner.base.id,
      knowledgeBaseTitle: owner.base.title,
      sourceId: canonicalId,
      sourceVersionId: chunk.knowledgeSourceVersionId,
      title: chunk.title?.trim() || owner.title || 'Knowledge source',
      passages: [passage],
    })
  }
  return [...citations.values()]
}

function emptyResult(skippedKnowledgeBaseIds: string[]): KnowledgeBaseSearchResult {
  return { chunks: [], citations: [], skippedKnowledgeBaseIds }
}

/**
 * Recognizes questions about the corpus as a whole rather than a fact inside it,
 * such as "what is in this", "take me through it", or "summarize everything".
 *
 * These deserve coverage across every source. Ranking them by similarity to the
 * question is close to meaningless, since the question contains no subject
 * matter to match against.
 */
export function isCorpusWideQuestion(query: string): boolean {
  const text = query.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!text) return false
  const patterns = [
    /\bwhat(?:'s| is| are)?\s+(?:in|inside|within)\b/,
    /\bwhat\s+does\s+(?:this|it|that)\s+(?:contain|cover|include|have)\b/,
    /\b(?:take|walk|run)\s+(?:me\s+)?through\b/,
    /\bgive\s+me\s+(?:an\s+)?(?:overview|rundown|tour|walkthrough)\b/,
    /\b(?:overview|rundown|walkthrough|table of contents|contents|manifest|inventory)\b/,
    /\bsummar(?:ise|ize|y)\b.*\b(?:all|everything|whole|entire|each)\b/,
    /\b(?:all|everything|each)\s+(?:the\s+)?(?:sources?|documents?|files?|material)\b/,
    /\bhow many\s+(?:sources?|documents?|files?)\b/,
    /\blist\s+(?:the\s+)?(?:sources?|documents?|files?|contents?)\b/,
  ]
  return patterns.some((pattern) => pattern.test(text))
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}
