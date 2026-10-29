import assert from 'node:assert/strict'
import test from 'node:test'
import {
  admitHarnessChild, admitHarnessNamedChild, assertHarnessRunnable, blockHarness, checkpointHarness, createHarnessSnapshot,
  currentHarnessContext, finishHarness, harnessCompletionIssues, recordHarnessEvidence, recordHarnessReceipt, recordHarnessChildReceipt,
  replaceHarnessPlan, settleHarnessChild, terminateHarness, transitionHarnessStep, type HarnessChild, type HarnessEvidence,
  type HarnessPlanInput, type HarnessReceipt,
  claimHarnessExecution, hasRunnableHarnessMilestones, waitForHarnessChildren, resumeHarness,
  reserveHarnessModel, reservedHarnessCostMicros,
  bindHarnessModelDispatch,
  validateHarnessReceipt,
} from './harness-state'

const now = 1_000

test('a rejection receipt cannot conceal consumed tokens or unknown costs', () => {
  const receipt: HarnessReceipt = { id: 'rejected', modelId: 'model', provider: 'overlay-admission', inputTokens: 0, outputTokens: 0,
    reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 0, costSource: 'catalog', rejectionReason: 'budget' }
  for (const rejectionReason of ['budget', 'model_unavailable', 'route_capacity', 'route_interrupted', 'summary_failed'] as const) {
    validateHarnessReceipt({ ...receipt, rejectionReason })
    for (const delta of [{ inputTokens: 1 }, { outputTokens: 1 }, { costMicros: 1 }, { externalCostMicros: null }, { costSource: 'provider' as const }]) {
      assert.throws(() => validateHarnessReceipt({ ...receipt, rejectionReason, ...delta }), /confirmed zero/)
    }
  }
})
const make = () => createHarnessSnapshot({ runId: 'root', goal: 'Produce a checked report', constraints: [], policy: {
  actorUserId: 'user', allowedToolIds: ['read', 'write'], requiresPlan: true,
  deadlineAt: 10_000, maxCostMicros: 100, maxParallelChildren: 2, maxDepth: 1,
} }, now)

test('route interruption receipts count durably toward the per-run retry cap', () => {
  let state = make()
  for (let index = 0; index < 3; index += 1) {
    state = recordHarnessReceipt(state, {
      id: `model:${index}`,
      modelId: 'openrouter/free',
      provider: 'overlay-free-router',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindow: null,
      costMicros: 0,
      costSource: 'catalog',
      rejectionReason: 'route_interrupted',
    }, now)
  }
  assert.equal(state.routeInterruptionCount, 3)
  assert.equal(state.latestReceipt?.rejectionReason, 'route_interrupted')
})

const steps: HarnessPlanInput[] = [
  { id: 'read', title: 'Read source', acceptanceCriteria: ['Source read'], dependsOn: [], requiresVerification: false, evidenceTools: ['read', 'write'] },
  { id: 'report', title: 'Check report', acceptanceCriteria: ['Figures checked'], dependsOn: ['read'], requiresVerification: true, evidenceTools: ['read', 'write'] },
]
const child = (id: string, stepId: string, budget: number): HarnessChild => ({
  id, stepId, maxCostMicros: budget, costMicros: 0, allowedToolIds: ['read'], status: 'running', evidenceRefs: [],
})
const childRunState = (parent: ReturnType<typeof make>, runId: string, at: number) => createHarnessSnapshot({
  runId,
  parentRunId: parent.runId,
  rootRunId: parent.rootRunId,
  depth: parent.depth + 1,
  goal: 'Return findings.',
  constraints: [],
  policy: { ...parent.policy, allowedToolIds: ['read'], requiresPlan: false, maxCostMicros: 0 },
}, at)

test('model dispatch binds one billing reservation without releasing the budget hold', () => {
  const reserved = reserveHarnessModel(make(), 'receipt', 80, now)
  const dispatch = { modelId: 'provider/model', billingReservationId: 'billing-reservation' }
  const bound = bindHarnessModelDispatch(reserved, 'receipt', dispatch, now)
  assert.equal(reserved.modelReservation?.dispatch, undefined)
  assert.deepEqual(bound.modelReservation?.dispatch, dispatch)
  assert.equal(reservedHarnessCostMicros(bound), 80)
  assert.equal(bindHarnessModelDispatch(bound, 'receipt', dispatch, now), bound)
  assert.throws(() => bindHarnessModelDispatch(bound, 'receipt', { ...dispatch, billingReservationId: null }, now), /cannot change/)
  assert.throws(() => bindHarnessModelDispatch(bound, 'other', dispatch, now), /matching reservation/)
  assert.throws(() => bindHarnessModelDispatch(make(), 'receipt', dispatch, now), /matching reservation/)
  const cancelled = terminateHarness(bound, 'cancelled', 'User stopped', now)
  assert.deepEqual(cancelled.modelReservation?.dispatch, dispatch)
  assert.throws(() => bindHarnessModelDispatch(cancelled, 'receipt', dispatch, now))
  assert.equal(bindHarnessModelDispatch(reserved, 'receipt', { ...dispatch, billingReservationId: null }, now).modelReservation?.dispatch?.billingReservationId, null)
})

