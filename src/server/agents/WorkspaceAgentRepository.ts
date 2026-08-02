import 'server-only'

import type {
  WorkspaceAgentDefinition,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentHarness,
} from '@overlay/workspace-contracts'

export type CreateWorkspaceAgentRecord = {
  agentId: string
  principalId: string
  workspaceId: string
  name: string
  description?: string
  instructions: string
  harness: WorkspaceAgentHarness
  modelId: string
  avatarColor?: string
  allowedToolIds: string[]
  teamIds: string[]
  createdByPrincipalId: string
  now: number
}

export type UpdateWorkspaceAgentRecord = Partial<Pick<
  WorkspaceAgentDefinition,
  'name' | 'description' | 'instructions' | 'harness' | 'modelId' | 'avatarColor' | 'allowedToolIds'
>> & {
  agentId: string
  workspaceId: string
  teamIds?: string[]
  updatedByPrincipalId?: string
  now: number
}

export interface WorkspaceAgentRepository {
  create(input: CreateWorkspaceAgentRecord): Promise<WorkspaceAgentDirectoryItem>
  get(args: { agentId: string; workspaceId: string }): Promise<WorkspaceAgentDirectoryItem | null>
  list(args: { workspaceId: string; includeArchived?: boolean }): Promise<WorkspaceAgentDirectoryItem[]>
  update(input: UpdateWorkspaceAgentRecord): Promise<WorkspaceAgentDirectoryItem | null>
  archive(args: { agentId: string; workspaceId: string; now: number }): Promise<boolean>
}
