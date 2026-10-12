import 'server-only'

import type { CloudAgentPhase } from '@/shared/agents/cloud-agent'

export type CloudAgentProvisionRecord = {
  workspaceId: string
  agentId: string
  userId: string
  phase: CloudAgentPhase
  error?: string
  environmentId?: string
  createdAt: number
  updatedAt: number
}

export interface CloudAgentProvisionRepository {
  get(args: { workspaceId: string; agentId: string }): Promise<CloudAgentProvisionRecord | null>
  /** Starts a record, or restarts a failed one. Returns started:false when one is already active or done. */
  begin(args: { workspaceId: string; agentId: string; userId: string; now: number }): Promise<{ started: boolean; phase: CloudAgentPhase }>
  setPhase(args: { workspaceId: string; agentId: string; phase: CloudAgentPhase; error?: string; environmentId?: string; now: number }): Promise<void>
  remove(args: { workspaceId: string; agentId: string }): Promise<void>
}
