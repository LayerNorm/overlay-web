import 'server-only'

import type { CloudAgentPhase } from '@/shared/agents/cloud-agent'

export type CloudAgentProvisionRecord = {
  workspaceId: string
  agentId: string
  userId: string
  phase: CloudAgentPhase
  error?: string
  environmentId?: string
  allocationKey?: string
  provider?: string
  providerReference?: string
  allocatedAt?: number
  reclaimPending?: boolean
  createdAt: number
  updatedAt: number
}

export interface CloudAgentProvisionRepository {
  get(args: { workspaceId: string; agentId: string }): Promise<CloudAgentProvisionRecord | null>
  claimReclaim(args: { workspaceId: string; agentId: string; expectedUpdatedAt: number; now: number }): Promise<CloudAgentProvisionRecord | null>
  markReclaimPending(args: { workspaceId: string; agentId: string; allocationKey: string; now: number }): Promise<boolean>
  finishReclaim(args: { workspaceId: string; agentId: string; allocationKey: string; providerReference: string; now: number }): Promise<boolean>
  listReclaimable(args: { before: number; limit: number }): Promise<CloudAgentProvisionRecord[]>
  remove(args: { workspaceId: string; agentId: string }): Promise<void>
}
