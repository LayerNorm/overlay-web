import { formatAutoRetrievalBundle } from '../../../src/shared/knowledge/auto-retrieval-format'
import type { HybridSearchChunk } from '../../../src/shared/knowledge/hybrid-search'
import { hybridSearch, type HybridChunk } from './convex-client'
import { config } from './config'
import { benchObject } from './gateway'
import { z } from 'zod'

/**
 * Retrieval exactly as a chat turn sees it: real hybridSearch over memory +
 * raw message chunks, formatted with the same AUTO_RETRIEVED_KNOWLEDGE block
 * builder the Act prompt uses. `includeMessages` toggles the M2 evidence layer
 * for pre/post comparison.
 *
 * `questionDate` anchors relative date expressions ("last week") for the
 * temporal retrieval list — the benchmark's asked-on date, or now in prod.
 *
 * BENCH_QUERY_EXPANSION=1 rewrites the question into ≤3 alternates and unions
 * their hits — most of the agentic loop's recall gain at a fraction of its
 * latency.
 */

const expansionSchema = z.object({
  alternates: z.array(z.string()).max(3).optional(),
  queries: z.array(z.string()).max(3).optional(),
})

/** Accept the first array-of-strings under any key — free models rename it. */
const normalizeExpansionJson = (json: unknown): unknown => {
  if (!json || typeof json !== 'object') return json
  const rec = json as Record<string, unknown>
  if (Array.isArray(rec.alternates) || Array.isArray(rec.queries)) return json
  const found = Object.values(rec).find((v) => Array.isArray(v) && v.every((s) => typeof s === 'string'))
  return found ? { alternates: found } : json
}

async function expandQueries(question: string, questionDate?: string): Promise<string[]> {
  try {
    const raw = await benchObject({
      modelId: config.extractorModel,
      schema: expansionSchema,
      system:
        'Rewrite a memory-retrieval query into up to 3 alternate phrasings ' +
        'that could surface different evidence — different entities, synonyms, ' +
        'or facets. Do not answer the question. Return {"alternates": [...]}.',
      prompt: `Question${questionDate ? ` (asked on ${questionDate})` : ''}: ${question}`,
      maxOutputTokens: 200,
      normalize: normalizeExpansionJson,
    })
    const alts = [...(raw.alternates ?? []), ...(raw.queries ?? [])]
      .map((s) => s.trim())
      .filter((s) => s.length > 3 && s.toLowerCase() !== question.trim().toLowerCase())
    return [...new Set(alts)].slice(0, 3)
  } catch {
    return []
  }
}

export async function retrieveMemoryContext(args: {
  userId: string
  query: string
  questionDate?: string
}): Promise<{ extension: string; chunks: HybridSearchChunk[] }> {
  const asOfMs = args.questionDate ? Date.parse(args.questionDate) : undefined
  const kinds = config.includeMessages
    ? ({ sourceKinds: ['memory', 'message'] as Array<'file' | 'memory' | 'message'> })
    : ({ sourceKind: 'memory' as const })
  const shared = {
    kVec: config.retrieval.kVec,
    kLex: config.retrieval.kLex,
    m: config.retrieval.m,
    applyRecencyDecay: config.retrieval.applyRecencyDecay,
    temporalQuery: config.retrieval.temporalQuery,
    includeProvenance: config.retrieval.includeProvenance,
    ...(asOfMs !== undefined && !Number.isNaN(asOfMs) ? { asOfMs } : {}),
    ...(config.retrieval.minVecScore !== undefined ? { minVecScore: config.retrieval.minVecScore } : {}),
  }

  const queries = config.queryExpansion
    ? [args.query, ...(await expandQueries(args.query, args.questionDate))]
    : [args.query]

  const perQuery = await Promise.all(
    queries.map((query) => hybridSearch({ userId: args.userId, query, ...kinds, ...shared })),
  )
  // Union across phrasings — a chunk keeps its best score regardless of which
  // phrasing surfaced it, then the bundle cap applies as usual.
  const byKey = new Map<string, HybridChunk>()
  for (const chunks of perQuery) {
    for (const c of chunks) {
      const key = `${c.sourceKind}:${c.sourceId}:${c.chunkIndex}`
      const prev = byKey.get(key)
      if (!prev || c.score > prev.score) byKey.set(key, c)
    }
  }
  const chunks = [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, config.retrieval.m)
  const bundle = formatAutoRetrievalBundle(chunks)
  return { extension: bundle.extension, chunks }
}
