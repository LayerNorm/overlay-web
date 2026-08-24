export const AGENT_ENVIRONMENT_KINDS = ['local', 'vps', 'overlay_cloud', 'external'] as const
export type AgentEnvironmentKind = (typeof AGENT_ENVIRONMENT_KINDS)[number]

export const AGENT_ENVIRONMENT_STATUSES = ['pending', 'online', 'offline', 'revoked'] as const
export type AgentEnvironmentStatus = (typeof AGENT_ENVIRONMENT_STATUSES)[number]

export type AgentEnvironment = {
  id: string
  workspaceId: string
  kind: AgentEnvironmentKind
  name: string
  status: AgentEnvironmentStatus
  publicKey?: string
  hostVersion?: string
  platform?: string
  capabilities: Record<string, unknown>
  lastSeenAt?: number
  revokedAt?: number
  createdAt: number
  updatedAt: number
}

export const AGENT_PROTOCOL_ADAPTERS = ['acp', 'eve', 'native'] as const
export type AgentProtocolAdapter = (typeof AGENT_PROTOCOL_ADAPTERS)[number]

export type AgentBinding = {
  id: string
  workspaceId: string
  agentId: string
  environmentId: string
  protocolAdapter: AgentProtocolAdapter
  adapterConfig: Record<string, unknown>
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export const AGENT_RUN_COMMAND_TYPES = [
  'start', 'cancel', 'approval_response', 'reconnect', 'shutdown',
] as const
export type AgentRunCommandType = (typeof AGENT_RUN_COMMAND_TYPES)[number]
export const AGENT_RUN_COMMAND_STATUSES = ['pending', 'claimed', 'acknowledged', 'cancelled'] as const
export type AgentRunCommandStatus = (typeof AGENT_RUN_COMMAND_STATUSES)[number]

export type AgentRunCommand = {
  id: string
  workspaceId: string
  environmentId: string
  runId: string
  type: AgentRunCommandType
  sequence: number
  payload: Record<string, unknown>
  status: AgentRunCommandStatus
  claimedAt?: number
  claimExpiresAt?: number
  acknowledgedAt?: number
  createdAt: number
  updatedAt: number
}

export const AGENT_REMOTE_SESSION_STATUSES = [
  'starting', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled',
] as const
export type AgentRemoteSessionStatus = (typeof AGENT_REMOTE_SESSION_STATUSES)[number]

export type AgentRemoteSession = {
  id: string
  workspaceId: string
  environmentId: string
  bindingId: string
  runId: string
  remoteSessionId?: string
  status: AgentRemoteSessionStatus
  commandCursor: number
  eventCursor: number
  capabilitySnapshot: Record<string, unknown>
  startedAt?: number
  endedAt?: number
  createdAt: number
  updatedAt: number
}

export type AgentApprovalResolution = {
  decision: string
  resolvedByPrincipalId: string
  resolvedAt: number
}

export type AgentApprovalRequest = {
  id: string
  workspaceId: string
  runId: string
  remoteSessionId: string
  requestKey: string
  prompt: string
  options: string[]
  payload: Record<string, unknown>
  requestedAt: number
  resolution?: AgentApprovalResolution
}

export const AGENT_SANDBOX_LEASE_STATUSES = [
  'reserved', 'provisioning', 'running', 'stopping', 'released', 'cleanup_failed',
] as const
export type AgentSandboxLeaseStatus = (typeof AGENT_SANDBOX_LEASE_STATUSES)[number]

export type AgentSandboxLease = {
  id: string
  workspaceId: string
  environmentId: string
  runId?: string
  provider: string
  providerReference?: string
  status: AgentSandboxLeaseStatus
  reservationId?: string
  reservedUntil: number
  runtimeStartedAt?: number
  runtimeEndedAt?: number
  usage: Record<string, unknown>
  cleanupAttempts: number
  cleanupAfter?: number
  createdAt: number
  updatedAt: number
}

export const AGENT_REMOTE_EVENT_TYPES = [
  'session_started', 'text_checkpoint', 'action', 'approval_requested',
  'artifact', 'completed', 'failed', 'cancelled',
] as const
export type AgentRemoteEventType = (typeof AGENT_REMOTE_EVENT_TYPES)[number]

export type AgentRemoteEvent = {
  protocolVersion: number
  eventId: string
  environmentId: string
  runId: string
  sourceSequence: number
  type: AgentRemoteEventType
  occurredAt: number
  payload: Record<string, unknown>
}
