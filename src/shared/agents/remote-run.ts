import type { AgentRunStatus } from './agent-run'

export const REMOTE_RUN_LIFECYCLE_VERSION = 2 as const
export const REMOTE_RUN_PHASES = [
  'queued', 'waking', 'starting', 'running', 'waiting_for_approval', 'waiting_for_input',
  'recovering', 'needs_attention', 'cancelling', 'completed', 'cancelled', 'failed',
] as const
export type RemoteRunPhase = typeof REMOTE_RUN_PHASES[number]
export type RemoteRecoveryOutcome = 'attached_live' | 'restored' | 'requires_new_attempt' | 'unavailable'
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
  lastHealthAt?: number
  lastProgressAt?: number
  approval?: { requestKey: string; expiresAt: number; decision?: string; delivered?: boolean }
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

/** Pure canonical transition. Callers supply trusted receipt time and authenticate facts before applying them. */
export function reduceRemoteRun(
  current: RemoteRunState, expectedRevision: number, fence: RemoteRunFence, fact: RemoteRunFact, now: number,
): RemoteRunReduction {
  const reject = (reason: RemoteRunReduction['reason']): RemoteRunReduction => ({ applied: false, state: current, reason })
  if (current.revision !== expectedRevision) return reject('stale_revision')
  if (current.currentAttemptId !== fence.attemptId || current.executionGeneration !== fence.executionGeneration) return reject('stale_attempt')
  if (current.coordinatorGeneration !== fence.coordinatorGeneration) return reject('stale_owner')
  if (isTerminalRemoteRun(current.phase)) return reject('terminal')
  const next: RemoteRunState = { ...current, ...(current.approval ? { approval: { ...current.approval } } : {}) }
  const attention = (cause: string) => { next.phase = 'needs_attention'; next.cause = cause }
  // Policy stops cannot be undone by an event, recovery, or a late decision.
  if (now >= current.hardDeadlineAt && fact.type !== 'stopped') {
    next.phase = 'cancelling'; next.cause = 'hard_deadline_expired'
  } else if (current.phase === 'cancelling') {
    if (fact.type === 'stopped') next.phase = 'cancelled'
    else return reject('conflict')
  } else if (fact.type === 'coordinator_stopped') {
    if (current.coordinatorId !== fact.coordinatorId) return reject('stale_owner')
    next.coordinatorGeneration++
    delete next.coordinatorId
  } else if (fact.type === 'claim_coordinator') {
    if (current.coordinatorId && current.coordinatorId !== fact.coordinatorId) return reject('stale_owner')
    if (current.coordinatorId === fact.coordinatorId) return { applied: false, state: current }
    next.coordinatorId = fact.coordinatorId
  } else if (fact.type === 'cancel' || fact.type === 'refuse') {
    next.phase = 'cancelling'; next.cause = fact.cause
  } else if (fact.type === 'wake') {
    if (current.phase !== 'queued' && current.phase !== 'waking') return reject('conflict')
    next.phase = 'waking'
  } else if (fact.type === 'dispatch') {
    if (!current.coordinatorId || !['queued', 'waking', 'starting'].includes(current.phase)) return reject('conflict')
    next.phase = 'starting'
  } else if (fact.type === 'started') {
    if (!['starting', 'recovering'].includes(current.phase)) return reject('conflict')
    next.phase = current.approval && !current.approval.delivered ? 'waiting_for_approval' : 'running'
    next.lastHealthAt = now
  } else if (fact.type === 'health') {
    if (fact.process === 'live') {
      next.lastHealthAt = now
      if (current.phase === 'needs_attention' && current.cause === 'process_health_required') {
        next.phase = current.approval && !current.approval.delivered ? 'waiting_for_approval' : 'running'
        delete next.cause
      }
    }
    else if (fact.process === 'lost') {
      attention(current.approval ? 'approval_context_lost' : 'process_lost')
      // Preserve approval history elsewhere; it is no longer executable authority.
      delete next.approval
    } else attention('process_health_unknown')
  } else if (fact.type === 'progress') {
    next.lastProgressAt = now
  } else if (fact.type === 'request') {
    if (current.approval && current.approval.requestKey !== fact.requestKey && !current.approval.delivered) return reject('conflict')
    if (current.approval?.requestKey === fact.requestKey) return { applied: false, state: current }
    next.approval = { requestKey: fact.requestKey, expiresAt: Math.min(fact.expiresAt, current.hardDeadlineAt) }
    next.phase = fact.kind === 'permission' ? 'waiting_for_approval' : 'waiting_for_input'
  } else if (fact.type === 'decision') {
    if (!current.approval || current.approval.requestKey !== fact.requestKey || now >= current.approval.expiresAt) return reject('conflict')
    if (current.approval.decision) return current.approval.decision === fact.decision ? { applied: false, state: current } : reject('conflict')
    next.approval = { ...current.approval, decision: fact.decision }
  } else if (fact.type === 'decision_delivered') {
    if (!current.approval?.decision || current.approval.requestKey !== fact.requestKey) return reject('conflict')
    next.approval = { ...current.approval, delivered: true }
    next.phase = 'running'
  } else if (fact.type === 'recovery_requested') {
    next.phase = 'recovering'
  } else if (fact.type === 'recover') {
    next.recoveryOutcome = fact.recoveryOutcome
    if (fact.recoveryOutcome === 'attached_live') {
      next.phase = current.approval && !current.approval.delivered ? 'waiting_for_approval' : 'running'
      next.lastHealthAt = now
    } else if (fact.recoveryOutcome === 'restored' && fact.oldWriterStopped && !current.approval) {
      next.phase = 'running'; next.lastHealthAt = now
    } else attention(fact.oldWriterStopped ? 'continuation_unsupported' : 'old_writer_not_isolated')
  } else if (fact.type === 'complete') {
    if (current.phase !== 'running' || (current.approval && !current.approval.delivered)) return reject('conflict')
    next.phase = 'completed'
  } else if (fact.type === 'stopped') {
    attention('execution_stopped')
  } else if (fact.type === 'observe') {
    if (current.approval && now >= current.approval.expiresAt) {
      next.phase = 'cancelling'; next.cause = 'approval_expired'
    } else if (['queued', 'waking', 'starting'].includes(current.phase) && now >= current.claimDeadlineAt) {
      attention('command_unclaimed')
    } else if (!['queued', 'waking', 'starting'].includes(current.phase) && now - (current.lastHealthAt ?? 0) >= 90_000) attention('process_health_required')
    else return { applied: false, state: current }
  }
  next.revision++
  return { applied: true, state: next }
}
