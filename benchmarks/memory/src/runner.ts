import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { answerQuestionAgentic, type AgenticSearchStep } from './agentic'
import { answerQuestion } from './answer'
import { Checkpoint } from './checkpoint'
import { assertBenchConfig, benchUserId, config, fingerprint } from './config'
import { addMemory, hybridSearch, indexMessage, listMemories, purgeBenchUser, purgeMessageSource, sweepOrphanedChunks } from './convex-client'
import { assertFreePricing } from './gateway'
import { consolidateUser } from './consolidator'
import { extractAndStore, formatDate } from './extractor'
import { judgeAnswer, judgeLongMemEval, type Verdict } from './judge'
import { retrieveMemoryContext } from './retrieve'
import type { BenchCase, BenchDataset, BenchQuestion } from './datasets/types'
import { loadConvomem } from './datasets/convomem'
import { loadLocomo } from './datasets/locomo'
import { loadLongMemEval } from './datasets/longmemeval'

/**
 * Benchmark runner.
 *
 *   npx tsx benchmarks/memory/src/runner.ts <locomo|convomem|longmemeval>
 *       [--limit-cases N] [--limit-questions N] [--max-messages N]
 *       [--run-id ID] [--keep] [--bulk-only] [--case-concurrency N]
 *       [--categories a,b,c]
 *
 * Per case: synthetic bench owner → real extraction over the corpus (or
 * bulk-ingest transcript blocks) → wait for indexing → per question: real
 * hybridSearch → fixed answer prompt → judge → checkpoint. Cases get their
 * own owner ids and are purged at the end unless --keep. Resume-safe:
 * completed case/question rows are skipped.
 */

type QaRow = {
  id: string
  caseId: string
  category: string
  verdict: Verdict
  question: string
  goldAnswer: string
  modelAnswer: string
  judgeRaw: string
  retrievedChunkCount: number
  evidenceRecalled: boolean | null
  /** Agentic mode: the search trace (prefetch + each reformulation). */
  searches?: AgenticSearchStep[]
  /** Agentic mode: false when the sufficiency gate forced the abstention. */
  sufficient?: boolean
  latencyMs: { retrieve: number; answer: number; judge: number }
  truncated: boolean
}
type IngestRow = {
  id: string
  messages: number
  bulkMessages: number
  extractionCalls: number
  memoriesWritten: number
  dedupNoops: number
  dedupUpdated: number
  dedupSuperseded: number
  memoryCountAfter: number
  indexWaitMs: number
  indexed: boolean
  durationMs: number
  /** turnId → memoryIds written from it — survives the 100-row list cap. */
  turnMemory?: Record<string, string[]>
}

type Opts = {
  dataset: string
  limitCases?: number
  limitQuestions?: number
  maxMessages?: number
  runId: string
  keep: boolean
  bulkOnly: boolean
  caseConcurrency: number
  /** QA only these categories; cases with no matching question are skipped entirely (no ingest). */
  categories?: Set<string>
}

function parseArgs(): Opts {
  const argv = process.argv.slice(2)
  const dataset = argv[0]
  if (!dataset || !['locomo', 'convomem', 'longmemeval'].includes(dataset)) {
    console.log('usage: runner.ts <locomo|convomem|longmemeval> [options]')
    process.exit(1)
  }
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const num = (name: string): number | undefined => (opt(name) !== undefined ? Number(opt(name)) : undefined)
  return {
    dataset,
    limitCases: num('limit-cases'),
    limitQuestions: num('limit-questions'),
    maxMessages: num('max-messages'),
    runId: opt('run-id') ?? `pre-m1-${new Date().toISOString().slice(0, 10)}`,
    keep: argv.includes('--keep'),
    bulkOnly: argv.includes('--bulk-only'),
    caseConcurrency: num('case-concurrency') ?? Number(process.env.BENCH_CASE_CONCURRENCY ?? 2),
    categories: opt('categories')
      ? new Set(opt('categories')!.split(',').map((s) => s.trim()).filter(Boolean))
      : undefined,
  }
}

async function loadDataset(which: string, limitCases?: number): Promise<BenchDataset> {
  if (which === 'locomo') return loadLocomo(limitCases)
  if (which === 'convomem') return loadConvomem({ itemsPerCategory: limitCases })
  return await loadLongMemEval({ limitCases })
}

/** Poll hybridSearch until a probe term hits — reindex is scheduled async. */
async function waitForIndex(userId: string, probe: string, timeoutMs = 600_000): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const chunks = await hybridSearch({ userId, query: probe, m: 3 })
      if (chunks.length > 0) return Date.now() - start
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/budget_exhausted|Unauthorized/i.test(msg)) throw err
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  return -1
}

