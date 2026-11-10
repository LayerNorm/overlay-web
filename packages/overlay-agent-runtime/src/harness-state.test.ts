import assert from 'node:assert/strict'
import test from 'node:test'
import {
  admitHarnessChild, admitHarnessNamedChild, assertHarnessRunnable, blockHarness, checkpointHarness, createHarnessSnapshot,
  currentHarnessContext, finishHarness, harnessCompletionIssues, recordHarnessEvidence, recordHarnessReceipt, recordHarnessChildReceipt,
  replaceHarnessPlan, settleHarnessChild, terminateHarness, transitionHarnessStep, type HarnessChild, type HarnessEvidence,
  type HarnessPlanInput, type HarnessReceipt,
  claimHarnessExecution, hasRunnableHarnessMilestones, waitForHarnessChildren, resumeHarness, recordHarnessDiagnostic,
  reserveHarnessModel,
  bindHarnessModelDispatch,
  validateHarnessReceipt,
  recordHarnessVerification,
  setHarnessCompaction,
  pauseHarnessForAuthorization,
  pauseHarnessForFunding, resumeHarnessFunding,
} from './harness-state'
import { createHarnessDiagnostic } from './harness-diagnostic'

const now = 1_000

test('a rejection receipt cannot conceal consumed tokens or unknown costs', () => {
  const receipt: HarnessReceipt = { id: 'rejected', modelId: 'model', provider: 'overlay-admission', inputTokens: 0, outputTokens: 0,
    reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 0, costSource: 'catalog', rejectionReason: 'budget' }
  for (const rejectionReason of ['budget', 'model_unavailable', 'route_capacity', 'route_interrupted', 'route_unavailable', 'summary_failed'] as const) {
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

test('compaction transitions are replay-safe and never replace an unrelated reservation', () => {
  let state = make()
  const started = { cycleId: 'summary:r1', attemptId: 'summary:r1', status: 'started' as const, retryCount: 0, updatedAt: now }
  state = setHarnessCompaction(state, started, now)
  assert.equal(setHarnessCompaction(state, started, now), state)
  assert.throws(() => setHarnessCompaction({
    ...state, modelReservation: { id: 'response:r1', maxCostMicros: 1 },
  }, { ...started, cycleId: 'summary:r2', attemptId: 'summary:r2' }, now), /unrelated model reservation/)
  const interrupted = { ...started, status: 'interrupted' as const, failureReason: 'stream_aborted' as const, updatedAt: now + 1 }
  state = setHarnessCompaction(state, interrupted, now + 1)
  state = setHarnessCompaction(state, {
    cycleId: started.cycleId, attemptId: 'summary:r1:retry:1', status: 'started', retryCount: 1, updatedAt: now + 2,
  }, now + 2)
  assert.equal(state.compaction?.retryCount, 1)
})

test('a successful summary receipt keeps its attempt active until validated completion', () => {
  const attempt = { cycleId: 'summary:success', attemptId: 'summary:success', status: 'started' as const, retryCount: 0, updatedAt: now }
  let state = setHarnessCompaction(make(), attempt, now)
  state = reserveHarnessModel(state, attempt.attemptId, 0, now)
  state = recordHarnessReceipt(state, {
    id: attempt.attemptId, modelId: 'model', provider: 'provider', inputTokens: 1, outputTokens: 1,
    reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 1,
  }, now + 1)
  assert.equal(state.modelReservation, undefined)
  assert.equal(state.compaction?.status, 'started')
  state = setHarnessCompaction(state, { ...attempt, status: 'completed', updatedAt: now + 2 }, now + 2)
  assert.equal(state.compaction?.status, 'completed')
})

test('a matching late free summary receipt reconciles the stored cycle before its single retry', () => {
  let state = make()
  const cycleId = 'summary:cycle'
  const attemptId = cycleId
  state = setHarnessCompaction(state, {
    cycleId, attemptId, status: 'started', retryCount: 0, updatedAt: now,
  }, now)
  state = reserveHarnessModel(state, attemptId, 0, now)
  state = bindHarnessModelDispatch(state, attemptId, {
    modelId: 'openrouter/free', billingReservationId: null,
  }, now)
  state = setHarnessCompaction(state, {
    cycleId, attemptId, status: 'awaiting_reconciliation', retryCount: 0,
    failureReason: 'hold_unsettled', updatedAt: now + 1,
  }, now + 1)
  const receipt: HarnessReceipt = {
    id: attemptId, modelId: 'openrouter/free', provider: 'overlay-free-router',
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    contextWindow: null, costMicros: 0, costSource: 'catalog', rejectionReason: 'summary_failed',
  }
  const reconciled = recordHarnessReceipt(state, receipt, now + 2)
  assert.equal(reconciled.compaction?.status, 'interrupted')
  assert.equal(recordHarnessReceipt(reconciled, receipt, now + 3), reconciled)
  state = setHarnessCompaction(reconciled, {
    cycleId, attemptId: `${cycleId}:retry:1`, status: 'started', retryCount: 1, updatedAt: now + 4,
  }, now + 4)
  state = setHarnessCompaction(state, {
    cycleId, attemptId: `${cycleId}:retry:1`, status: 'interrupted', retryCount: 1,
    failureReason: 'provider_error', updatedAt: now + 5,
  }, now + 5)
  assert.throws(() => setHarnessCompaction(state, {
    cycleId, attemptId: `${cycleId}:retry:2`, status: 'started', retryCount: 2, updatedAt: now + 6,
  }, now + 6), /Invalid compaction attempt/)
})

test('paid or billing-bound inference cannot be reconciled as a free verifier failure', () => {
  let state = reserveHarnessModel(make(), 'verification:1', 0, now)
  state = bindHarnessModelDispatch(state, 'verification:1', {
    modelId: 'openrouter/free', billingReservationId: 'billing-hold',
  }, now)
  const receipt: HarnessReceipt = {
    id: 'verification:1', modelId: 'openrouter/free', provider: 'overlay-free-router',
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    contextWindow: null, costMicros: 0, costSource: 'catalog', rejectionReason: 'verification_failed',
  }
  assert.throws(() => recordHarnessReceipt(state, receipt, now + 1), /exact zero-cost unbilled free hold/)
  assert.equal(state.modelReservation?.id, 'verification:1')
})

test('final verification is bound to current plan and evidence progress', () => {
  let state = make()
  state = recordHarnessEvidence(state, {
    id: 'tool:read:1', kind: 'tool_result', source: 'read_document', summary: 'Read revision r1.',
    verdict: 'observed', createdAt: now,
  }, now)
  const verification = {
    attemptId: 'segment:1',
    candidateDigest: 'digest', planRevision: state.planRevision, evidenceRevision: state.progressRevision,
    supported: true, reason: 'Supported by the saved read.', evidenceIds: ['tool:read:1'], attempts: 1, createdAt: now,
  }
  state = recordHarnessVerification(state, verification, now)
  assert.equal(recordHarnessVerification(state, verification, now), state)
  assert.throws(() => recordHarnessVerification(state, { ...verification, evidenceRevision: 0 }, now), /does not match/)
  assert.throws(() => recordHarnessVerification(state, { ...verification, evidenceIds: ['other'] }, now), /does not match/)
})

test('workspace funding pauses preserve fractional cents and resume the same task', () => {
  const initial = make()
  const state = { ...initial, policy: { ...initial.policy, executionPolicyVersion: 2 as const, spendingMode: 'workspace' as const } }
  const pause = { reason: 'disabled' as const, receiptId: 'model:0', requiredCents: 38.96, availableCents: 0.98, reservedCents: 0.02 }
  const paused = pauseHarnessForFunding(state, pause, now)
  assert.equal(paused.status, 'waiting_for_resources')
  assert.deepEqual(paused.resourcePause, pause)
  const resumed = resumeHarnessFunding(paused, now + 1)
  assert.equal(resumed.runId, state.runId)
  assert.equal(resumed.status, 'running')
  assert.equal(resumed.resourcePause, undefined)
  for (const field of ['requiredCents', 'availableCents', 'reservedCents'] as const) {
    for (const invalid of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => pauseHarnessForFunding(state, { ...pause, [field]: invalid }, now), /Invalid workspace funding pause/)
    }
  }
  assert.throws(() => pauseHarnessForFunding(state, { ...pause, requiredCents: 0 }, now), /Invalid workspace funding pause/)
})

test('historical route rejection receipts do not grant route-recovery state', () => {
  const state = recordHarnessReceipt(make(), {
    id: 'model:legacy',
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
  assert.equal(state.latestReceipt?.rejectionReason, 'route_interrupted')
  assert.equal(state.modelRecovery, undefined)
})

test('generic block and resume cannot bypass a resource pause', () => {
  const paused = { ...make(), status: 'waiting_for_resources' as const, resourceRequestToken: 'resource-token' }
  assert.throws(() => resumeHarness(paused, now), /resource pause/)
  assert.throws(() => blockHarness(paused, { kind: 'input', question: 'Continue?' }, now), /resource pause/)
})

test('explicit task-deadline pause is persisted, nonterminal, and cannot resume through ordinary input', () => {
  const deadlineAt = now + 1
  const state = createHarnessSnapshot({
    runId: 'deadline-root', goal: 'Finish the task', constraints: [],
    policy: {
      actorUserId: 'user', workspaceId: 'workspace', allowedToolIds: ['read'],
      requiresPlan: false, deadlineAt: deadlineAt + 86_400_000, taskDeadlineAt: deadlineAt,
      maxCostMicros: 0, maxParallelChildren: 0, maxDepth: 0,
      executionPolicyVersion: 2, spendingMode: 'workspace',
    },
  }, now)
  const paused = pauseHarnessForAuthorization(state, deadlineAt)
  assert.equal(paused.status, 'waiting_for_authorization')
  assert.deepEqual(paused.authorizationPause, {
    reason: 'task_deadline_expired', deadlineAt, pausedAt: deadlineAt,
  })
  assert.equal('requiredCents' in paused.authorizationPause!, false)
  assert.throws(() => resumeHarness(paused, deadlineAt + 1), /cannot be resumed/)
  assert.throws(() => claimHarnessExecution(paused, 'successor', deadlineAt + 1), /cannot be claimed/)
  assert.equal(paused.status === 'completed' || paused.status === 'failed' || paused.status === 'cancelled', false)
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

test('workspace-funded roots and children settle usage beyond legacy allocations', () => {
  let parent = make()
  parent.policy.workspaceId = 'workspace'
  parent.policy.executionPolicyVersion = 2
  parent.policy.spendingMode = 'workspace'
  parent.policy.maxCostMicros = 0
  parent = replaceHarnessPlan(parent, steps, now)
  parent = admitHarnessChild(parent, child('first', 'read', 0), now)
  const receipt = (id: string, costMicros: number): HarnessReceipt => ({
    id, modelId: 'provider/model', provider: 'provider', inputTokens: 1, outputTokens: 1,
    reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null,
    costMicros, costSource: 'provider',
  })
  parent = recordHarnessReceipt(parent, receipt('root:receipt', 1_100_000), now)
  let worker = childRunState(parent, 'first', now)
  worker = recordHarnessReceipt(worker, receipt('child:receipt', 300_000), now)
  worker = finishHarness(worker, now, 'Child completed.')
  parent = settleHarnessChild(parent, worker, now)
  assert.equal(parent.usage.costMicros, 1_400_000)
  assert.equal(parent.children[0]?.costMicros, 300_000)
})

test('model dispatch binds once to its zero-cost marker', () => {
  const reserved = reserveHarnessModel(make(), 'receipt', 0, now)
  const dispatch = { modelId: 'provider/model', billingReservationId: 'billing-reservation' }
  const bound = bindHarnessModelDispatch(reserved, 'receipt', dispatch, now)
  assert.equal(reserved.modelReservation?.dispatch, undefined)
  assert.deepEqual(bound.modelReservation?.dispatch, dispatch)
  assert.deepEqual(bound.modelReservation, { id: 'receipt', maxCostMicros: 0, dispatch })
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

test('a dispatch marker holds no money and never limits delegation or later calls', () => {
  let state = replaceHarnessPlan(make(), steps, now)
  state = reserveHarnessModel(state, 'model:0', 0, now)
  assert.equal(reserveHarnessModel(state, 'model:0', 0, now), state)
  assert.throws(() => reserveHarnessModel(state, 'model:0', 60, now), /Invalid model reservation/)
  assert.throws(() => reserveHarnessModel(state, 'model:1', 0, now), /Reconcile/)
  state = admitHarnessChild(state, child('first', 'read', 1_000), now)
  assert.equal(state.children[0]?.maxCostMicros, 0)
  state = recordHarnessReceipt(state, { id: 'model:0', modelId: 'model', provider: 'provider', inputTokens: 1,
    outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null, costMicros: 5_000,
  }, now)
  assert.equal(state.modelReservation, undefined)
  assert.equal(state.usage.costMicros, 5_000)
  assertHarnessRunnable(state, now)
})

test('a cancelled child retains its unresolved model liability until the matching receipt arrives', () => {
  const parent = admitHarnessChild(replaceHarnessPlan(make(), steps, now), child('first', 'read', 60), now)
  let worker = createHarnessSnapshot({ runId: 'first', rootRunId: 'root', parentRunId: 'root', depth: 1,
    goal: 'Read source', constraints: [], policy: { ...parent.policy, allowedToolIds: ['read'], requiresPlan: false, maxCostMicros: 60 },
  }, now)
  worker = reserveHarnessModel(worker, 'model:0', 0, now)
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
  assertHarnessRunnable(settled, now)
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

test('a step is done when marked done, once its dependencies are complete', () => {
  let state = replaceHarnessPlan(make(), steps, now)
  assert.throws(() => finishHarness(state, now), /unfinished/)
  assert.throws(() => transitionHarnessStep(state, { id: 'report', status: 'done' }, now), /Dependencies/)
  state = transitionHarnessStep(state, { id: 'read', status: 'done' }, now)
  state = transitionHarnessStep(state, { id: 'report', status: 'done' }, now)
  assert.equal(finishHarness(state, now).status, 'completed')
  assert.equal(state.status, 'running')
})

test('settled completion does not require new time authorization, and spending never blocks', () => {
  const initial = make()
  const running = { ...initial, policy: { ...initial.policy, requiresPlan: false } }
  const reserved = reserveHarnessModel(running, 'final-call', 0, now)
  const settled = recordHarnessReceipt(reserved, {
    id: 'final-call', modelId: 'model', provider: 'provider', inputTokens: 10, outputTokens: 1,
    reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: null,
    costMicros: running.policy.maxCostMicros + 1,
  }, now)
  for (const at of [now, settled.policy.deadlineAt, settled.policy.deadlineAt + 1]) {
    // Spending above the old per-task allowance never blocks; only the deadline does.
    if (at >= settled.policy.deadlineAt) assert.throws(() => assertHarnessRunnable(settled, at), /exhausted/)
    else assertHarnessRunnable(settled, at)
    const finished = finishHarness(settled, at, 'The result is complete.')
    assert.equal(finished.status, 'completed')
    assert.equal(finished.resultSummary, 'The result is complete.')
    assert.deepEqual(finished.policy, settled.policy)
    assert.deepEqual(finished.usage, settled.usage)
    assert.equal(finished.modelReservation, undefined)
  }
})

test('expired authorization cannot bypass completion blockers or unresolved holds', () => {
  const initial = make()
  const running = { ...initial, policy: { ...initial.policy, requiresPlan: false } }
  const at = running.policy.deadlineAt + 1
  const reserved = reserveHarnessModel(running, 'unresolved', 0, now)
  assert.throws(() => finishHarness(reserved, at), /reconciliation/)
  assert.equal(finishHarness(make(), at).status, 'completed')
  const blocked = blockHarness(running, { kind: 'input', question: 'Which result?' }, now)
  assert.throws(() => finishHarness(blocked, at), /blocker/)
  assert.throws(() => finishHarness({ ...running, status: 'waiting_for_resources', resourceRequestToken: 'pending' }, at), /not running/)
  assert.throws(() => finishHarness({ ...running, children: [child('pending', 'step', 0)] }, at), /Child work/)
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    assert.throws(() => finishHarness({ ...running, status }, at), /terminal/)
  }
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

test('continuation checkpoint keeps model narrative separate from authoritative summary', () => {
  let state = make()
  state = checkpointHarness(state, 'Authoritative checkpoint', now, 'continuation', 'Unverified model narrative.')
  assert.equal(state.workingSummary, 'Authoritative checkpoint')
  assert.equal(state.unverifiedNarrative, 'Unverified model narrative.')
  state = checkpointHarness(state, 'Compacted context', now, 'compaction')
  assert.equal(state.unverifiedNarrative, 'Compacted context')
})

test('telemetry is not progress and compaction does not count as continuation stagnation', () => {
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
  assert.equal(state.status, 'running')
  assert.equal(state.stalledContinuations, 2)
  const continuations = state.continuations
  state = checkpointHarness(state, 'Compacted context', now, 'compaction')
  state = checkpointHarness(state, 'Compacted context again', now, 'compaction')
  assert.equal(state.status, 'running')
  assert.equal(state.continuations, continuations)
  assert.equal(state.stalledContinuations, 2)
  assert.equal(state.progressRevision, 0)
})

test('child admission enforces capabilities, concurrency and depth, but no spending split', () => {
  let state = replaceHarnessPlan(make(), [...steps.map(step => ({ ...step, dependsOn: [] })), { ...steps[0]!, id: 'extra' }], now)
  assert.throws(() => admitHarnessChild(state, { ...child('bad', 'read', 1), allowedToolIds: ['admin'] }, now), /capabilities/)
  state = admitHarnessChild(state, child('first', 'read', 60), now)
  state = admitHarnessChild(state, child('second', 'report', 1_000), now)
  assert.throws(() => admitHarnessChild(state, child('third', 'extra', 0), now), /concurrency/)
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

test('revising an attached named-child milestone keeps its child', () => {
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
  assert.equal(revised.plan[0]?.childRunId, 'workspace:delivery')
  assert.equal(revised.plan[0]?.status, 'running')
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

test('named child admission enforces depth, concurrency and plan size, but no spending split', () => {
  const step = { title: 'Ask agent', acceptanceCriteria: ['Receive the reply.'] }
  assert.equal(admitHarnessNamedChild(make(), child('large', 'ask:large', 1_000), step, now).children[0]?.maxCostMicros, 0)
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

test('joining a child charges usage once and preserves authority', () => {
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
  state = settleHarnessChild(state, worker, now)
  assert.equal(state.usage.costMicros, 40)
  assert.equal(state.children[0]?.summary, 'Checked the source records.')
  assert.equal(settleHarnessChild(state, worker, now), state)
  assertHarnessRunnable(state, now)
})

test('child receipts join without double counting and reconcile after cancellation', () => {
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
  assertHarnessRunnable(parent, now)

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
  assertHarnessRunnable(parent, now)

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

test('a delegated step completes once its child has finished', () => {
  const planned = replaceHarnessPlan(make(), [{
    id: 'delegate', title: 'Delegate the work', dependsOn: [], acceptanceCriteria: ['Child result read'], requiresVerification: false,
  }], now)
  const admitted = admitHarnessChild(planned, child('child-1', 'delegate', 0), now + 1)
  assert.throws(() => transitionHarnessStep(admitted, { id: 'delegate', status: 'done' }, now + 2), /has not completed/)
  const childRun = createHarnessSnapshot({
    runId: 'child-1', parentRunId: 'root', rootRunId: 'root', depth: 1, goal: 'Complete the delegated work', constraints: [],
    policy: { ...admitted.policy, allowedToolIds: ['read'], requiresPlan: false, maxCostMicros: 0 },
  }, now + 2)
  const settled = settleHarnessChild(admitted, finishHarness(childRun, now + 3, 'Delegated result'), now + 4)
  assert.equal(transitionHarnessStep(settled, { id: 'delegate', status: 'done' }, now + 5).plan[0]?.status, 'done')
})

test('a run without a plan can finish, whatever its stored policy says', () => {
  assert.equal(finishHarness(make(), now, 'Paris.').status, 'completed')
  assert.equal(hasRunnableHarnessMilestones(make()), false)
})
