/**
 * `room` is a workspace-agent turn in a DM or channel. It is a distinct mode
 * from `chat`/`work` because the author is an agent principal rather than the
 * conversation owner, and because its spend and metrics should not be mixed
 * into personal-chat reporting.
 */
export const AGENT_RUN_MODES = ['chat', 'work', 'room'] as const
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number]

/**
 * How long a room turn may stay active before a sweep treats it as abandoned.
 * Far beyond the 300s turn timeout, so a live turn is never reaped — this only
 * catches a run whose workflow the platform lost entirely.
 */
export const ROOM_AGENT_RUN_LEASE_MS = 30 * 60 * 1_000

export const AGENT_RUN_RUNNERS = ['tool_loop', 'workflow'] as const
export type AgentRunRunner = (typeof AGENT_RUN_RUNNERS)[number]

export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
] as const
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

export type AgentRunTerminalError = {
  code: string
  message: string
  retryable: boolean
}

export type AgentRunApprovalRequest = {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
}

export type AgentRunApproval = {
  token: string
  requestedAt: number
  requests: AgentRunApprovalRequest[]
}

export type AgentRunMetrics = {
  firstTokenAt?: number
  inputTokens?: number
  outputTokens?: number
  providerCostMicros?: number
  workflowStepCount?: number
  workflowRetryCount?: number
  workflowObservedStorageBytes?: number
  toolCallCount?: number
  toolSuccessCount?: number
  toolFailureCount?: number
  toolRetryCount?: number
  browserDisconnectedAt?: number
  browserReconnectedAt?: number
  processFailureDetectedAt?: number
  processFailureRecoveredAt?: number
  cancellationRequestedAt?: number
  cancellationAcknowledgedAt?: number
  staleDetectedAt?: number
}

export type AgentRun = {
  id: string
  conversationId: string
  turnId: string
  userId: string
  userMessageId: string
  assistantMessageId: string
  /** Set for `room` runs: which agent answered, and as which principal. */
  agentId?: string
  agentPrincipalId?: string
  mode: AgentRunMode
  runner: AgentRunRunner
  status: AgentRunStatus
  variantIndex?: number
  workflowRunId?: string
  leaseExpiresAt?: number
  startedAt?: number
  completedAt?: number
  failedAt?: number
  cancelledAt?: number
  terminalError?: AgentRunTerminalError
  approval?: AgentRunApproval
  metrics?: AgentRunMetrics
  createdAt: number
  updatedAt: number
}

const ALLOWED_TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  queued: ['running', 'failed', 'cancelled'],
  running: ['waiting_for_approval', 'completed', 'failed', 'cancelled'],
  waiting_for_approval: ['running', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

export function canTransitionAgentRun(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function isActiveAgentRunStatus(status: AgentRunStatus): boolean {
  return !isTerminalAgentRunStatus(status)
}
