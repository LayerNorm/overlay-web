import { z } from 'zod'
import { formatAutoRetrievalBundle } from '../../../src/shared/knowledge/auto-retrieval-format'
import { plainTextSnippet } from '@overlay/chat-core/sources'
import { answerQuestion } from './answer'
import { config } from './config'
import { hybridSearch, type HybridChunk } from './convex-client'
import { benchObject } from './gateway'
import { retrieveMemoryContext } from './retrieve'

/**
 * Agentic answer mode (M4): the same prefetch passive mode starts with, then a
 * bounded reformulate → search loop where the model picks the surface
 * (search_memory | search_messages) and query, then a synthesis step that runs
 * the identical fixed answering prompt over the accumulated evidence.
 *
 * The loop is the only protocol delta — same seed retrieval, same answer
 * prompt, same judge — so agentic-vs-passive isolates retrieval depth. This is
 * the shape multi-step memory systems (Honcho et al.) actually measure.
 */

export type AgenticSearchStep = {
  tool: 'prefetch' | 'search_memory' | 'search_messages' | 'search_all'
  query: string
  hits: number
  newHits: number
}

type Decision = {
  action: 'search_memory' | 'search_messages' | 'search_all' | 'answer'
  query?: string
}

/**
 * Free-tier models drift on field names (`command`/`tool`/`next` for the
 * action, `search_query`/`q` for the query, or an inline `answer`). Parse a
 * loose superset and normalize — strict schemas turn that drift into
 * unparseable-object failures.
 */
const rawDecisionSchema = z
  .object({
    action: z.unknown().optional(),
    command: z.unknown().optional(),
    tool: z.unknown().optional(),
    next: z.unknown().optional(),
    next_step: z.unknown().optional(),
    decision: z.unknown().optional(),
    choice: z.unknown().optional(),
    search: z.unknown().optional(),
    query: z.unknown().optional(),
    search_query: z.unknown().optional(),
    q: z.unknown().optional(),
    answer: z.unknown().optional(),
    final_answer: z.unknown().optional(),
    response: z.unknown().optional(),
  })
  .passthrough()