async function ingestCase(
  benchCase: BenchCase,
  userId: string,
  opts: { bulkOnly: boolean; maxMessages?: number },
): Promise<Omit<IngestRow, 'id'>> {
  const start = Date.now()
  let extractionCalls = 0
  let memoriesWritten = 0
  let dedupNoops = 0
  let dedupUpdated = 0
  let dedupSuperseded = 0
  const turnMemory: Record<string, string[]> = {}
  const messages = opts.maxMessages ? benchCase.messages.slice(0, opts.maxMessages) : benchCase.messages
  // Purge+re-ingest writes identical sourceId+text, which would hit the stale
  // budget reservation and skip re-indexing. A per-ingest nonce keeps each
  // ingest's reservations distinct so re-ingests always re-embed.
  const indexNonce = fingerprint('ingest', benchCase.caseId, start.toString()).slice(0, 16)

  if (!opts.bulkOnly) {
    // Extraction calls are independent — context is deterministic (prior 8
    // turns), so we can run them with bounded concurrency inside a case.
    const conc = Math.max(1, Number(process.env.BENCH_EXTRACT_CONCURRENCY ?? 5))
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(conc, messages.length) }, async () => {
        while (cursor < messages.length) {
          const idx = cursor++
          const turn = messages[idx]!
          const ctxSlice = messages.slice(Math.max(0, idx - 8), idx)
          try {
            // M2: index the raw turn verbatim (production does this at
            // save/finalize time) alongside extraction. Skipped on pre-M2 runs.
            if (config.includeMessages) {
              await indexMessage({
                userId,
                sourceId: `${benchCase.caseId}:msg:${idx}`,
                text: turn.text.slice(0, 4000),
                speaker: turn.speaker,
                createdAt: turn.timestamp ? new Date(turn.timestamp).getTime() : undefined,
                conversationId: benchCase.caseId,
                turnId: turn.turnId,
                reservationNonce: indexNonce,
              }).catch(() => false)
            }
            const outcome = await extractAndStore({ userId, caseId: benchCase.caseId, target: turn, context: ctxSlice })
            extractionCalls++
            memoriesWritten += outcome.inserted + outcome.superseded
            dedupNoops += outcome.duplicates
            dedupUpdated += outcome.updated
            dedupSuperseded += outcome.superseded
            if (outcome.writtenIds.length) {
              turnMemory[turn.turnId] = [...(turnMemory[turn.turnId] ?? []), ...outcome.writtenIds]
            }
          } catch {
            extractionCalls++
          }
          if (extractionCalls % 50 === 0) {
            process.stdout.write(`  [${benchCase.caseId}] ${extractionCalls}/${messages.length} msgs, ${memoriesWritten} memories\n`)
          }
        }
      }),
    )
  } else {
    for (const [idx, turn] of messages.entries()) {
      if (config.includeMessages) {
        await indexMessage({
          userId,
          sourceId: `${benchCase.caseId}:msg:${idx}`,
          text: turn.text.slice(0, 4000),
          speaker: turn.speaker,
          createdAt: turn.timestamp ? new Date(turn.timestamp).getTime() : undefined,
          conversationId: benchCase.caseId,
          turnId: turn.turnId,
          reservationNonce: indexNonce,
        }).catch(() => false)
      }
      const id = await addMemory({
        userId,
        content: `${formatDate(turn.timestamp)} ${turn.speaker ? `${turn.speaker}: ` : ''}${turn.text}`.trim().slice(0, 4000),
        source: 'chat',
        conversationId: benchCase.caseId,
        turnId: turn.turnId,
      })
      turnMemory[turn.turnId] = [...(turnMemory[turn.turnId] ?? []), id]
      memoriesWritten++
    }
  }

  for (const [idx, turn] of (benchCase.bulkMessages ?? []).entries()) {
    if (config.includeMessages) {
      await indexMessage({
        userId,
        sourceId: `${benchCase.caseId}:bulk:${idx}`,
        text: turn.text.slice(0, 8000),
        speaker: turn.speaker,
        createdAt: turn.timestamp ? new Date(turn.timestamp).getTime() : undefined,
        conversationId: `${benchCase.caseId}-bulk`,
        turnId: turn.turnId,
        reservationNonce: indexNonce,
      }).catch(() => false)
    }
    const id = await addMemory({
      userId,
      content: turn.text.slice(0, 8000),
      source: 'chat',
      conversationId: `${benchCase.caseId}-bulk`,
      turnId: turn.turnId,
    })
    turnMemory[turn.turnId] = [...(turnMemory[turn.turnId] ?? []), id]
    memoriesWritten++
  }

  const probe = messages[0]?.text.slice(0, 80) ?? benchCase.bulkMessages?.[0]?.text.slice(0, 80) ?? benchCase.caseId
  let indexWaitMs = -1
  let indexed = false
  try {
    indexWaitMs = await waitForIndex(userId, probe)
    indexed = indexWaitMs >= 0
  } catch (err) {
    console.warn(`  [${benchCase.caseId}] index wait failed: ${err instanceof Error ? err.message : err}`)
  }

  const memoryCountAfter = (await listMemories({ userId })).filter((m) => !m.deletedAt).length
  return {
    messages: messages.length,
    bulkMessages: benchCase.bulkMessages?.length ?? 0,
    extractionCalls,
    memoriesWritten,
    dedupNoops,
    dedupUpdated,
    dedupSuperseded,
    memoryCountAfter,
    indexWaitMs,
    indexed,
    durationMs: Date.now() - start,
    turnMemory,
  }
}

