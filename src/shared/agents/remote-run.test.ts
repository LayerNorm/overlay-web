import assert from 'node:assert/strict'
import test from 'node:test'
import { reduceRemoteRun, remoteRunCoarseStatus, type RemoteRunState, type RemoteRunFact } from './remote-run'
const state = (): RemoteRunState => ({ version: 2, revision: 0, phase: 'running', currentAttemptId: 'attempt', executionGeneration: 1, coordinatorGeneration: 1, coordinatorId: 'owner', hardDeadlineAt: 86_400_000, claimDeadlineAt: 120_000 })
function apply(s: RemoteRunState, f: RemoteRunFact, now = 1000) {
  return reduceRemoteRun(s, s.revision, { attemptId: s.currentAttemptId, executionGeneration: s.executionGeneration, coordinatorGeneration: s.coordinatorGeneration }, f, now)
}
test('healthy approval wait beyond 15 minutes survives text and observation; deadline never resets', () => {
  let s = apply(state(), { type: 'request', requestKey: 'clone', kind: 'permission', expiresAt: 3_600_000 }).state
  for (let now = 30_000; now <= 1_200_000; now += 30_000) {
    s = apply(s, { type: 'health', process: 'live' }, now).state
    s = apply(s, { type: 'progress' }, now).state
    s = apply(s, { type: 'observe' }, now).state
    assert.equal(s.phase, 'waiting_for_approval')
  }
  s = apply(s, { type: 'decision', requestKey: 'clone', decision: 'allow' }, 1_200_001).state
  assert.equal(s.phase, 'waiting_for_approval')
  assert.equal(apply(s, { type: 'decision', requestKey: 'clone', decision: 'allow' }).applied, false)
  s = apply(s, { type: 'decision_delivered', requestKey: 'clone' }).state
  assert.equal(apply(s, { type: 'complete' }).state.phase, 'completed')
  assert.equal(s.hardDeadlineAt, 86_400_000)
})
test('duplicate coordinators and stale revisions/attempts are fenced', () => {
  const s = state()
  assert.equal(apply(s, { type: 'claim_coordinator', coordinatorId: 'loser' }).reason, 'stale_owner')
  assert.equal(reduceRemoteRun(s, 9, { attemptId: 'attempt', executionGeneration: 1, coordinatorGeneration: 1 }, { type: 'complete' }, 1).reason, 'stale_revision')
  assert.equal(reduceRemoteRun(s, 0, { attemptId: 'old', executionGeneration: 1, coordinatorGeneration: 1 }, { type: 'complete' }, 1).reason, 'stale_attempt')
})
test('cancel races fence approvals, recovery, wake and completion until confirmed stopped', () => {
  let s = apply(state(), { type: 'cancel', cause: 'user' }).state
  for (const f of [{ type: 'complete' }, { type: 'wake' }, { type: 'recover', recoveryOutcome: 'attached_live' }, { type: 'decision', requestKey: 'x', decision: 'allow' }] as RemoteRunFact[]) {
    assert.equal(apply(s, f).state.phase, 'cancelling')
  }
  s = apply(s, { type: 'stopped' }).state
  assert.equal(s.phase, 'cancelled')
  assert.equal(apply(s, { type: 'complete' }).reason, 'terminal')
})
test('unknown process / uncertain old writer requires attention without replacement', () => {
  assert.equal(apply(state(), { type: 'health', process: 'unknown' }).state.phase, 'needs_attention')
  for (const recoveryOutcome of ['requires_new_attempt', 'unavailable', 'restored'] as const) {
    assert.equal(apply(state(), { type: 'recover', recoveryOutcome }).state.phase, 'needs_attention')
  }
})
test('process loss invalidates executable approval and restore cannot reuse it', () => {
  const waiting = apply(state(), { type: 'request', requestKey: 'x', kind: 'permission', expiresAt: 99_000 }).state
  const lost = apply(waiting, { type: 'health', process: 'lost' }).state
  assert.equal(lost.approval, undefined)
  assert.equal(lost.cause, 'approval_context_lost')
  assert.equal(apply(lost, { type: 'decision', requestKey: 'x', decision: 'allow' }).applied, false)
  const recovering = apply(lost, { type: 'recovery_requested' }).state
  assert.equal(apply(recovering, { type: 'request', requestKey: 'x', kind: 'permission', expiresAt: 99_000 }).applied, false)
  const attached = apply(recovering, { type: 'recover', recoveryOutcome: 'attached_live' }).state
  assert.equal(apply(attached, { type: 'request', requestKey: 'new-context', kind: 'permission', expiresAt: 99_000 }).state.phase, 'waiting_for_approval')
})
test('hard and approval deadlines fail closed and coarse status is consistent', () => {
  const s = state()
  assert.equal(apply(s, { type: 'complete' }, s.hardDeadlineAt).state.phase, 'cancelling')
  assert.equal(remoteRunCoarseStatus('waiting_for_input'), 'waiting_for_approval')
  assert.equal(remoteRunCoarseStatus('needs_attention'), 'running')
})

test('overlapping approval and input decisions wait for each delivery and cannot mutate the previous state', () => {
  const first = apply(state(), { type: 'request', requestKey: 'write', kind: 'permission', expiresAt: 99_000 }).state
  let s = apply(first, { type: 'request', requestKey: 'branch', kind: 'elicitation', expiresAt: 99_000 }).state
  s = apply(s, { type: 'decision', requestKey: 'write', decision: 'allow' }).state
  s = apply(s, { type: 'decision_delivered', requestKey: 'write' }).state
  assert.equal(first.approval?.decision, undefined)
  assert.equal(s.phase, 'waiting_for_input')
  assert.equal(s.approval?.requestKey, 'branch')
  assert.equal(apply(s, { type: 'complete' }).applied, false)
  assert.equal(apply(s, { type: 'decision_delivered', requestKey: 'write' }).applied, false)
  s = apply(s, { type: 'decision', requestKey: 'branch', decision: 'accept' }).state
  assert.equal(s.phase, 'waiting_for_input')
  s = apply(s, { type: 'decision_delivered', requestKey: 'branch' }).state
  assert.equal(s.phase, 'running')
  assert.equal(apply(s, { type: 'complete' }).state.phase, 'completed')
})
