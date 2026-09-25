import assert from 'node:assert/strict'
import test from 'node:test'
import { answerQuestionAgentic, type AgenticDeps } from './agentic'
import type { HybridChunk } from './convex-client'

function chunk(id: string, score = 1): HybridChunk {
  return { text: `chunk ${id}`, sourceKind: 'memory', sourceId: id, chunkIndex: 0, score }
}

function baseDeps(overrides: Partial<AgenticDeps> = {}): AgenticDeps {
  return {
    retrieve: async () => ({ extension: '', chunks: [chunk('seed')] }),
    search: async () => [chunk('s1')],
    decide: async () => ({ action: 'answer' as const }),
    // Tests stub the gate by default — gate-specific tests override it.
    checkEvidence: async () => true,
    synthesize: async () => 'the answer',
    maxRounds: 4,
    ...overrides,
  }
}

const ARGS = { userId: 'u1', question: 'what did the user say?' }

test('round 0 is a mandatory search — an immediate "answer" is not honored', async () => {
  const kinds: Array<string | string[]> = []
  const res = await answerQuestionAgentic(ARGS, baseDeps({
    decide: async () => ({ action: 'answer' as const }), // planner refuses to search
    search: async (a) => {
      kinds.push(a.sourceKind ?? a.sourceKinds ?? 'none')
      return [chunk('s1')]
    },
  }))
  assert.equal(res.answer, 'the answer')
  // prefetch + 1 coerced round-0 search (verbatim surface, literal question)
  assert.equal(res.searches.length, 2)
  assert.deepEqual(kinds, ['message'])
  assert.equal(res.searches[1]!.query, ARGS.question)
  assert.equal(res.chunks.length, 2)
})

test('the loop stops once the planner answers after round 0', async () => {
  let searches = 0
  const res = await answerQuestionAgentic(ARGS, baseDeps({
    decide: async (_p, left) => (left === 4
      ? { action: 'search_memory' as const, query: 'round 0' }
      : { action: 'answer' as const }),
    search: async () => {
      searches++
      return [chunk('s1')]
    },
  }))
  assert.equal(searches, 1)
  assert.equal(res.searches.length, 2) // prefetch + 1 model search
})

test('hard-caps the reformulation loop at maxRounds', async () => {
  let searches = 0
  let decisions = 0
  const res = await answerQuestionAgentic(ARGS, baseDeps({
    decide: async () => {
      decisions++
      return { action: 'search_memory' as const, query: `q${decisions}` }
    },
    search: async () => {
      searches++
      return [chunk(`s${searches}`)]
    },
    maxRounds: 4,
  }))
  assert.equal(searches, 4)
  assert.equal(decisions, 4)
  // prefetch + 4 rounds of evidence
  assert.equal(res.chunks.length, 5)
  assert.equal(res.searches.length, 5)
})

test('a post-round-0 search action with no query terminates the loop', async () => {
  let searches = 0
  await answerQuestionAgentic(ARGS, baseDeps({
    decide: async (_p, left) => (left === 4
      ? { action: 'search_memory' as const, query: 'first' }
      : { action: 'search_memory' as const, query: '   ' }),
    search: async () => {
      searches++
      return []
    },
  }))
  assert.equal(searches, 1)
})

test('repeat hits are deduplicated out of the evidence pool', async () => {
  const res = await answerQuestionAgentic(ARGS, baseDeps({
    decide: async (_p, left) => (left > 1
      ? { action: 'search_memory' as const, query: 'same thing' }
      : { action: 'answer' as const }),
    search: async () => [chunk('seed'), chunk('s1')], // 'seed' already in pool
    maxRounds: 4,
  }))
  // seed + s1 only — the duplicate 'seed' hit never re-enters evidence
  assert.equal(res.chunks.length, 2)
  assert.equal(res.searches[1]!.newHits, 1)
})

test('search_messages rounds route to the message surface', async () => {
  const kinds: string[] = []
  await answerQuestionAgentic(ARGS, baseDeps({
    decide: async (_p, left) => (left > 3
      ? { action: 'search_messages' as const, query: 'exact words' }
      : { action: 'answer' as const }),
    search: async (a) => {
      kinds.push(a.sourceKind ?? 'none')
      return []
    },
  }))
  assert.deepEqual(kinds, ['message'])
})

test('search_all rounds hit both surfaces when the message index is on', async () => {
  const kinds: Array<string | string[]> = []
  await answerQuestionAgentic(ARGS, baseDeps({
    decide: async (_p, left) => (left > 3
      ? { action: 'search_all' as const, query: 'both sides' }
      : { action: 'answer' as const }),
    search: async (a) => {
      kinds.push(a.sourceKind ?? a.sourceKinds ?? 'none')
      return []
    },
  }))
  assert.deepEqual(kinds, [['memory', 'message']])
})

test('sufficiency gate abstains without calling synthesis when evidence does not answer', async () => {
  let synthesized = 0
  let gatePrompt = ''
  const res = await answerQuestionAgentic(ARGS, baseDeps({
    checkEvidence: async (p) => {
      gatePrompt = p
      return false
    },
    synthesize: async () => {
      synthesized++
      return 'guessed anyway'
    },
  }))
  assert.equal(res.answer, "I don't have that information.")
  assert.equal(res.sufficient, false)
  assert.equal(synthesized, 0)
  // The gate sees the question and the accumulated evidence digest.
  assert.match(gatePrompt, /what did the user say\?/)
  assert.match(gatePrompt, /chunk seed/)
})

test('sufficiency gate passes strong evidence through to synthesis', async () => {
  let gates = 0
  const res = await answerQuestionAgentic(ARGS, baseDeps({
    checkEvidence: async () => {
      gates++
      return true
    },
  }))
  assert.equal(gates, 1)
  assert.equal(res.answer, 'the answer')
  assert.equal(res.sufficient, undefined)
})

test('a failing gate fails open — never forces abstention', async () => {
  const res = await answerQuestionAgentic(ARGS, baseDeps({
    checkEvidence: async () => {
      throw new Error('gate unavailable')
    },
  }))
  assert.equal(res.answer, 'the answer')
})

test('the gate runs after the loop, not per round', async () => {
  let gates = 0
  const res = await answerQuestionAgentic(ARGS, baseDeps({
    decide: async () => ({ action: 'search_memory' as const, query: 'more' }),
    search: async () => [chunk('s1')],
    checkEvidence: async () => {
      gates++
      return true
    },
    maxRounds: 2,
  }))
  assert.equal(gates, 1)
  assert.equal(res.searches.length, 3) // prefetch + 2 rounds
})
