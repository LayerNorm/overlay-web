export const AGENT_RUN_MODES = ['chat', 'work'] as const
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number]

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

export type AgentRun = {
  id: string
  conversationId: string
  turnId: string
  userId: string
  userMessageId: string
  assistantMessageId: string
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