function text(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function normalizeDecision(raw: z.infer<typeof rawDecisionSchema>): Decision {
  const actionRaw = text(
    raw.action ?? raw.command ?? raw.tool ?? raw.next ?? raw.next_step ?? raw.decision ?? raw.choice ?? raw.search,
  ).toLowerCase()
  const query = text(raw.query ?? raw.search_query ?? raw.q).trim()
  const inlineAnswer = raw.answer ?? raw.final_answer ?? raw.response
  const wantsSearch = /search|find|look/.test(actionRaw)
  // Any inline answer — string or bare `true` — means terminal, unless the
  // action itself says search.
  if (inlineAnswer !== undefined && inlineAnswer !== null && inlineAnswer !== '' && !wantsSearch) {
    return { action: 'answer' }
  }
  if (/messag|transcript|verbatim|conversation|said/.test(actionRaw)) {
    return query ? { action: 'search_messages', query } : { action: 'answer' }
  }
  if (/all|both|every|mixed/.test(actionRaw)) {
    return query ? { action: 'search_all', query } : { action: 'answer' }
  }
  if (/memor|fact|recall|search/.test(actionRaw)) {
    return query ? { action: 'search_memory', query } : { action: 'answer' }
  }
  return { action: 'answer' }
}

/** Injectable seams — the benchmark wires the real ones; tests count calls. */
export type AgenticDeps = {
  retrieve: typeof retrieveMemoryContext
  search: typeof hybridSearch
  decide: (prompt: string, roundsLeft: number) => Promise<Decision>
  synthesize: typeof answerQuestion
  maxRounds: number
}

const DECISION_SYSTEM = [
  'You are the retrieval planner for a personal-assistant memory system.',
  'You choose the next retrieval step; you never answer the question yourself.',
  'Prefer one precise query over broad ones, and reformulate based on what evidence is still missing — for multi-part questions, search for the missing piece rather than repeating the whole question.',
  'Choose "answer" when the evidence covers the question or another search would only repeat earlier ones. Never include the answer text itself — only the next step and, for searches, the query.',
].join(' ')

/**
 * Round 0 is a mandatory reformulation: the prefetch already ran the literal
 * question, so the planner's job is to find what it *missed*. The multi-step
 * shape being measured (Honcho's dialectic et al.) does not offer a
 * skip-everything option — an immediate-answer choice degenerates the run
 * into passive mode and measures nothing.
 */

function chunkKey(c: HybridChunk): string {
  return `${c.sourceKind}:${c.sourceId}:${c.chunkIndex}`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function buildDecisionPrompt(args: {
  question: string
  questionDate?: string
  evidence: HybridChunk[]
  searches: AgenticSearchStep[]
  roundsLeft: number
  mustSearch: boolean
}): string {
  // Compact digest — titles carry date/speaker for message chunks. Capped so
  // the planner stays cheap even when the evidence pool is deep.
  const digest = args.evidence
    .slice(0, 30)
    .map((c, i) => `[${i + 1}] (${c.sourceKind}${c.title ? ` · ${c.title}` : ''}) ${truncate(plainTextSnippet(c.text), 280)}`)
    .join('\n')
  const history = args.searches
    .map((s) => `- ${s.tool}: "${s.query}" → ${s.hits} hits (${s.newHits} new)`)
    .join('\n')
  return [
    `Question${args.questionDate ? ` (asked on ${args.questionDate})` : ''}: ${args.question}`,
    '',
    'Evidence gathered so far:',
    digest || '(none yet)',
    '',
    'Searches already run:',
    history,
    '',
    args.mustSearch
      ? 'The prefetch above already ran the literal question. Issue exactly one search now for whatever it missed — the best query targets a different facet (a related entity, a date, an event detail), not a rephrase:'
      : `You may run up to ${args.roundsLeft} more search(es). Choose one:`,
    '- search_memory: distilled facts and preferences saved about the user',
    '- search_messages: verbatim conversation excerpts — exact wording, dates, speakers',
    '- search_all: both surfaces at once, for a reformulated query that could hit either',
    ...(args.mustSearch
      ? []
      : ['- answer: evidence is sufficient, or further searching is unlikely to help']),
  ].join('\n')
}

async function decideViaModel(prompt: string): Promise<Decision> {
  const raw = await benchObject({
    modelId: config.answerModel,
    schema: rawDecisionSchema,
    system: DECISION_SYSTEM,
    prompt,
    maxOutputTokens: 300,
  })
  return normalizeDecision(raw)
}

function realDeps(): AgenticDeps {
  return {
    retrieve: retrieveMemoryContext,
    search: hybridSearch,
    decide: decideViaModel,
    synthesize: answerQuestion,
    maxRounds: config.maxSearchRounds,
  }
}

export async function answerQuestionAgentic(
  args: {
    userId: string
    question: string
    questionDate?: string
  },
  deps?: Partial<AgenticDeps>,
): Promise<{
  answer: string
  chunks: HybridChunk[]
  searches: AgenticSearchStep[]
  searchMs: number
  answerMs: number
}> {
  const d: AgenticDeps = { ...realDeps(), ...deps }
  // Round 0 is the identical prefetch passive mode performs — the loop below
  // is the delta being measured, not a different starting point.
  const t0 = Date.now()
  const seed = await d.retrieve({ userId: args.userId, query: args.question })
  const seen = new Set(seed.chunks.map(chunkKey))
  const evidence: HybridChunk[] = [...seed.chunks]
  const searches: AgenticSearchStep[] = [
    { tool: 'prefetch', query: args.question, hits: seed.chunks.length, newHits: seed.chunks.length },
  ]

  for (let round = 0; round < d.maxRounds; round++) {
    const mustSearch = round === 0
    // A planner failure must not sink the question — degrade to 'answer' (the
    // round-0 coercion below still turns it into the mandatory search).
    const decision = await d
      .decide(
        buildDecisionPrompt({
          question: args.question,
          questionDate: args.questionDate,
          evidence,
          searches,
          roundsLeft: d.maxRounds - round,
          mustSearch,
        }),
        d.maxRounds - round,
      )
      .catch((): Decision => ({ action: 'answer' }))
    // Round 0 always searches — an 'answer' verdict there degenerates the run
    // into passive mode. A missing query falls back to the literal question on
    // the verbatim surface, where marginal evidence lives after a mixed
    // prefetch.
    const action =
      mustSearch && decision.action === 'answer'
        ? ('search_messages' as const)
        : decision.action
    if (action === 'answer') break
    const query = (decision.query?.trim() || (mustSearch ? args.question : '')).trim()
    if (!query) break
    // Singular sourceKind validates against pre-M2 and M2 deployments alike;
    // search_all needs the M2 plural arg, so degrade to memory-only without it.
    const scope =
      action === 'search_all' && config.includeMessages
        ? { sourceKinds: ['memory', 'message'] as Array<'memory' | 'message'> }
        : { sourceKind: (action === 'search_messages' ? 'message' : 'memory') as 'memory' | 'message' }
    const chunks = await d.search({
      userId: args.userId,
      query,
      ...scope,
      m: config.retrieval.m,
    })
    const fresh = chunks.filter((c) => !seen.has(chunkKey(c)))
    for (const c of fresh) {
      seen.add(chunkKey(c))
      evidence.push(c)
    }
    searches.push({ tool: action, query, hits: chunks.length, newHits: fresh.length })
  }
  const searchMs = Date.now() - t0

  // Synthesis reuses the fixed answering prompt verbatim — only the evidence
  // pool changed. Score-sorted so the bundle's char budget keeps the best
  // chunks regardless of which round surfaced them.
  const t1 = Date.now()
  const ranked = [...evidence].sort((a, b) => b.score - a.score)
  const { extension } = formatAutoRetrievalBundle(ranked)
  const answer = await d.synthesize({
    question: args.question,
    memoryContext: extension,
    questionDate: args.questionDate,
  })
  return { answer, chunks: ranked, searches, searchMs, answerMs: Date.now() - t1 }
}
