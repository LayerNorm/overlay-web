import 'server-only'

import type {
  AgentBinding, AgentEnvironment, AgentRemoteEvent, AgentRemoteSession,
  AgentRunCommand,
} from '@overlay/workspace-contracts'

export type ConnectedAgentCreateEnvironment = Omit<AgentEnvironment, 'createdAt' | 'updatedAt'> & { now: number }
export type ConnectedAgentCreateBinding = Omit<AgentBinding, 'createdAt' | 'updatedAt'> & { now: number }
export type ConnectedAgentCreateSession = Omit<AgentRemoteSession, 'createdAt' | 'updatedAt'> & { now: number }
export type ConnectedAgentEnqueueCommand = Omit<AgentRunCommand,
  'sequence' | 'status' | 'claimedAt' | 'claimExpiresAt' | 'acknowledgedAt' | 'createdAt' | 'updatedAt'
> & { now: number }

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
