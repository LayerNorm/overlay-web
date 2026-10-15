import type { AgentRunStatus } from './agent-run'

export const REMOTE_RUN_LIFECYCLE_VERSION = 2 as const
export const REMOTE_RUN_CANCEL_GRACE_MS = 5 * 60_000
export const REMOTE_RUN_PHASES = [
  'queued', 'waking', 'starting', 'running', 'waiting_for_approval', 'waiting_for_input',
  'recovering', 'needs_attention', 'cancelling', 'completed', 'cancelled', 'failed',
] as const
export type RemoteRunPhase = typeof REMOTE_RUN_PHASES[number]
export type RemoteRecoveryOutcome = 'attached_live' | 'restored' | 'requires_new_attempt' | 'unavailable'
export type RemoteRunApproval = { requestKey: string; expiresAt: number; kind?: 'permission' | 'elicitation'; decision?: string; delivered?: boolean }
export type RemoteRunState = {
  version: 2
  revision: number
  phase: RemoteRunPhase
  currentAttemptId: string
  executionGeneration: number
  coordinatorGeneration: number
  coordinatorId?: string
  hardDeadlineAt: number
  claimDeadlineAt: number
  cancelRequestedAt?: number
  lastHealthAt?: number
  lastProgressAt?: number
  approval?: RemoteRunApproval
  approvals?: RemoteRunApproval[]
  cause?: string
  recoveryOutcome?: RemoteRecoveryOutcome
}
export type RemoteRunFact =
  | { type: 'claim_coordinator'; coordinatorId: string }
  | { type: 'coordinator_stopped'; coordinatorId: string }
  | { type: 'wake' }
  | { type: 'dispatch' }
  | { type: 'started' }
  | { type: 'health'; process: 'live' | 'lost' | 'unknown' }
  | { type: 'progress' }
  | { type: 'request'; requestKey: string; kind: 'permission' | 'elicitation'; expiresAt: number }
  | { type: 'decision'; requestKey: string; decision: string }
  | { type: 'decision_delivered'; requestKey: string }
  | { type: 'recovery_requested' }
  | { type: 'recover'; recoveryOutcome: RemoteRecoveryOutcome; oldWriterStopped?: boolean }
  | { type: 'cancel'; cause: string }
  | { type: 'stopped' }
  | { type: 'complete' }
  | { type: 'refuse'; cause: string }
  | { type: 'observe' }
export type RemoteRunFence = { attemptId: string; executionGeneration: number; coordinatorGeneration: number }
export type RemoteRunReduction = { applied: boolean; state: RemoteRunState; reason?: 'stale_revision' | 'stale_owner' | 'stale_attempt' | 'terminal' | 'conflict' }

export function remoteRunCoarseStatus(phase: RemoteRunPhase): AgentRunStatus {
  if (phase === 'completed' || phase === 'cancelled' || phase === 'failed') return phase
  if (phase === 'waiting_for_approval' || phase === 'waiting_for_input') return 'waiting_for_approval'
  if (phase === 'queued' || phase === 'waking' || phase === 'starting') return 'queued'
  return 'running'
}
export function isTerminalRemoteRun(phase: RemoteRunPhase) {
  return phase === 'completed' || phase === 'cancelled' || phase === 'failed'
}

type Disposition = 'unchanged' | RemoteRunReduction['reason'] | void
type FactContext = { current: RemoteRunState; next: RemoteRunState; now: number }
type FactHandlers = { [K in RemoteRunFact['type']]: (context: FactContext, fact: Extract<RemoteRunFact, { type: K }>) => Disposition }