async function runQuestion(
  benchCase: BenchCase,
  question: BenchQuestion,
  userId: string,
  turnMemory: Record<string, string[]>,
): Promise<QaRow> {
  const t0 = Date.now()
  let chunks: Awaited<ReturnType<typeof retrieveMemoryContext>>['chunks']
  let searches: AgenticSearchStep[] | undefined
  let sufficient: boolean | undefined
  let modelAnswer: string
  let tRetrieve: number
  let tAnswer: number
  if (config.answerMode === 'agentic') {
    const res = await answerQuestionAgentic({
      userId,
      question: question.question,
      questionDate: question.questionDate,
    })
    chunks = res.chunks
    searches = res.searches
    sufficient = res.sufficient
    modelAnswer = res.answer
    tRetrieve = res.searchMs
    tAnswer = res.answerMs
  } else {
    const { extension, chunks: passiveChunks } = await retrieveMemoryContext({ userId, query: question.question, questionDate: question.questionDate })
    tRetrieve = Date.now() - t0
    const t1 = Date.now()
    modelAnswer = await answerQuestion({
      question: question.question,
      memoryContext: extension,
      questionDate: question.questionDate,
    })
    tAnswer = Date.now() - t1
    chunks = passiveChunks
  }

  const t2 = Date.now()
  const judged = question.evalFunction
    ? await judgeLongMemEval({
        question: question.question,
        goldAnswer: question.goldAnswer,
        modelAnswer,
        evalFunction: question.evalFunction,
      })
    : await judgeAnswer({
        question: question.question,
        goldAnswer: question.goldAnswer,
        modelAnswer,
        expectsAbstention: question.expectsAbstention,
        category: question.category,
      })
  const tJudge = Date.now() - t2

  // Retrieval-recall diagnostic: did a retrieved chunk's source memory come
  // from an evidence turn? turnMemory maps turnId → memoryIds it produced.
  let evidenceRecalled: boolean | null = null
  if (question.evidenceTurnIds?.length) {
    const wantedIds = new Set(question.evidenceTurnIds.flatMap((t) => turnMemory[t] ?? []))
    evidenceRecalled = wantedIds.size > 0 ? chunks.some((c) => wantedIds.has(c.sourceId)) : false
  }

  return {
    id: question.questionId,
    caseId: benchCase.caseId,
    category: question.category,
    verdict: judged.verdict,
    question: question.question,
    goldAnswer: question.goldAnswer,
    modelAnswer,
    judgeRaw: judged.raw,
    retrievedChunkCount: chunks.length,
    evidenceRecalled,
    ...(searches ? { searches } : {}),
    ...(sufficient !== undefined ? { sufficient } : {}),
    latencyMs: { retrieve: tRetrieve, answer: tAnswer, judge: tJudge },
    truncated: benchCase.truncated ?? false,
  }
}

