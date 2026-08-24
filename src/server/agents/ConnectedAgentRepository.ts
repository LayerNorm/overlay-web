import 'server-only'

import type {
  AgentApprovalRequest, AgentApprovalResolution, AgentBinding, AgentEnvironment,
  AgentRemoteEvent, AgentRemoteSession, AgentRunCommand, AgentSandboxLease,
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
  | { accepted: true; acknowledgedSequence: number; duplicate: boolean }
  | { accepted: false; expectedSequence: number }

/** Atomic persistence boundary shared by Convex and PostgreSQL connected-agent flows. */
export interface ConnectedAgentRepository {
  createEnvironment(input: ConnectedAgentCreateEnvironment): Promise<AgentEnvironment>
  createBinding(input: ConnectedAgentCreateBinding): Promise<AgentBinding>
  createRemoteSession(input: ConnectedAgentCreateSession): Promise<AgentRemoteSession>
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