test('external provider costs remain distinct from Overlay budget usage through child settlement', () => {
  let parent = admitHarnessChild(replaceHarnessPlan(make(), steps, now), child('first', 'read', 0), now)
  let worker = createHarnessSnapshot({ runId: 'first', rootRunId: 'root', parentRunId: 'root', depth: 1,
    goal: 'Read source', constraints: [], policy: { ...parent.policy, allowedToolIds: ['read'], requiresPlan: false, maxCostMicros: 0 },
  }, now)
  const receipt: HarnessReceipt = { id: 'external', modelId: 'byok/connection/model', provider: 'unreported', inputTokens: 10,
    outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 0,
    costSource: 'external', externalCostMicros: null }
  for (const entry of [receipt, { ...receipt, id: 'known', externalCostMicros: 25 }]) {
    worker = recordHarnessReceipt(worker, entry, now)
    parent = recordHarnessChildReceipt(parent, 'first', entry, now)
  }
  parent = settleHarnessChild(parent, finishHarness(worker, now), now)
  assert.equal(parent.usage.costMicros, 0)
  assert.equal(parent.usage.externalCostMicros, 25)
  assert.equal(parent.usage.unpricedExternalCalls, 1)
  assert.equal(parent.usage.inputTokens, 20)
  assert.throws(() => recordHarnessReceipt(make(), { ...receipt, costMicros: 25 }, now), /external/)
  assert.throws(() => recordHarnessReceipt(make(), { ...receipt, cacheReadTokens: 11 }, now), /Cached tokens/)
})

test('pending model spend cannot also be reserved by a delegated child', () => {
  let state = replaceHarnessPlan(make(), steps, now)
  state = reserveHarnessModel(state, 'model:0', 60, now)
  assert.equal(reserveHarnessModel(state, 'model:0', 60, now), state)
  assert.throws(() => reserveHarnessModel(state, 'model:0', 61, now), /Reconcile/)
  assert.throws(() => reserveHarnessModel(state, 'model:1', 0, now), /Reconcile/)
  assert.throws(() => admitHarnessChild(state, child('first', 'read', 41), now), /spending/)
  state = admitHarnessChild(state, child('first', 'read', 40), now)
  assert.equal(reservedHarnessCostMicros(state), 100)
  const pending = state
  state = recordHarnessReceipt(state, { id: 'model:0', modelId: 'model', provider: 'provider', inputTokens: 1,
    outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 50,
  }, now)
  assert.deepEqual(pending.modelReservation, { id: 'model:0', maxCostMicros: 60 })
  assert.equal(state.modelReservation, undefined)
  assert.equal(reservedHarnessCostMicros(state), 40)
  assertHarnessRunnable(state, now, 10)
  assert.throws(() => assertHarnessRunnable(state, now, 11), /spending/)
})

test('a cancelled child retains its unresolved model liability until the matching receipt arrives', () => {
  const parent = admitHarnessChild(replaceHarnessPlan(make(), steps, now), child('first', 'read', 60), now)
  let worker = createHarnessSnapshot({ runId: 'first', rootRunId: 'root', parentRunId: 'root', depth: 1,
    goal: 'Read source', constraints: [], policy: { ...parent.policy, allowedToolIds: ['read'], requiresPlan: false, maxCostMicros: 60 },
  }, now)
  worker = reserveHarnessModel(worker, 'model:0', 60, now)
  assert.throws(() => finishHarness(worker, now), /reconciliation/)
  worker = terminateHarness(worker, 'cancelled', 'User stopped', now)
  assert.throws(() => settleHarnessChild(parent, worker, now), /Reconcile/)
  const receipt: HarnessReceipt = { id: 'unrelated', modelId: 'model', provider: 'provider', inputTokens: 1,
    outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 0,
  }
  worker = recordHarnessReceipt(worker, receipt, now)
  assert.ok(worker.modelReservation)
  worker = recordHarnessReceipt(worker, { ...receipt, id: 'model:0', costMicros: 40 }, now)
  assert.equal(worker.status, 'cancelled')
  assert.equal(worker.modelReservation, undefined)
  const settled = settleHarnessChild(parent, worker, now)
  assert.equal(settled.usage.costMicros, 40)
  assertHarnessRunnable(settled, now, 60)
})