async function runCase(
  benchCase: BenchCase,
  opts: Opts,
  ingestCkpt: Checkpoint<IngestRow>,
  qaCkpt: Checkpoint<QaRow>,
): Promise<void> {
  const userId = benchUserId(opts.dataset, benchCase.caseId, opts.runId)
  const pending = benchCase.questions
    .slice(0, opts.limitQuestions)
    .filter((q) => (!opts.categories || opts.categories.has(q.category)) && !qaCkpt.has(q.questionId))
  if (!pending.length && ingestCkpt.has(benchCase.caseId)) return

  if (ingestCkpt.has(benchCase.caseId) && pending.length) {
    // Split-brain guard: a checkpoint says "ingested" but the store can be
    // gone — a previous run's cleanup, a kill mid-purge, or a manually wiped
    // QA log all leave this state. An empty store means the checkpoint is
    // stale; drop it so the case re-ingests rather than answering on nothing.
    const live = await listMemories({ userId })
    if (live.length === 0) {
      console.warn(`[ingest] ${benchCase.caseId}: checkpoint exists but store is empty — re-ingesting`)
      ingestCkpt.remove(benchCase.caseId)
    }
  }

  if (!ingestCkpt.has(benchCase.caseId)) {
    console.log(`[ingest] ${benchCase.caseId}: ${benchCase.messages.length} msgs + ${benchCase.bulkMessages?.length ?? 0} bulk`)
    try {
      const row = await ingestCase(benchCase, userId, { bulkOnly: opts.bulkOnly, maxMessages: opts.maxMessages })
      ingestCkpt.record({ id: benchCase.caseId, ...row })
      console.log(`[ingest] ${benchCase.caseId}: ${row.memoryCountAfter} memories, index ${row.indexed ? `ready in ${row.indexWaitMs}ms` : 'TIMED OUT'} (${(row.durationMs / 1000).toFixed(0)}s)`)
      if (!row.indexed) console.warn(`  WARNING: index never confirmed — answers may be degraded`)
    } catch (err) {
      console.error(`[ingest] ${benchCase.caseId} FAILED: ${err instanceof Error ? err.message : err}`)
      return
    }
  }

  let ingestRow = ingestCkpt.all().findLast((r) => r.id === benchCase.caseId)
  if (ingestRow && !ingestRow.indexed && pending.length) {
    // Index-lag guard: a previous ingest finished writing but the vector index
    // never confirmed (parallel ingest can push Convex backfill past the wait
    // window). QA on an unindexed store silently answers on nothing — re-wait
    // here instead; the data is already written, so the wait usually passes
    // quickly once the index catches up.
    const probe = benchCase.messages[0]?.text.slice(0, 80) ?? benchCase.bulkMessages?.[0]?.text.slice(0, 80) ?? benchCase.caseId
    const waitMs = await waitForIndex(userId, probe).catch(() => -1)
    if (waitMs < 0) {
      console.warn(`[ingest] ${benchCase.caseId}: index still not live — skipping QA this run`)
      return
    }
    ingestCkpt.remove(benchCase.caseId)
    ingestCkpt.record({ ...ingestRow, indexed: true, indexWaitMs: waitMs })
    ingestRow = { ...ingestRow, indexed: true, indexWaitMs: waitMs }
    console.log(`[ingest] ${benchCase.caseId}: index confirmed on re-wait (${waitMs}ms)`)
  }
  if (config.consolidation && pending.length) {
    // Stage 2 "dreaming": derive cross-memory inferences into `inferred`
    // memory rows before QA — the flag measures whether derived evidence
    // exists at retrieval time. Dedup-gated, so a resumed case's second
    // pass mostly noops.
    try {
      const outcome = await consolidateUser({ userId, caseId: benchCase.caseId })
      console.log(`[consolidate] ${benchCase.caseId}: ${outcome.inserted} inferred (${outcome.proposed} proposed, ${outcome.duplicates} dup, ${outcome.sources} sources${outcome.reason ? `, ${outcome.reason}` : ''})`)
      if (outcome.probe) {
        const waitMs = await waitForIndex(userId, outcome.probe).catch(() => -1)
        if (waitMs < 0) console.warn(`  WARNING: inferred-memory index not confirmed — QA may miss derived rows`)
      }
    } catch (err) {
      console.error(`[consolidate] ${benchCase.caseId} FAILED: ${err instanceof Error ? err.message : err}`)
    }
  }
  const turnMemory = ingestRow?.turnMemory ?? {}

  const qaConc = Math.max(1, Number(process.env.BENCH_QA_CONCURRENCY ?? 4))
  let qCursor = 0
  await Promise.all(
    Array.from({ length: Math.min(qaConc, pending.length) }, async () => {
      while (qCursor < pending.length) {
        const question = pending[qCursor++]!
        try {
          const row = await runQuestion(benchCase, question, userId, turnMemory)
          qaCkpt.record(row)
          console.log(`[qa] ${question.questionId} [${row.category}] ${row.verdict} (chunks=${row.retrievedChunkCount}${row.searches ? `, searches=${row.searches.length - 1}` : ''}, recall=${row.evidenceRecalled ?? 'n/a'})`)
        } catch (err) {
          console.error(`[qa] ${question.questionId} FAILED: ${err instanceof Error ? err.message : err}`)
          qaCkpt.record({
            id: question.questionId,
            caseId: benchCase.caseId,
            category: question.category,
            verdict: 'error',
            question: question.question,
            goldAnswer: question.goldAnswer,
            modelAnswer: '',
            judgeRaw: err instanceof Error ? err.message : 'failed',
            retrievedChunkCount: 0,
            evidenceRecalled: null,
            latencyMs: { retrieve: 0, answer: 0, judge: 0 },
            truncated: benchCase.truncated ?? false,
          })
        }
      }
    }),
  )

  if (!opts.keep) {
    // `list` can't page past its newest-100 window — purge by recorded ids.
    const removed = await purgeBenchUser(userId, Object.values(turnMemory).flat())
    if (config.includeMessages) {
      // M2: drop the verbatim message index — sourceIds are deterministic.
      const msgCount = opts.maxMessages
        ? Math.min(opts.maxMessages, benchCase.messages.length)
        : benchCase.messages.length
      const messageSourceIds = [
        ...Array.from({ length: msgCount }, (_, i) => `${benchCase.caseId}:msg:${i}`),
        ...(benchCase.bulkMessages ?? []).map((_, i) => `${benchCase.caseId}:bulk:${i}`),
      ]
      let messagesPurged = 0
      for (const sourceId of messageSourceIds) {
        await purgeMessageSource({ userId, sourceId }).then(() => messagesPurged++).catch(() => {})
      }
      const swept = await sweepOrphanedChunks({ userId }).catch(() => null)
      console.log(`[cleanup] ${benchCase.caseId}: purged ${removed} memories, ${messagesPurged}/${messageSourceIds.length} message sources${swept ? `, swept ${swept.deleted} orphan chunks` : ''}`)
    } else {
      console.log(`[cleanup] ${benchCase.caseId}: purged ${removed} memories`)
    }
  }
}