function needsAttention(next: RemoteRunState, cause: string) {
  next.phase = 'needs_attention'
  next.cause = cause
}
export function pendingRemoteApprovals(state: RemoteRunState): RemoteRunApproval[] {
  return (state.approvals ?? (state.approval ? [state.approval] : [])).filter(request => !request.delivered)
}
function allRemoteApprovals(state: RemoteRunState): RemoteRunApproval[] {
  return state.approvals ?? (state.approval ? [state.approval] : [])
}
function replaceApprovals(next: RemoteRunState, approvals: RemoteRunApproval[]) {
  next.approvals = approvals
  const pending = approvals.find(request => !request.delivered)
  if (pending) next.approval = pending
  else delete next.approval
}
function phaseAfterAttach(current: RemoteRunState): RemoteRunPhase {
  const pending = pendingRemoteApprovals(current)
  if (pending.length === 0) return 'running'
  return pending.some(request => request.kind === 'elicitation') ? 'waiting_for_input' : 'waiting_for_approval'
}

const factHandlers: FactHandlers = {
  coordinator_stopped({ current, next }, fact) {
    if (current.coordinatorId !== fact.coordinatorId) return 'stale_owner'
    next.coordinatorGeneration++
    delete next.coordinatorId
  },
  claim_coordinator({ current, next }, fact) {
    if (current.coordinatorId && current.coordinatorId !== fact.coordinatorId) return 'stale_owner'
    if (current.coordinatorId === fact.coordinatorId) return 'unchanged'
    next.coordinatorId = fact.coordinatorId
  },
  cancel({ next, now }, fact) { next.phase = 'cancelling'; next.cause = fact.cause; next.cancelRequestedAt = now },
  refuse({ next, now }, fact) { next.phase = 'cancelling'; next.cause = fact.cause; next.cancelRequestedAt = now },
  wake({ current, next }) {
    if (!['queued', 'waking'].includes(current.phase)) return 'conflict'
    next.phase = 'waking'
  },
  dispatch({ current, next }) {
    if (!current.coordinatorId || !['queued', 'waking', 'starting'].includes(current.phase)) return 'conflict'
    next.phase = 'starting'
  },
  started({ current, next, now }) {
    if (!['starting', 'recovering'].includes(current.phase)) return 'conflict'
    next.phase = phaseAfterAttach(current)
    delete next.cause
    next.lastHealthAt = now
  },
  health({ current, next, now }, fact) {
    if (fact.process === 'live') {
      next.lastHealthAt = now
      if (current.phase === 'needs_attention' && current.cause === 'process_health_required') {
        next.phase = phaseAfterAttach(current)
        delete next.cause
      }
    } else if (fact.process === 'lost') {
      needsAttention(next, pendingRemoteApprovals(current).length > 0 ? 'approval_context_lost' : 'process_lost')
      delete next.approval
      delete next.approvals
    } else needsAttention(next, 'process_health_unknown')
  },
  progress({ next, now }) { next.lastProgressAt = now },
  request({ current, next }, fact) {
    if (current.cause === 'approval_context_lost' || !['starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering'].includes(current.phase)) return 'conflict'
    const requests = allRemoteApprovals(current)
    if (requests.some(request => request.requestKey === fact.requestKey)) return 'unchanged'
    const pending = pendingRemoteApprovals(current)
    if (pending.length >= 100) return 'conflict'
    replaceApprovals(next, [...pending, { requestKey: fact.requestKey, kind: fact.kind,
      expiresAt: Math.min(fact.expiresAt, current.hardDeadlineAt) }])
    next.phase = phaseAfterAttach(next)
  },
  decision({ current, next, now }, fact) {
    const requests = allRemoteApprovals(current)
    const request = requests.find(request => request.requestKey === fact.requestKey)
    if (!request || now >= request.expiresAt) return 'conflict'
    if (request.decision) return request.decision === fact.decision ? 'unchanged' : 'conflict'
    replaceApprovals(next, requests.map(request => request.requestKey === fact.requestKey ? { ...request, decision: fact.decision } : request))
  },
  decision_delivered({ current, next }, fact) {
    const requests = allRemoteApprovals(current)
    const request = requests.find(request => request.requestKey === fact.requestKey)
    if (!request?.decision) return 'conflict'
    if (request.delivered) return 'unchanged'
    replaceApprovals(next, requests.map(request => request.requestKey === fact.requestKey ? { ...request, delivered: true } : request))
    next.phase = phaseAfterAttach(next)
  },
  recovery_requested({ next }) { next.phase = 'recovering' },
  recover({ current, next, now }, fact) {
    next.recoveryOutcome = fact.recoveryOutcome
    if (fact.recoveryOutcome === 'attached_live') {
      next.phase = phaseAfterAttach(current)
      delete next.cause
      next.lastHealthAt = now
    } else if (fact.recoveryOutcome === 'restored' && fact.oldWriterStopped && pendingRemoteApprovals(current).length === 0) {
      next.phase = 'running'; delete next.cause; next.lastHealthAt = now
    } else needsAttention(next, fact.oldWriterStopped ? 'continuation_unsupported' : 'old_writer_not_isolated')
  },
  complete({ current, next }) {
    if (current.phase !== 'running' || pendingRemoteApprovals(current).length > 0) return 'conflict'
    next.phase = 'completed'
  },
  stopped({ next }) { needsAttention(next, 'execution_stopped') },
  observe({ current, next, now }) {
    if (current.phase === 'needs_attention' && current.cause !== 'process_health_required') return 'unchanged'
    if (pendingRemoteApprovals(current).some(request => now >= request.expiresAt)) {
      next.phase = 'cancelling'; next.cause = 'approval_expired'; next.cancelRequestedAt = now
    } else if (['queued', 'waking', 'starting'].includes(current.phase) && now >= current.claimDeadlineAt) {
      needsAttention(next, 'command_unclaimed')
    } else if (!['queued', 'waking', 'starting'].includes(current.phase) && now - (current.lastHealthAt ?? 0) >= 90_000) needsAttention(next, 'process_health_required')
    else return 'unchanged'
  },
}

