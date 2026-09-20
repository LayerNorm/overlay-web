import 'server-only'

import type {
  WorkspaceAgentAutomation,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDefinition,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentHarness,
  WorkspaceAgentThread,
  WorkspaceAgentVisibility,
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
  avatarShape?: WorkspaceAgentCreatureShape
  allowedToolIds: string[]
  teamIds: string[]
  visibility: WorkspaceAgentVisibility
  createdByPrincipalId: string
  now: number
  isDefault?: boolean
}

export type UpdateWorkspaceAgentRecord = Partial<Pick<
  WorkspaceAgentDefinition,
  'name' | 'description' | 'instructions' | 'harness' | 'modelId' | 'avatarColor' | 'avatarShape' | 'allowedToolIds' | 'visibility'
>> & {
  agentId: string
  workspaceId: string
  teamIds?: string[]
  updatedByPrincipalId?: string
  now: number
}

export type AgentThreadRef = { conversationId: string; title: string }

export interface WorkspaceAgentRepository {
  create(input: CreateWorkspaceAgentRecord): Promise<WorkspaceAgentDirectoryItem>
  get(args: { agentId: string; workspaceId: string }): Promise<WorkspaceAgentDirectoryItem | null>
  list(args: { workspaceId: string; includeArchived?: boolean }): Promise<WorkspaceAgentDirectoryItem[]>
  update(input: UpdateWorkspaceAgentRecord): Promise<WorkspaceAgentDirectoryItem | null>
  archive(args: { agentId: string; workspaceId: string; now: number }): Promise<boolean>
  unarchive(args: { agentId: string; workspaceId: string; now: number }): Promise<boolean>
  /** The thread an agent opens into; adopts the legacy DM or creates one. */
  resolveMainThread(args: { workspaceId: string; agentId: string; userId: string }): Promise<AgentThreadRef | null>
  createThread(args: { workspaceId: string; agentId: string; userId: string; title?: string }): Promise<AgentThreadRef | null>
  listThreads(args: { workspaceId: string; agentId: string; userId: string }): Promise<WorkspaceAgentThread[]>
  listAgentAutomations(args: { workspaceId: string; agentId: string; userId: string }): Promise<WorkspaceAgentAutomation[]>
  /** Agents (live or archived) owning at least one thread the user archived. */
  listArchivedAgentIds(args: { workspaceId: string; userId: string }): Promise<string[]>
  setThreadArchived(args: { conversationId: string; agentId: string; userId: string; archived: boolean }): Promise<void>
  deleteThread(args: { conversationId: string; agentId: string; userId: string }): Promise<void>
}