async function main(): Promise<void> {
  assertBenchConfig()
  await assertFreePricing()
  const opts = parseArgs()
  const dataset = await loadDataset(opts.dataset, opts.limitCases)
  const ingestCkpt = new Checkpoint<IngestRow>(opts.runId, `${opts.dataset}-ingest`)
  const qaCkpt = new Checkpoint<QaRow>(opts.runId, `${opts.dataset}-qa`)

  console.log(`run ${opts.runId} | ${dataset.name} | ${dataset.cases.length} cases | mode ${config.answerMode} | concurrency ${opts.caseConcurrency}`)
  const started = Date.now()

  // Case-level pool — each case owns a distinct bench user, so parallel is safe.
  // With --categories, cases holding no matching question are dropped before
  // ingest (per-category datasets like ConvoMem skip whole ingest units).
  const queue = dataset.cases.filter(
    (c) =>
      (!opts.categories || c.questions.some((q) => opts.categories!.has(q.category))) &&
      (!ingestCkpt.has(c.caseId) || c.questions.some((q) => !qaCkpt.has(q.questionId))),
  )
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(opts.caseConcurrency, queue.length) }, async () => {
      while (cursor < queue.length) {
        const benchCase = queue[cursor++]!
        await runCase(benchCase, opts, ingestCkpt, qaCkpt)
      }
    }),
  )

  const rows = qaCkpt.all()
  const correct = rows.filter((r) => r.verdict === 'correct').length
  const summary = {
    runId: opts.runId,
    dataset: dataset.name,
    answerMode: config.answerMode,
    cases: dataset.cases.length,
    questions: rows.length,
    correct,
    incorrect: rows.filter((r) => r.verdict === 'incorrect').length,
    abstained: rows.filter((r) => r.verdict === 'abstained').length,
    errors: rows.filter((r) => r.verdict === 'error').length,
    accuracy: rows.length ? Number(((correct / rows.length) * 100).toFixed(2)) : 0,
    wallTimeMin: Number(((Date.now() - started) / 60000).toFixed(1)),
    finishedAt: new Date().toISOString(),
  }
  const out = path.join(config.resultsDir, opts.runId, `${opts.dataset}-summary.json`)
  writeFileSync(out, JSON.stringify(summary, null, 2))
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`wrote ${out}`)
  console.log('next: npx tsx benchmarks/memory/src/report.ts ' + opts.runId)
}

main().catch((err) => {
  console.error('runner failed:', err)
  process.exit(1)
})