/** Pure canonical transition. Callers supply trusted receipt time and authenticate facts before applying them. */
export function reduceRemoteRun(
  current: RemoteRunState, expectedRevision: number, fence: RemoteRunFence, fact: RemoteRunFact, now: number,
): RemoteRunReduction {
  const reject = (reason?: RemoteRunReduction['reason']): RemoteRunReduction => ({ applied: false, state: current, ...(reason ? { reason } : {}) })
  if (current.revision !== expectedRevision) return reject('stale_revision')
  if (current.currentAttemptId !== fence.attemptId || current.executionGeneration !== fence.executionGeneration) return reject('stale_attempt')
  if (current.coordinatorGeneration !== fence.coordinatorGeneration) return reject('stale_owner')
  if (isTerminalRemoteRun(current.phase)) return reject('terminal')
  const next: RemoteRunState = { ...current, ...(current.approval ? { approval: { ...current.approval } } : {}),
    ...(current.approvals ? { approvals: current.approvals.map(request => ({ ...request })) } : {}) }
  // Policy stops cannot be undone by an event, recovery, or a late decision.
  if (current.phase === 'cancelling') {
    // A host is asked to confirm the stop, but a dead, revoked, or reimaged machine never
    // will — after the grace window the supervisor's next observe closes the run anyway
    // rather than leaving it cancelling forever. Runs cancelled before this field existed
    // (cancelRequestedAt unset) resolve immediately.
    if (fact.type === 'stopped') next.phase = 'cancelled'
    else if (now - (current.cancelRequestedAt ?? 0) >= REMOTE_RUN_CANCEL_GRACE_MS) next.phase = 'cancelled'
    else return reject('conflict')
  } else if (now >= current.hardDeadlineAt) {
    if (fact.type === 'stopped') next.phase = 'cancelled'
    else {
      next.phase = 'cancelling'; next.cause = 'hard_deadline_expired'
      next.cancelRequestedAt = next.cancelRequestedAt ?? now
    }
  } else {
    // The exhaustive map checks each handler's discriminant/arguments at declaration.
    const handle = factHandlers[fact.type] as (context: FactContext, fact: RemoteRunFact) => Disposition
    const disposition = handle({ current, next, now }, fact)
    if (disposition === 'unchanged') return reject()
    if (disposition) return reject(disposition)
  }
  next.revision++
  return { applied: true, state: next }
}