test('one workflow owns a run and child-only waiting preserves resumable state', () => {
  let state = claimHarnessExecution(make(), 'workflow', now)
  assert.equal(claimHarnessExecution(state, 'workflow', now), state)
  assert.throws(() => claimHarnessExecution(state, 'other-workflow', now), /ALREADY_CLAIMED/)
  state = replaceHarnessPlan(state, steps, now)
  assert.equal(hasRunnableHarnessMilestones(state), true)
  assert.throws(() => waitForHarnessChildren(state, now), /Only wait/)
  state = admitHarnessChild(state, child('child', 'read', 40), now)
  assert.equal(hasRunnableHarnessMilestones(state), false)
  state = waitForHarnessChildren(state, now)
  assert.equal(state.status, 'waiting_for_children')
  state = resumeHarness(state, now)
  assert.equal(state.status, 'running')
  assert.equal(state.children[0].status, 'running')
})

test('completion requires persisted evidence, satisfied dependencies and independent verification', () => {
  let state = replaceHarnessPlan(make(), steps, now)
  assert.throws(() => finishHarness(state, now), /unfinished/)
  assert.throws(() => transitionHarnessStep(state, { id: 'read', status: 'done' }, now), /evidence/)
  state = recordHarnessEvidence(state, {
    id: 'prompt', kind: 'user_input', source: 'user', summary: 'Create a note.', verdict: 'observed', createdAt: now,
  }, now)
  assert.throws(() => transitionHarnessStep(state, { id: 'read', status: 'done', evidenceRefs: ['prompt'] }, now), /tool-result evidence/)
  state = recordHarnessEvidence(state, { id: 'source', kind: 'tool_result', source: 'read', summary: 'Read source', verdict: 'observed', createdAt: now }, now)
  assert.throws(() => transitionHarnessStep(state, { id: 'report', status: 'done', evidenceRefs: ['source'] }, now), /Dependencies/)
  state = transitionHarnessStep(state, { id: 'read', status: 'done', evidenceRefs: ['source'] }, now)
  state = recordHarnessEvidence(state, { id: 'report-source', kind: 'tool_result', source: 'read', summary: 'Report source checked', verdict: 'observed', createdAt: now }, now)
  assert.throws(() => transitionHarnessStep(state, { id: 'report', status: 'done', evidenceRefs: ['report-source'] }, now), /verification/)
  state = recordHarnessEvidence(state, { id: 'check', kind: 'verification', source: 'check:report:revision-1', summary: 'Figures match source', verdict: 'passed', createdAt: now, verification: { stepId: 'report', planRevision: state.planRevision } }, now)
  state = transitionHarnessStep(state, { id: 'report', status: 'done', evidenceRefs: ['report-source', 'check'] }, now)
  assert.equal(finishHarness(state, now).status, 'completed')
  assert.equal(state.status, 'running')
})

test('answer-only milestones need no evidence after their dependencies are complete', () => {
  const answerOnly = {
    id: 'answer',
    title: 'Answer from prior knowledge',
    dependsOn: ['read'],
    acceptanceCriteria: ['Answer the question.'],
    requiresVerification: false,
    answerOnly: true,
  }
  let state = replaceHarnessPlan(make(), [
    { ...steps[0]!, requiresVerification: false },
    answerOnly,
  ], now)
  assert.ok(harnessCompletionIssues(state).includes('Milestone answer is unfinished.'))
  assert.throws(() => transitionHarnessStep(state, { id: 'answer', status: 'done' }, now), /Dependencies/)
  state = recordHarnessEvidence(state, {
    id: 'source', kind: 'tool_result', source: 'read', summary: 'Read source', verdict: 'observed', createdAt: now,
  }, now)
  state = transitionHarnessStep(state, { id: 'read', status: 'done', evidenceRefs: ['source'] }, now)
  assert.deepEqual(harnessCompletionIssues(state), [])
  state = transitionHarnessStep(state, { id: 'answer', status: 'done' }, now)
  assert.equal(state.plan.find(step => step.id === 'answer')?.status, 'done')

  const pendingAnswer = replaceHarnessPlan(make(), [{
    id: 'answer',
    title: 'Answer from knowledge',
    dependsOn: [],
    acceptanceCriteria: ['Answer the question.'],
    requiresVerification: false,
    evidenceTools: ['read'],
    answerOnly: true,
  }], now)
  assert.deepEqual(harnessCompletionIssues(pendingAnswer), [])
  const finished = finishHarness(pendingAnswer, now)
  assert.equal(finished.status, 'completed')
  assert.equal(finished.plan[0]?.status, 'done')
})

