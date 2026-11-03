import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionResult } from '@/server/harness/runner'

export function isTerminalHarnessStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status)
}

export function projectHarnessExecutionResult(
  result: HarnessExecutionResult,
  initialRunId: string,
): { runId: string; status: string } | null {
  if (result.outcome === 'already_running') return { runId: initialRunId, status: 'already_running' }
  if (result.outcome === 'continued') return { runId: result.snapshot.runId, status: 'running' }
  if (result.snapshot.status === 'waiting_for_resources' || result.snapshot.status === 'waiting_for_authorization') {
    return { runId: result.snapshot.runId, status: result.snapshot.status }
  }
  return null
}

export function projectCurrentHarnessOwner(
  state: HarnessSnapshot,
  access: { workflowRunId: string; executionGeneration?: number },
  options: { includeFundingPause?: boolean } = {},
): { runId: string; status: string } | null {
  if (state.workflowRunId !== access.workflowRunId
    || (state.executionGeneration ?? 0) !== (access.executionGeneration ?? 0)) {
    return { runId: state.runId, status: state.status === 'running' ? 'continued' : state.status }
  }
  if (state.status === 'waiting_for_authorization'
    || (options.includeFundingPause && state.status === 'waiting_for_resources')) {
    return { runId: state.runId, status: state.status }
  }
  return null
}

export function isHarnessTaskDeadlineExpired(state: HarnessSnapshot, now: number): boolean {
  return state.policy.executionPolicyVersion === 2
    && state.policy.taskDeadlineAt !== undefined
    && now >= state.policy.taskDeadlineAt
}
