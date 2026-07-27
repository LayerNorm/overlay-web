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
      canonicalSourceIds,
      m: Math.min(MAX_CANDIDATES, limit * CANDIDATE_MULTIPLIER),
      query: args.query,
      userId: args.userId,
    })

    const selected = selectFairly({
      attribution,
      candidates: result.chunks,
      limit,
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
}): HybridSearchChunk[] {
  const byBase = new Map<string, HybridSearchChunk[]>()
  for (const chunk of args.candidates) {
    const owner = chunk.knowledgeSourceId
      ? args.attribution.get(chunk.knowledgeSourceId)
      : undefined
    if (!owner) continue
    const bucket = byBase.get(owner.base.id)
    if (bucket) bucket.push(chunk)
    else byBase.set(owner.base.id, [chunk])
  }
  for (const bucket of byBase.values()) bucket.sort((a, b) => b.score - a.score)

  const seenText = new Set<string>()
  const selected: HybridSearchChunk[] = []
  const cursors = new Map<string, number>()
  let exhausted = false
  while (selected.length < args.limit && !exhausted) {
    exhausted = true
    for (const [baseId, bucket] of byBase) {
      if (selected.length >= args.limit) break
      let cursor = cursors.get(baseId) ?? 0
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
      cursors.set(baseId, cursor)
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