test('answer-only milestones cannot require verification or delegate work', () => {
  assert.throws(() => replaceHarnessPlan(make(), [{
    ...steps[0]!, requiresVerification: true, answerOnly: true,
  }], now), /Answer-only/)
  assert.throws(() => replaceHarnessPlan(make(), [{
    ...steps[0]!, requiresVerification: false, answerOnly: true, childRunId: 'child',
  } as never], now), /Answer-only/)
})

test('plan identity includes answer-only behavior', () => {
  const step = {
    id: 'answer',
    title: 'Answer from knowledge',
    dependsOn: [],
    acceptanceCriteria: ['Answer the question.'],
    requiresVerification: false,
    evidenceTools: ['read'],
    answerOnly: true,
  }
  const initial = replaceHarnessPlan(make(), [step], now)
  const revised = replaceHarnessPlan(initial, [{ ...step, answerOnly: false }], now)
  assert.equal(revised.planRevision, initial.planRevision + 1)
  assert.equal(revised.plan[0]?.status, 'pending')
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
  state = recordHarnessEvidence(state, { id: 'source', kind: 'tool_result', source: 'read', summary: 'Read source', verdict: 'observed', createdAt: now }, now)
  state = recordHarnessEvidence(state, { id: 'report-source', kind: 'tool_result', source: 'read', summary: 'Report source', verdict: 'observed', createdAt: now }, now)
  state = transitionHarnessStep(state, { id: 'read', status: 'done', evidenceRefs: ['source'] }, now)
  state = transitionHarnessStep(state, { id: 'report', status: 'done', evidenceRefs: ['report-source'] }, now)
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

test('named child admission appends and assigns its synthetic milestone atomically', () => {
  const initial = make()
  const admitted = admitHarnessNamedChild(initial, child('workspace:delivery', 'ask:call:planner', 40), {
    title: 'Ask Planner',
    acceptanceCriteria: ['Planner returns a reply.'],
  }, now)
  assert.equal(initial.plan.length, 0)
  assert.equal(initial.children.length, 0)
  assert.deepEqual(admitted.plan, [{
    id: 'ask:call:planner',
    title: 'Ask Planner',
    dependsOn: [],
    acceptanceCriteria: ['Planner returns a reply.'],
    requiresVerification: false,
    evidenceTools: ['harness_read_child'],
    status: 'running',
    evidenceRefs: [],
    childRunId: 'workspace:delivery',
  }])
  assert.equal(admitted.children[0]?.id, 'workspace:delivery')
  assert.throws(() => admitHarnessNamedChild(admitted, child('workspace:other', 'ask:call:planner', 0), {
    title: 'Duplicate',
    acceptanceCriteria: ['Complete'],
  }, now), /milestone identity/)
})

test('settling a completed named child completes its milestone and leaves child-result evidence available', () => {
  const planned = replaceHarnessPlan(make(), [{
    id: 'report',
    title: 'Use the child result',
    dependsOn: [],
    acceptanceCriteria: ['Use the answer.'],
    requiresVerification: false,
    evidenceTools: ['harness_read_child'],
  }], now)
  const askStepId = 'ask:call:planner'
  const admitted = admitHarnessNamedChild(planned, child('child-1', askStepId, 0), {
    title: 'Ask Planner',
    acceptanceCriteria: ['Planner returns a reply.'],
  }, now + 1)
  const completedChild = finishHarness(childRunState(admitted, 'child-1', now + 2), now + 3, 'Agent answer.')
  const settled = settleHarnessChild(admitted, completedChild, now + 4)

  assert.equal(settled.plan.find(step => step.id === askStepId)?.status, 'done')
  assert.deepEqual(settled.plan.find(step => step.id === askStepId)?.evidenceRefs, [])
  assert.ok(!harnessCompletionIssues(settled).includes(`Milestone ${askStepId} is unfinished.`))
  assert.ok(harnessCompletionIssues(settled).includes('Milestone report is unfinished.'))
  assert.equal(settleHarnessChild(settled, completedChild, now + 5), settled)

  const withEvidence = recordHarnessEvidence(settled, {
    id: 'child-result:read-child',
    kind: 'tool_result',
    source: 'harness_read_child:child-1',
    summary: 'Agent answer.',
    verdict: 'observed',
    createdAt: now + 6,
  }, now + 6)
  const completed = transitionHarnessStep(withEvidence, {
    id: 'report',
    status: 'done',
    evidenceRefs: ['child-result:read-child'],
  }, now + 7)
  assert.equal(completed.plan.find(step => step.id === 'report')?.status, 'done')
  assert.deepEqual(completed.plan.find(step => step.id === askStepId)?.evidenceRefs, [])
})

for (const status of ['failed', 'cancelled'] as const) {
  test(`settling a ${status} named child skips its milestone with a reason`, () => {
    const askStepId = 'ask:call:planner'
    const admitted = admitHarnessNamedChild(make(), child('child-1', askStepId, 0), {
      title: 'Ask Planner',
      acceptanceCriteria: ['Planner returns a reply.'],
    }, now + 1)
    const endedChild = terminateHarness(childRunState(admitted, 'child-1', now + 2), status, 'Agent stopped before replying.', now + 3)
    const settled = settleHarnessChild(admitted, endedChild, now + 4)

    assert.equal(settled.plan.find(step => step.id === askStepId)?.status, 'skipped')
    assert.equal(settled.plan.find(step => step.id === askStepId)?.skipReason, `${status}: Agent stopped before replying.`)
  })
}

test('revising an attached named-child milestone inherits its evidenceTools', () => {
  const admitted = admitHarnessNamedChild(make(), child('workspace:delivery', 'ask:call:planner', 40), {
    title: 'Ask Planner',
    acceptanceCriteria: ['Planner returns a reply.'],
  }, now)
  const revised = replaceHarnessPlan(admitted, [{
    id: 'ask:call:planner',
    title: 'Ask Planner',
    dependsOn: [],
    acceptanceCriteria: ['Planner returns a reply.'],
    requiresVerification: false,
  }], now + 1)
  assert.equal(revised, admitted)
  assert.equal(revised.planRevision, admitted.planRevision)
  assert.deepEqual(revised.plan[0]?.evidenceTools, ['harness_read_child'])
  assert.equal(revised.plan[0]?.childRunId, 'workspace:delivery')
  assert.equal(revised.plan[0]?.status, 'running')
})

test('revising an attached delegated step merges its original evidenceTools', () => {
  const planned = replaceHarnessPlan(make(), [{
    id: 'delegate',
    title: 'Delegate the work',
    dependsOn: [],
    acceptanceCriteria: ['Child result read'],
    requiresVerification: false,
    evidenceTools: ['write', 'read'],
  }], now)
  const admitted = admitHarnessChild(planned, child('child-1', 'delegate', 0), now + 1)
  const revised = replaceHarnessPlan(admitted, [{
    id: 'delegate',
    title: 'Delegate the work',
    dependsOn: [],
    acceptanceCriteria: ['Child result read'],
    requiresVerification: false,
    evidenceTools: ['write', 'read'],
  }], now + 2)
  assert.equal(revised, admitted)
  assert.deepEqual(revised.plan[0]?.evidenceTools, ['write', 'read', 'harness_read_child'])
})

test('delegation preserves verification evidence for another milestone', () => {
  let state = replaceHarnessPlan(make(), [
    {
      id: 'delegate',
      title: 'Delegate the work',
      dependsOn: [],
      acceptanceCriteria: ['Child result read'],
      requiresVerification: false,
      evidenceTools: ['read'],
    },
    {
      id: 'verified',
      title: 'Check the result',
      dependsOn: [],
      acceptanceCriteria: ['Result independently checked'],
      requiresVerification: true,
      evidenceTools: ['read'],
    },
  ], now)
  state = recordHarnessEvidence(state, {
    id: 'verified-result',
    kind: 'tool_result',
    source: 'read',
    summary: 'Read the result',
    verdict: 'observed',
    createdAt: now + 1,
  }, now + 1)
  state = recordHarnessEvidence(state, {
    id: 'verification',
    kind: 'verification',
    source: 'check:verified',
    summary: 'The result is correct',
    verdict: 'passed',
    createdAt: now + 2,
    verification: { stepId: 'verified', planRevision: state.planRevision },
  }, now + 2)
  const planRevision = state.planRevision
  state = admitHarnessChild(state, child('child-1', 'delegate', 0), now + 3)
  assert.equal(state.planRevision, planRevision)
  state = transitionHarnessStep(state, {
    id: 'verified',
    status: 'done',
    evidenceRefs: ['verified-result', 'verification'],
  }, now + 4)
  assert.equal(state.plan.find(step => step.id === 'verified')?.status, 'done')
})

test('a requiresPlan delegated milestone completes with harness_read_child evidence', () => {
  const planned = replaceHarnessPlan(make(), [{
    id: 'delegate',
    title: 'Delegate the work',
    dependsOn: [],
    acceptanceCriteria: ['Child result read'],
    requiresVerification: false,
    evidenceTools: ['read'],
  }], now)
  const admitted = admitHarnessChild(planned, child('child-1', 'delegate', 0), now + 1)
  assert.deepEqual(admitted.plan[0]?.evidenceTools, ['read', 'harness_read_child'])
  const childRun = createHarnessSnapshot({
    runId: 'child-1',
    parentRunId: 'root',
    rootRunId: 'root',
    depth: 1,
    goal: 'Complete the delegated work',
    constraints: [],
    policy: { ...admitted.policy, allowedToolIds: ['read'], requiresPlan: false, maxCostMicros: 0 },
  }, now + 2)
  const completedChild = finishHarness(childRun, now + 3, 'Delegated result')
  const settled = settleHarnessChild(admitted, completedChild, now + 4)
  assert.deepEqual(settled.plan, admitted.plan)
  const evidence = recordHarnessEvidence(settled, {
    id: 'child-result',
    kind: 'tool_result',
    source: 'harness_read_child:child-1',
    summary: 'Child completed',
    verdict: 'observed',
    createdAt: now + 5,
  }, now + 5)
  const completed = transitionHarnessStep(evidence, {
    id: 'delegate',
    status: 'done',
    evidenceRefs: ['child-result'],
  }, now + 6)
  assert.equal(completed.plan[0]?.status, 'done')
})

test('named child admission enforces spending, depth, concurrency and plan size', () => {
  const step = { title: 'Ask agent', acceptanceCriteria: ['Receive the reply.'] }
  assert.throws(() => admitHarnessNamedChild(make(), child('expensive', 'ask:expensive', 101), step, now), /spending/)
  assert.throws(() => admitHarnessNamedChild({ ...make(), depth: 1 }, child('deep', 'ask:deep', 0), step, now), /depth/)
  assert.throws(() => admitHarnessNamedChild({
    ...make(),
    children: [child('first', 'first', 0), child('second', 'second', 0)],
  }, child('third', 'ask:third', 0), step, now), /concurrency/)
  const full = replaceHarnessPlan(make(), Array.from({ length: 128 }, (_, index) => ({
    id: `step-${index}`,
    title: `Step ${index}`,
    acceptanceCriteria: ['Complete the step.'],
    dependsOn: [],
    requiresVerification: false,
    evidenceTools: ['read'],
  })), now)
  assert.throws(() => admitHarnessNamedChild(full, child('full', 'ask:full', 0), step, now), /128/)
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
  assert.throws(() => finishHarness(worker, now, 'x'.repeat(8_001)), /result summary/)
  worker = finishHarness(worker, now, 'Checked the source records.')
  assert.throws(() => settleHarnessChild(state, { ...worker, policy: { ...worker.policy, actorUserId: 'other' } }, now), /authority/)
  assert.throws(() => settleHarnessChild(state, {
    ...worker, policy: { ...worker.policy, allowedToolIds: ['read', 'write', 'admin'] },
  }, now), /authority/)
  assert.throws(() => settleHarnessChild(state, {
    ...worker, policy: { ...worker.policy, maxCostMicros: 61 },
  }, now), /authority/)
  state = settleHarnessChild(state, worker, now)
  assert.equal(state.usage.costMicros, 40)
  assert.equal(state.children[0]?.summary, 'Checked the source records.')
  assert.equal(settleHarnessChild(state, worker, now), state)
  assertHarnessRunnable(state, now, 60)
  assert.throws(() => assertHarnessRunnable(state, now, 61), /spending/)
})

test('child receipts reserve only unspent budget, join without double counting, and reconcile after cancellation', () => {
  let parent = admitHarnessChild(replaceHarnessPlan(make(), steps, now), child('first', 'read', 60), now)
  const receipt: HarnessReceipt = {
    id: 'child-call', modelId: 'model', provider: 'provider', inputTokens: 100, outputTokens: 10,
    reasoningTokens: 2, cacheReadTokens: 80, cacheWriteTokens: 5, contextWindow: 1_000, costMicros: 40,
  }
  const parentReceipt = { ...receipt, id: 'parent-call', inputTokens: 200, costMicros: 10 }
  parent = recordHarnessReceipt(parent, parentReceipt, now)
  const previous = parent
  parent = recordHarnessChildReceipt(parent, 'first', receipt, now)
  assert.equal(previous.children[0]!.accountedUsage, undefined)
  assert.equal(parent.usage.costMicros, 50)
  assert.equal(parent.usage.inputTokens, 300)
  assert.equal(parent.latestReceipt!.id, 'parent-call')
  assert.equal(parent.progressRevision, previous.progressRevision)
  assertHarnessRunnable(parent, now, 30)
  assert.throws(() => assertHarnessRunnable(parent, now, 31), /spending/)

  let worker = createHarnessSnapshot({ runId: 'first', parentRunId: 'root', rootRunId: 'root', depth: 1,
    goal: 'Read source', constraints: [], policy: { ...parent.policy, requiresPlan: false, maxCostMicros: 60 },
  }, now)
  worker.policy.allowedToolIds = ['read']
  worker = finishHarness(recordHarnessReceipt(worker, receipt, now), now)
  parent = settleHarnessChild(parent, worker, now)
  assert.equal(parent.usage.costMicros, 50)
  assert.equal(parent.usage.inputTokens, 300)
  assert.equal(parent.usage.cacheReadTokens, 160)
  assert.equal(parent.usage.reasoningTokens, 4)
  assertHarnessRunnable(parent, now, 50)

  parent = terminateHarness(parent, 'cancelled', 'Stopped by user', now)
  const settled = parent
  parent = recordHarnessChildReceipt(parent, 'first', { ...receipt, id: 'late', costMicros: 5 }, now)
  assert.equal(parent.status, 'cancelled')
  assert.equal(parent.usage.costMicros, 55)
  assert.equal(parent.usage.inputTokens, 400)
  assert.equal(parent.children[0]!.costMicros, 45)
  assert.equal(settled.children[0]!.costMicros, 40)
  assert.equal(settled.children[0]!.accountedUsage!.costMicros, 40)
  assert.equal(parent.latestReceipt!.id, 'parent-call')
})

test('reconciliation does not let child overspend create a negative reservation', () => {
  let parent = admitHarnessChild(replaceHarnessPlan(make(), steps, now), child('first', 'read', 60), now)
  parent = recordHarnessChildReceipt(parent, 'first', {
    id: 'overrun', modelId: 'model', provider: 'provider', inputTokens: 1, outputTokens: 1,
    reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 70,
  }, now)
  assertHarnessRunnable(parent, now, 30)
  assert.throws(() => assertHarnessRunnable(parent, now, 31), /spending/)
})

test('plan-optional runs still require evidence for non-answer milestones and may omit evidenceTools', () => {
  const base = make()
  let state = { ...base, policy: { ...base.policy, requiresPlan: false } }
  state = replaceHarnessPlan(state, [{ id: 'read', title: 'Read', dependsOn: [], acceptanceCriteria: ['Read'], requiresVerification: false }], now)
  assert.throws(() => transitionHarnessStep(state, { id: 'read', status: 'done' }, now), /Completion requires evidence/)
  state = recordHarnessEvidence(state, { id: 'artifact', kind: 'artifact', source: 'export', summary: 'Saved result', verdict: 'observed', createdAt: now }, now)
  state = transitionHarnessStep(state, { id: 'read', status: 'done', evidenceRefs: ['artifact'] }, now)
  assert.equal(state.plan[0]?.status, 'done')
})

test('plan-optional action milestones may share a tool result', () => {
  const base = make()
  const planOptional = { ...base, policy: { ...base.policy, requiresPlan: false } }
  let state = replaceHarnessPlan(planOptional, [
    { id: 'first', title: 'First action', dependsOn: [], acceptanceCriteria: ['First done'], requiresVerification: false },
    { id: 'second', title: 'Second action', dependsOn: [], acceptanceCriteria: ['Second done'], requiresVerification: false },
  ], now)
  state = recordHarnessEvidence(state, {
    id: 'read-result', kind: 'tool_result', source: 'read', summary: 'Read result', verdict: 'observed', createdAt: now,
  }, now)
  state = transitionHarnessStep(state, { id: 'first', status: 'done', evidenceRefs: ['read-result'] }, now)
  state = transitionHarnessStep(state, { id: 'second', status: 'done', evidenceRefs: ['read-result'] }, now)
  assert.deepEqual(state.plan.map(step => step.status), ['done', 'done'])
})

test('requires evidenceTools for action milestones and validates their tool IDs', () => {
  assert.throws(() => replaceHarnessPlan(make(), [{
    id: 'create', title: 'Create a note', dependsOn: [], acceptanceCriteria: ['Note created'], requiresVerification: false,
  }], now), /Milestone "create" must declare evidenceTools/)
  assert.throws(() => replaceHarnessPlan(make(), [{
    id: 'create', title: 'Create a note', dependsOn: [], acceptanceCriteria: ['Note created'], requiresVerification: false,
    evidenceTools: ['harness_set_plan'],
  }], now), /Milestone "create" lists unsupported evidence tool "harness_set_plan"/)
  const answer = replaceHarnessPlan(make(), [{
    id: 'answer', title: 'Answer from knowledge', dependsOn: [], acceptanceCriteria: ['Answer'], requiresVerification: false,
    answerOnly: true,
  }], now)
  assert.equal(answer.plan[0]?.evidenceTools, undefined)
})

test('action milestones require cited tool results from their declared evidence tools', () => {
  const state = replaceHarnessPlan({
    ...make(),
    policy: { ...make().policy, allowedToolIds: ['create_note', 'get_note'] },
  }, [{
    id: 'create', title: 'Create a note', dependsOn: [], acceptanceCriteria: ['Note created'], requiresVerification: false,
    evidenceTools: ['create_note'],
  }], now)
  const readResult = recordHarnessEvidence(state, {
    id: 'read-note', kind: 'tool_result', source: 'get_note', summary: 'Read another note', verdict: 'observed', createdAt: now,
  }, now)
  assert.throws(() => transitionHarnessStep(readResult, {
    id: 'create', status: 'done', evidenceRefs: ['read-note'],
  }, now), /evidenceTools/)
  const createResult = recordHarnessEvidence(readResult, {
    id: 'created-note', kind: 'tool_result', source: 'create_note', summary: 'Created the requested note', verdict: 'observed', createdAt: now,
  }, now)
  assert.equal(transitionHarnessStep(createResult, {
    id: 'create', status: 'done', evidenceRefs: ['created-note'],
  }, now).plan[0]?.status, 'done')
})

test('one tool-result observation supports one action milestone, while answer-only may reuse it', () => {
  const plan: HarnessPlanInput[] = [
    { id: 'first', title: 'First action', dependsOn: [], acceptanceCriteria: ['First action done'], requiresVerification: false, evidenceTools: ['read'] },
    { id: 'second', title: 'Second action', dependsOn: [], acceptanceCriteria: ['Second action done'], requiresVerification: false, evidenceTools: ['read'] },
  ]
  const initial = replaceHarnessPlan(make(), plan, now)
  const readEvidence = recordHarnessEvidence(initial, {
    id: 'read-result', kind: 'tool_result', source: 'read', summary: 'Read a note', verdict: 'observed', createdAt: now,
  }, now)
  const afterFirst = transitionHarnessStep(readEvidence, {
    id: 'first', status: 'done', evidenceRefs: ['read-result'],
  }, now)
  assert.throws(() => transitionHarnessStep(afterFirst, {
    id: 'second', status: 'done', evidenceRefs: ['read-result'],
  }, now), /Evidence from a tool result already supports another milestone/)
  const answerPlan = replaceHarnessPlan(afterFirst, [...plan, {
    id: 'answer', title: 'Summarize', dependsOn: ['first'], acceptanceCriteria: ['Summary returned'],
    requiresVerification: false, answerOnly: true,
  }], now)
  assert.equal(transitionHarnessStep(answerPlan, {
    id: 'answer', status: 'done', evidenceRefs: ['read-result'],
  }, now).plan[0]?.status, 'done')
})

test('cancelled runs accept late tool results without advancing progress', () => {
  const cancelled = terminateHarness(make(), 'cancelled', 'Stopped by the user.', now)
  const evidence: HarnessEvidence = {
    id: 'tool:call-1', kind: 'tool_result', source: 'create_note',
    summary: 'Created the note.', verdict: 'observed', createdAt: now,
  }
  const recorded = recordHarnessEvidence(cancelled, evidence, now + 1)
  assert.equal(recorded.status, 'cancelled')
  assert.equal(recorded.terminalReason, cancelled.terminalReason)
  assert.equal(recorded.revision, cancelled.revision + 1)
  assert.equal(recorded.progressRevision, cancelled.progressRevision)
  assert.deepEqual(recorded.evidence, [evidence])
  assert.equal(recordHarnessEvidence(recorded, { ...evidence, createdAt: now + 2 }, now + 2), recorded)

  for (const kind of ['verification', 'user_input'] as const) {
    assert.throws(() => recordHarnessEvidence(cancelled, {
      ...evidence, id: `${kind}-late`, kind,
    }, now + 1), /The run is terminal/)
  }
  const completed = { ...make(), status: 'completed' as const }
  const failed = terminateHarness(make(), 'failed', 'The run failed.', now)
  for (const terminal of [completed, failed]) {
    assert.throws(() => recordHarnessEvidence(terminal, evidence, now + 1), /The run is terminal/)
  }
})

test('harness_read_child evidence matches its declared tool ID', () => {
  const planned = replaceHarnessPlan(make(), [{
    id: 'delegate', title: 'Join delegated work', dependsOn: [], acceptanceCriteria: ['Child result read'],
    requiresVerification: false, evidenceTools: ['harness_read_child'],
  }], now)
  const evidence = recordHarnessEvidence(planned, {
    id: 'child-result', kind: 'tool_result', source: 'harness_read_child:child-1',
    summary: 'Child completed', verdict: 'observed', createdAt: now,
  }, now)
  assert.equal(transitionHarnessStep(evidence, {
    id: 'delegate', status: 'done', evidenceRefs: ['child-result'],
  }, now).plan[0]?.status, 'done')
})
