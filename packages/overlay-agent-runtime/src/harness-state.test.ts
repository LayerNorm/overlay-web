import assert from 'node:assert/strict'
import test from 'node:test'
import {
  admitHarnessChild, assertHarnessRunnable, blockHarness, checkpointHarness, createHarnessSnapshot,
  currentHarnessContext, finishHarness, recordHarnessEvidence, recordHarnessReceipt,
  replaceHarnessPlan, settleHarnessChild, transitionHarnessStep, type HarnessChild, type HarnessEvidence,
  type HarnessPlanInput, type HarnessReceipt,
} from './harness-state'

const now = 1_000
const make = () => createHarnessSnapshot({ runId: 'root', goal: 'Produce a checked report', constraints: [], policy: {
  actorUserId: 'user', allowedToolIds: ['read', 'write'], requiresPlan: true,
  deadlineAt: 10_000, maxCostMicros: 100, maxParallelChildren: 2, maxDepth: 1,
} }, now)
const steps: HarnessPlanInput[] = [
  { id: 'read', title: 'Read source', acceptanceCriteria: ['Source read'], dependsOn: [], requiresVerification: false },
  { id: 'report', title: 'Check report', acceptanceCriteria: ['Figures checked'], dependsOn: ['read'], requiresVerification: true },
]
const child = (id: string, stepId: string, budget: number): HarnessChild => ({
  id, stepId, maxCostMicros: budget, costMicros: 0, allowedToolIds: ['read'], status: 'running', evidenceRefs: [],
})

test('completion requires persisted evidence, satisfied dependencies and independent verification', () => {
  let state = replaceHarnessPlan(make(), steps, now)
  assert.throws(() => finishHarness(state, now), /unfinished/)
  assert.throws(() => transitionHarnessStep(state, { id: 'read', status: 'done' }, now), /evidence/)
  state = recordHarnessEvidence(state, { id: 'source', kind: 'tool_result', source: 'file:revision-1', summary: 'Read source', verdict: 'observed', createdAt: now }, now)
  assert.throws(() => transitionHarnessStep(state, { id: 'report', status: 'done', evidenceRefs: ['source'] }, now), /Dependencies/)
  state = transitionHarnessStep(state, { id: 'read', status: 'done', evidenceRefs: ['source'] }, now)
  assert.throws(() => transitionHarnessStep(state, { id: 'report', status: 'done', evidenceRefs: ['source'] }, now), /verification/)
  state = recordHarnessEvidence(state, { id: 'check', kind: 'verification', source: 'check:report:revision-1', summary: 'Figures match source', verdict: 'passed', createdAt: now, verification: { stepId: 'report', planRevision: state.planRevision } }, now)
  state = transitionHarnessStep(state, { id: 'report', status: 'done', evidenceRefs: ['check'] }, now)
  assert.equal(finishHarness(state, now).status, 'completed')
  assert.equal(state.status, 'running')
})

test('reducers isolate caller-owned inputs', () => {
  let state = replaceHarnessPlan(make(), steps, now)
  const evidence: HarnessEvidence = {
    id: 'source', kind: 'verification', source: 'check:source', summary: 'Source verified',
    verdict: 'passed', createdAt: now, verification: { stepId: 'read', planRevision: state.planRevision },
  }
  state = recordHarnessEvidence(state, evidence, now)
  evidence.summary = 'mutated'
  evidence.verification!.stepId = 'mutated'
  assert.equal(state.evidence[0]?.summary, 'Source verified')
  assert.deepEqual(state.evidence[0]?.verification, { stepId: 'read', planRevision: 1 })

  const receipt: HarnessReceipt = {
    id: 'call', modelId: 'model', provider: 'provider', inputTokens: 100, outputTokens: 10,
    reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 0,
  }
  state = recordHarnessReceipt(state, receipt, now)
  receipt.modelId = 'mutated'
  assert.equal(state.latestReceipt?.modelId, 'model')

  const delegatedChild: HarnessChild = { ...child('first', 'read', 60), allowedToolIds: ['read'], evidenceRefs: [] }
  state = admitHarnessChild(state, delegatedChild, now)
  delegatedChild.allowedToolIds.push('write')
  delegatedChild.evidenceRefs.push('source')
  assert.deepEqual(state.children[0]?.allowedToolIds, ['read'])
  assert.deepEqual(state.children[0]?.evidenceRefs, [])

  const blocker = { kind: 'input' as const, question: 'Need input' }
  state = blockHarness(state, blocker, now)
  blocker.question = 'mutated'
  assert.equal(state.blocker?.question, 'Need input')
})

