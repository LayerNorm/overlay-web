import { assertBenchConfig, benchUserId, config, FREE_MODEL_ID } from './src/config'
import { answerQuestionAgentic } from './src/agentic'
import { addMemory, hybridSearch, indexMessage, listMemories, purgeBenchUser, purgeMessageSource, removeMemory, updateMemory } from './src/convex-client'
import { extractAndStore } from './src/extractor'
import { benchText } from './src/gateway'
import { retrieveMemoryContext } from './src/retrieve'

/**
 * Smoke test — run BEFORE any dataset work. Validates the four assumptions a
 * benchmark run silently depends on:
 *
 *   1. A synthetic `bench-*` userId can write memories via serverSecret.
 *   2. reindex→embed actually completes for that user (budget reservations).
 *   3. hybridSearch returns memory chunks for that user.
 *   4. `inclusionai/ling-3.0-flash-vl-free` resolves on the AI Gateway.
 *
 *   npx tsx benchmarks/memory/smoke.ts
 */

const results: Array<{ name: string; pass: boolean; detail: string }> = []
const check = (name: string, pass: boolean, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const userId = benchUserId('smoke', String(Date.now()))
const PROBE = `zephyr-quokka-${Date.now()}` // unique term guarantees a fresh index hit

async function waitIndexed(query: string, timeoutMs = 90_000): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const chunks = await hybridSearch({ userId, query, m: 3 })
      if (chunks.length > 0) return Date.now() - start
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/budget_exhausted|Unauthorized|pricing_missing/i.test(msg)) throw err
    }
    await new Promise((r) => setTimeout(r, 2500))
  }
  return -1
}

async function main(): Promise<void> {
  console.log(`smoke: convex=${config.convexUrl} model=${FREE_MODEL_ID}`)
  assertBenchConfig()
  check('config', true, 'convex url + serverSecret + gateway key present')

  // 1. Gateway + free model
  try {
    const text = await benchText(FREE_MODEL_ID, 'Reply with the word: ready')
    check('gateway:ling-model', /ready/i.test(text), `answered "${text.slice(0, 40)}"`)
  } catch (err) {
    check('gateway:ling-model', false, err instanceof Error ? err.message.slice(0, 120) : 'failed')
    throw new Error('gateway unusable — stop here')
  }

  // 2. Direct memory write
  try {
    await addMemory({ userId, content: `User's favorite color is ${PROBE} blue`, source: 'chat', type: 'preference' })
    check('convex:add-memory', true)
  } catch (err) {
    check('convex:add-memory', false, err instanceof Error ? err.message.slice(0, 120) : 'failed')
    throw new Error('cannot write memories — stop here')
  }

  // 3. Indexing completes (embedding reservation works for bench users)
  try {
    const waitMs = await waitIndexed(PROBE)
    check('convex:indexing', waitMs >= 0, waitMs >= 0 ? `indexed in ${waitMs}ms` : 'timed out after 90s')
  } catch (err) {
    check('convex:indexing', false, err instanceof Error ? err.message.slice(0, 120) : 'failed')
  }

  // 4. Retrieval paths
  const lex = await hybridSearch({ userId, query: PROBE, m: 5 })
  check('retrieve:lexical', lex.length > 0, `${lex.length} chunks`)
  const sem = await hybridSearch({ userId, query: 'what color does the user like?', m: 5 })
  check('retrieve:semantic', sem.some((c) => c.text.includes(PROBE)), `${sem.length} chunks`)
  const { extension } = await retrieveMemoryContext({ userId, query: 'favorite color' })
  check('retrieve:auto-retrieval-format', extension.includes('AUTO_RETRIEVED_KNOWLEDGE'), `${extension.length} chars`)

  // 5. Extraction replica end-to-end
  try {
    const outcome = await extractAndStore({
      userId,
      caseId: 'smoke',
      target: { turnId: 't1', role: 'user', text: 'I just moved to Lisbon and I work as a sound designer at Acme Studios.' },
      context: [],
    })
    check('extract:ling-candidates', outcome.inserted > 0, `${outcome.inserted} inserted (${outcome.reason ?? 'ok'})`)
  } catch (err) {
    check('extract:ling-candidates', false, err instanceof Error ? err.message.slice(0, 120) : 'failed')
  }

  // 5b. M2 verbatim message index (skipped when BENCH_MESSAGE_INDEX=0)
  if (config.includeMessages) {
    try {
      const msgSource = `smoke:msg:${Date.now()}`
      const indexed = await indexMessage({
        userId,
        sourceId: msgSource,
        text: `Smoke probe ${PROBE}: the meeting moved to Thursday`,
        speaker: 'User',
      })
      check('m2:index-message', indexed)
      let hit = false
      for (let i = 0; i < 20 && !hit; i++) {
        const found = await hybridSearch({ userId, query: 'meeting moved to Thursday', sourceKinds: ['message'], m: 3 })
        hit = found.some((c) => c.sourceKind === 'message')
        if (!hit) await new Promise((r) => setTimeout(r, 2500))
      }
      check('m2:retrieve-message', hit)
      await purgeMessageSource({ userId, sourceId: msgSource }).catch(() => {})
    } catch (err) {
      check('m2:index-message', false, err instanceof Error ? err.message.slice(0, 120) : 'failed')
    }
  }

  // 5c. M4 agentic loop — prefetch + mandatory reformulation + synthesis.
  // Structural check only: the planner model's choices are nondeterministic,
  // so assert the contract (an answer, 1..maxSearchRounds model searches —
  // round 0 always searches).
  try {
    const res = await answerQuestionAgentic({
      userId,
      question: "what is the user's favorite color?",
    })
    const modelSearches = res.searches.length - 1
    check(
      'm4:agentic-loop',
      res.answer.length > 0 && modelSearches >= 1 && modelSearches <= config.maxSearchRounds,
      `${modelSearches} searches, ${res.chunks.length} evidence chunks, answer "${res.answer.slice(0, 60)}"`,
    )
  } catch (err) {
    check('m4:agentic-loop', false, err instanceof Error ? err.message.slice(0, 120) : 'failed')
  }

  // 6. Update + delete + purge
  try {
    const rows = await listMemories({ userId })
    const probeRow = rows.find((r) => r.content.includes(PROBE))
    if (!probeRow) throw new Error('probe memory missing')
    await updateMemory({ userId, memoryId: probeRow._id, content: `User's favorite color is ${PROBE} green` })
    await removeMemory({ userId, memoryId: probeRow._id })
    const after = await listMemories({ userId })
    const stillThere = after.some((r) => r._id === probeRow._id && !r.deletedAt)
    check('convex:update-delete', !stillThere)
  } catch (err) {
    check('convex:update-delete', false, err instanceof Error ? err.message.slice(0, 120) : 'failed')
  }

  // 7. Cleanup
  try {
    const removed = await purgeBenchUser(userId)
    check('cleanup:purge', removed >= 0, `${removed} memories soft-deleted`)
  } catch (err) {
    check('cleanup:purge', false, err instanceof Error ? err.message.slice(0, 120) : 'failed')
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('\nFailures to resolve before benchmarking:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
  console.log('smoke OK — safe to run dataset benchmarks')
}

main().catch((err) => {
  console.error('smoke aborted:', err instanceof Error ? err.message : err)
  process.exit(1)
})
