import type {
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentUpdateInput,
  WorkspaceMembershipRole,
} from '@overlay/workspace-contracts'
import { WorkspaceAgentServiceError, unique } from './workspace-agent-validation'

export function canCreateAgent(role: WorkspaceMembershipRole) { return role !== 'guest' }
export function canSeeAgent(agent: Pick<WorkspaceAgentDirectoryItem, 'visibility' | 'createdByPrincipalId'>, principalId: string) {
  return agent.visibility !== 'creator' || agent.createdByPrincipalId === principalId
}
export function withAgentDirectoryMetadata(
  agent: WorkspaceAgentDirectoryItem,
  args: {
    actorUserId: string
    principalId: string
    role: WorkspaceMembershipRole
    createdByDisplayName?: string
  },
): WorkspaceAgentDirectoryItem {
  let canEdit: boolean
  if (agent.agentRole === 'personal_chief') {
    canEdit = args.role !== 'guest' && agent.chiefOwnerUserId === args.actorUserId
  } else if (agent.agentRole === 'workspace_chief' && args.role === 'guest') {
    canEdit = false
  } else if (args.role === 'owner' || args.role === 'admin') {
    canEdit = true
  } else {
    canEdit = agent.createdByPrincipalId === args.principalId
  }
  return {
    ...agent,
    ...(args.createdByDisplayName ? { createdByDisplayName: args.createdByDisplayName } : {}),
    canEdit,
  }
}

export function assertChiefBindingUpdateAllowed(
  agent: WorkspaceAgentDirectoryItem,
  input: WorkspaceAgentUpdateInput,
): void {
  if (agent.agentRole !== 'personal_chief' && agent.agentRole !== 'workspace_chief') return
  const requiredVisibility = agent.chiefScope === 'personal' ? 'creator' : 'workspace'
  if (input.visibility !== undefined && input.visibility !== requiredVisibility) {
    throw new WorkspaceAgentServiceError('validation', 'Chief binding visibility cannot be changed')
  }
  if (input.harness !== undefined && input.harness !== 'overlay') {
    throw new WorkspaceAgentServiceError('validation', 'Chief bindings must use the Overlay harness')
  }
}

export async function validateWorkspaceAgentTeamIds(
  teamIds: string[] | undefined,
  actorUserId: string,
  workspaceId: string,
  listTeams: (args: { actorUserId: string; workspaceId: string }) => Promise<{ team: { id: string } }[]>,
): Promise<string[] | undefined> {
  if (teamIds === undefined) return undefined
  const uniqueTeamIds = unique(teamIds)
  const teams = await listTeams({ actorUserId, workspaceId })
  const available = new Set(teams.map(({ team }) => team.id))
  if (uniqueTeamIds.some((teamId) => !available.has(teamId))) {
    throw new WorkspaceAgentServiceError('validation', 'One or more teams do not exist in this workspace')
  }
  return uniqueTeamIds
}

export function mapThreadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('AGENT_LAST_THREAD')) return new WorkspaceAgentServiceError('conflict', 'An agent must keep at least one thread')
  if (message.includes('AGENT_ARCHIVED')) return new WorkspaceAgentServiceError('conflict', 'Archived agents cannot start new threads')
  if (message.includes('THREAD_ACCESS_DENIED') || message.includes('WORKSPACE_ACCESS_DENIED')) return new WorkspaceAgentServiceError('forbidden', 'Thread is not accessible')
  if (message.includes('THREAD_NOT_FOUND') || message.includes('AGENT_NOT_FOUND')) return new WorkspaceAgentServiceError('not_found', 'Thread not found')
  return error instanceof Error ? error : new Error(message)
}
