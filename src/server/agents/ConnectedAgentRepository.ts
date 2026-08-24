import 'server-only'

import type {
  AgentApprovalRequest, AgentApprovalResolution, AgentBinding, AgentEnrollmentSession,
  AgentEnvironment, AgentEnvironmentCredential, AgentEnvironmentEnrollmentView, AgentEnvironmentProofChallenge,
  AgentFilesystemGrant, AgentRemoteEvent, AgentRemoteSession, AgentRunCommand, AgentSandboxLease,
} from '@overlay/workspace-contracts'

export type ConnectedAgentCreateEnvironment = Omit<AgentEnvironment, 'createdAt' | 'updatedAt'> & { now: number }
export type ConnectedAgentCreateBinding = Omit<AgentBinding, 'createdAt' | 'updatedAt'> & { now: number }
export type ConnectedAgentCreateSession = Omit<AgentRemoteSession, 'createdAt' | 'updatedAt'> & { now: number }
export type ConnectedAgentEnqueueCommand = Omit<AgentRunCommand,
  'sequence' | 'status' | 'claimedAt' | 'claimExpiresAt' | 'acknowledgedAt' | 'createdAt' | 'updatedAt'
> & { now: number }
export type ConnectedAgentCreateApprovalRequest = AgentApprovalRequest
export type ConnectedAgentCreateSandboxLease = Omit<AgentSandboxLease, 'createdAt' | 'updatedAt'> & { now: number }
export type ConnectedAgentUpdateSandboxLease = Partial<Pick<
  AgentSandboxLease,
  | 'status' | 'providerReference' | 'reservationId' | 'reservedUntil'
  | 'runtimeStartedAt' | 'runtimeEndedAt' | 'usage' | 'cleanupAttempts' | 'cleanupAfter'
>> & { workspaceId: string; leaseId: string; now: number }

export type ApplyRemoteEventsResult =
  | {
      accepted: true
      acknowledgedSequence: number
      duplicate: boolean
      terminal?: {
        forceFreeTierLimits: boolean
        inputTokens: number
        modelId: string
        operationId: string
        outputTokens: number
        reservationId: string | null
        userId: string
      }
    }
  | { accepted: false; expectedSequence: number }

export type ConnectedAgentInvocationTarget = {
  binding: AgentBinding
  environment: AgentEnvironment
}

export type ConnectedAgentStartRemoteTurn = {
  actorUserId: string
  agentId: string
  authorPrincipalId: string
  bindingId: string
  clientNonce: string
  commandId: string
  conversationId: string
  environmentId: string
  environmentName: string
  environmentOnline: boolean
  initiatorPrincipalId: string
  modelId: string
  prompt: string
  queueExpiresAt: number
  reservationId: string | null
  runId: string
  sessionId: string
  startPayload: Record<string, unknown>
  threadRootMessageId?: string
  turnId: string
  userMessageId: string
  workspaceId: string
  now: number
}

export type ConnectedAgentStartRemoteTurnResult = {
  commandId: string
  environmentName: string
  messageId: string
  resumed: boolean
  runId: string
  waiting: boolean
}

export type RedeemEnrollmentResult = {
  enrollment: AgentEnrollmentSession
  environment: AgentEnvironment
  proofChallenge: AgentEnvironmentProofChallenge
}