test('plan revisions reject cycles and invalidate completed downstream work', () => {
  let state = replaceHarnessPlan(make(), steps.map(step => ({ ...step, requiresVerification: false })), now)
  assert.throws(() => replaceHarnessPlan(state, steps.map(step => ({ ...step, dependsOn: [step.id] })), now), /cycle/)
  state = recordHarnessEvidence(state, { id: 'source', kind: 'tool_result', source: 'file:revision-1', summary: 'Read source', verdict: 'observed', createdAt: now }, now)
  for (const id of ['read', 'report']) state = transitionHarnessStep(state, { id, status: 'done', evidenceRefs: ['source'] }, now)
  const previous = state
  state = replaceHarnessPlan(state, state.plan.map(step => ({ ...step, title: step.id === 'read' ? 'Read revised source' : step.title })), now)
  assert.deepEqual(state.plan.map(step => step.status), ['pending', 'pending'])
  assert.deepEqual(previous.plan.map(step => step.status), ['done', 'done'])
  assert.throws(() => replaceHarnessPlan(state, [steps[0]!], now), /Keep existing/)
})

test('telemetry is not progress and context occupancy is current rather than cumulative', () => {
  let state = make()
  for (let call = 0; call < 2; call++) state = recordHarnessReceipt(state, {
    id: `call-${call}`, modelId: 'model', provider: 'provider', inputTokens: 200, outputTokens: 10,
    reasoningTokens: 0, cacheReadTokens: 100, cacheWriteTokens: 0, costMicros: 0, contextWindow: 1_000,
  }, now)
  assert.equal(state.usage.inputTokens, 400)
  assert.equal(currentHarnessContext(state).occupancy, 0.2)
  assert.equal(state.progressRevision, 0)
  assert.equal(recordHarnessReceipt(state, state.latestReceipt!, now), state)
  state = checkpointHarness(state, 'No change', now)
  state = checkpointHarness(state, 'Still no change', now)
  assert.equal(state.status, 'waiting_for_input')
  assert.equal(state.blocker?.kind, 'stuck')
})

test('child reservations enforce capabilities, root spending, concurrency and depth', () => {
  let state = replaceHarnessPlan(make(), [...steps.map(step => ({ ...step, dependsOn: [] })), { ...steps[0]!, id: 'extra' }], now)
  assert.throws(() => admitHarnessChild(state, { ...child('bad', 'read', 1), allowedToolIds: ['admin'] }, now), /capabilities/)
  state = admitHarnessChild(state, child('first', 'read', 60), now)
  assert.throws(() => admitHarnessChild(state, child('second', 'report', 41), now), /spending/)
  state = admitHarnessChild(state, child('second', 'report', 40), now)
  assert.throws(() => admitHarnessChild(state, child('third', 'extra', 0), now), /concurrency/)
  assert.throws(() => assertHarnessRunnable(state, now, 1), /spending/)
  assert.throws(() => admitHarnessChild({ ...state, depth: 1, children: [] }, child('deep', 'extra', 0), now), /depth/)
  assert.throws(() => assertHarnessRunnable(state, 10_000), /deadline/)
})

test('joining a child charges usage once, releases unused budget and preserves authority', () => {
  let state = replaceHarnessPlan(make(), steps, now)
  state = admitHarnessChild(state, { ...child('first', 'read', 60), allowedToolIds: ['read', 'write'] }, now)
  let worker = createHarnessSnapshot({ runId: 'first', rootRunId: 'root', parentRunId: 'root', depth: 1,
    goal: 'Read source', constraints: [], policy: {
      ...state.policy, allowedToolIds: ['read'], requiresPlan: false, maxCostMicros: 50,
    },
  }, now)
  worker = recordHarnessReceipt(worker, { id: 'call', modelId: 'model', provider: 'provider', inputTokens: 100,
    outputTokens: 10, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 40,
  }, now)
  worker = finishHarness(worker, now)
  assert.throws(() => settleHarnessChild(state, { ...worker, policy: { ...worker.policy, actorUserId: 'other' } }, now), /authority/)
  assert.throws(() => settleHarnessChild(state, {
    ...worker, policy: { ...worker.policy, allowedToolIds: ['read', 'write', 'admin'] },
  }, now), /authority/)
  assert.throws(() => settleHarnessChild(state, {
    ...worker, policy: { ...worker.policy, maxCostMicros: 61 },
  }, now), /authority/)
  state = settleHarnessChild(state, worker, now)
  assert.equal(state.usage.costMicros, 40)
  assert.equal(settleHarnessChild(state, worker, now), state)
  assertHarnessRunnable(state, now, 60)
  assert.throws(() => assertHarnessRunnable(state, now, 61), /spending/)
})
