export const AGENT_ENVIRONMENT_KINDS = ['local', 'vps', 'overlay_cloud', 'external'] as const
export type AgentEnvironmentKind = (typeof AGENT_ENVIRONMENT_KINDS)[number]

export const AGENT_ENVIRONMENT_STATUSES = ['pending', 'online', 'offline', 'revoked'] as const
export type AgentEnvironmentStatus = (typeof AGENT_ENVIRONMENT_STATUSES)[number]

export type AgentFilesystemGrant =
  | { mode: 'selected_roots'; roots: string[] }
  | { mode: 'all_user_files' }

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
  filesystemGrant?: AgentFilesystemGrant
  approvedAt?: number
  approvedByUserId?: string
  lastSeenAt?: number
  revokedAt?: number
  createdAt: number
  updatedAt: number
}

export const AGENT_PROTOCOL_ADAPTERS = ['acp', 'eve', 'native'] as const
export type AgentProtocolAdapter = (typeof AGENT_PROTOCOL_ADAPTERS)[number]

/**
 * User-owned ACP harnesses that Overlay can start with the one-copy enrollment command.
 * Keep this separate from the managed-sandbox allowlist: being built in must never imply
 * that Overlay Cloud is released for the same harness.
 */
export const BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS = ['codex', 'claude-code'] as const
export type BuiltInUserOwnedAcpAdapterId = (typeof BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS)[number]

export function isBuiltInUserOwnedAcpAdapterId(value: unknown): value is BuiltInUserOwnedAcpAdapterId {
  return typeof value === 'string'
    && (BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS as readonly string[]).includes(value)
}

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
  'start', 'prompt', 'cancel', 'approval_response', 'elicitation_response', 'reconnect', 'shutdown',
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
  'starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering',
  'completed', 'failed', 'cancelled',
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
  response?: unknown
  resolvedByPrincipalId: string
  resolvedAt: number
}

export const AGENT_REMOTE_REQUEST_KINDS = ['permission', 'elicitation'] as const
export type AgentRemoteRequestKind = (typeof AGENT_REMOTE_REQUEST_KINDS)[number]

export type AgentApprovalRequest = {
  id: string
  workspaceId: string
  runId: string
  remoteSessionId: string
  requestKey: string
  kind: AgentRemoteRequestKind
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
  'session_started', 'text_checkpoint', 'action', 'approval_requested', 'elicitation_requested',
  'plan', 'diff', 'terminal', 'artifact', 'completed', 'failed', 'cancelled',
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

export const AGENT_ARTIFACT_STATUSES = [
  'pending_upload', 'scanning', 'clean', 'rejected', 'linked', 'deleted',
] as const
export type AgentArtifactStatus = (typeof AGENT_ARTIFACT_STATUSES)[number]

/** Server-owned artifact metadata; hosts provide only the declared upload values. */
export type AgentArtifact = {
  id: string
  workspaceId: string
  environmentId: string
  runId: string
  remoteSessionId: string
  name: string
  mediaType: string
  size: number
  sha256: string
  objectKey: string
  status: AgentArtifactStatus
  scanResult?: string
  expiresAt: number
  linkedAt?: number
  deletedAt?: number
  createdAt: number
  updatedAt: number
}

export const AGENT_ENROLLMENT_SESSION_STATUSES = ['created', 'redeemed', 'approved', 'expired'] as const
export type AgentEnrollmentSessionStatus = (typeof AGENT_ENROLLMENT_SESSION_STATUSES)[number]

/** Security-sensitive persistence record. `codeHash` is never returned by a public API. */
export type AgentEnrollmentSession = {
  id: string
  workspaceId: string
  createdByUserId: string
  codeHash: string
  verificationPhrase: string
  status: AgentEnrollmentSessionStatus
  expiresAt: number
  environmentId?: string
  redeemedAt?: number
  approvedAt?: number
  maxEnvironments?: number
  createdAt: number
  updatedAt: number
}

export type AgentEnvironmentProofChallenge = {
  id: string
  workspaceId: string
  environmentId: string
  challengeHash: string
  expiresAt: number
  consumedAt?: number
  createdAt: number
}

export const AGENT_ENVIRONMENT_CREDENTIAL_AUDIENCE = 'overlay-agent-control-plane' as const
export const AGENT_ENVIRONMENT_CREDENTIAL_METHODS = [
  'agent:heartbeat',
  'agent:capabilities:update',
  'agent:commands:poll',
  'agent:commands:ack',
  'agent:events:write',
  'agent:artifacts:write',
  'agent:credentials:refresh',
] as const
export type AgentEnvironmentCredentialMethod = (typeof AGENT_ENVIRONMENT_CREDENTIAL_METHODS)[number]

/** Security-sensitive persistence record. Only a SHA-256 token hash is stored. */
export type AgentEnvironmentCredential = {
  id: string
  workspaceId: string
  environmentId: string
  tokenHash: string
  audience: typeof AGENT_ENVIRONMENT_CREDENTIAL_AUDIENCE
  methods: AgentEnvironmentCredentialMethod[]
  tokenNonce: string
  expiresAt: number
  revokedAt?: number
  createdAt: number
}

export type AgentEnvironmentProofNonce = {
  id: string
  credentialId: string
  nonceHash: string
  expiresAt: number
  createdAt: number
}

export type AgentEnvironmentEnrollmentView = {
  environment: AgentEnvironment
  verificationPhrase: string
  enrollmentExpiresAt: number
}