/** Atomic persistence boundary shared by Convex and PostgreSQL connected-agent flows. */
export interface ConnectedAgentRepository {
  createEnrollmentSession(input: AgentEnrollmentSession): Promise<AgentEnrollmentSession>
  redeemEnrollmentSession(args: {
    codeHash: string
    now: number
    environment: ConnectedAgentCreateEnvironment
    proofChallenge: AgentEnvironmentProofChallenge
  }): Promise<RedeemEnrollmentResult | null>
  listEnvironments(args: { workspaceId: string }): Promise<AgentEnvironment[]>
  getEnvironment(args: { workspaceId: string; environmentId: string }): Promise<AgentEnvironment | null>
  getEnvironmentEnrollment(args: {
    workspaceId: string
    environmentId: string
  }): Promise<AgentEnvironmentEnrollmentView | null>
  approveEnvironment(args: {
    workspaceId: string
    environmentId: string
    approvedByUserId: string
    filesystemGrant: AgentFilesystemGrant
    now: number
  }): Promise<AgentEnvironment | null>
  updateEnvironmentFilesystemGrant(args: {
    workspaceId: string
    environmentId: string
    filesystemGrant: AgentFilesystemGrant
    now: number
  }): Promise<AgentEnvironment | null>
  getEnvironmentProofChallenge(args: {
    environmentId: string
    now: number
  }): Promise<{ environment: AgentEnvironment; proofChallenge: AgentEnvironmentProofChallenge } | null>
  issueEnvironmentCredential(args: {
    workspaceId: string
    environmentId: string
    proofChallengeId: string
    proofChallengeHash: string
    credential: AgentEnvironmentCredential
    now: number
  }): Promise<AgentEnvironmentCredential | null>
  findEnvironmentCredential(args: { tokenHash: string }): Promise<AgentEnvironmentCredential | null>
  consumeEnvironmentProofNonce(args: {
    credentialId: string
    nonceHash: string
    expiresAt: number
    now: number
  }): Promise<boolean>
  rotateEnvironmentCredential(args: {
    currentCredentialId: string
    credential: AgentEnvironmentCredential
    now: number
  }): Promise<AgentEnvironmentCredential | null>
  heartbeatEnvironment(args: {
    workspaceId: string
    environmentId: string
    now: number
  }): Promise<AgentEnvironment | null>
  updateEnvironmentCapabilities(args: {
    workspaceId: string
    environmentId: string
    capabilities: Record<string, unknown>
    now: number
  }): Promise<AgentEnvironment | null>
  createEnvironment(input: ConnectedAgentCreateEnvironment): Promise<AgentEnvironment>
  createBinding(input: ConnectedAgentCreateBinding): Promise<AgentBinding>
  upsertBinding(input: ConnectedAgentCreateBinding): Promise<AgentBinding>
  listBindings(args: { workspaceId: string; agentId?: string }): Promise<AgentBinding[]>
  disableBindingsForAgent(args: { workspaceId: string; agentId: string; now: number }): Promise<boolean>
  findInvocationTarget(args: {
    workspaceId: string
    agentId: string
    now: number
    onlineWithinMs: number
  }): Promise<ConnectedAgentInvocationTarget | null>
  startRemoteAgentTurn(input: ConnectedAgentStartRemoteTurn): Promise<ConnectedAgentStartRemoteTurnResult>
  controlQueuedRemoteAgentTurn(args: {
    actorUserId: string
    conversationId: string
    workspaceId: string
    runId: string
    action: 'cancel' | 'retry'
    queueExpiresAt: number
    now: number
  }): Promise<{ applied: boolean; messageId?: string }>
  createRemoteSession(input: ConnectedAgentCreateSession): Promise<AgentRemoteSession>
  getRemoteSessionForRun(args: {
    workspaceId: string
    environmentId: string
    runId: string
  }): Promise<AgentRemoteSession | null>
  enqueueCommand(input: ConnectedAgentEnqueueCommand): Promise<AgentRunCommand>
  claimCommands(args: {
    workspaceId: string
    environmentId: string
    now: number
    leaseMs: number
    limit: number
  }): Promise<AgentRunCommand[]>
  acknowledgeCommand(args: {
    workspaceId: string
    environmentId: string
    commandId: string
    accepted?: boolean
    now: number
  }): Promise<boolean>
  createApprovalRequest(input: ConnectedAgentCreateApprovalRequest): Promise<AgentApprovalRequest>
  resolveApprovalRequest(args: {
    workspaceId: string
    approvalId: string
    resolution: AgentApprovalResolution
  }): Promise<AgentApprovalRequest | null>
  createSandboxLease(input: ConnectedAgentCreateSandboxLease): Promise<AgentSandboxLease>
  updateSandboxLease(input: ConnectedAgentUpdateSandboxLease): Promise<AgentSandboxLease | null>
  applyRemoteEvents(args: {
    workspaceId: string
    environmentId: string
    sessionId: string
    events: AgentRemoteEvent[]
    now: number
  }): Promise<ApplyRemoteEventsResult>
  revokeEnvironment(args: { workspaceId: string; environmentId: string; now: number }): Promise<boolean>
  deleteWorkspaceData(args: { workspaceId: string }): Promise<void>
}
