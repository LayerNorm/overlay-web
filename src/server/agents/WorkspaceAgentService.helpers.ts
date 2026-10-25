import type { WorkspaceAgentDirectoryItem, WorkspaceMembershipRole } from '@overlay/workspace-contracts'
import { WorkspaceAgentServiceError } from './workspace-agent-validation'

export function canCreateAgent(role: WorkspaceMembershipRole) { return role !== 'guest' }
export function canSeeAgent(agent: Pick<WorkspaceAgentDirectoryItem, 'visibility' | 'createdByPrincipalId'>, principalId: string) {
  return agent.visibility !== 'creator' || agent.createdByPrincipalId === principalId
}
export function mapThreadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('AGENT_LAST_THREAD')) return new WorkspaceAgentServiceError('conflict', 'An agent must keep at least one thread')
  if (message.includes('AGENT_ARCHIVED')) return new WorkspaceAgentServiceError('conflict', 'Archived agents cannot start new threads')
  if (message.includes('THREAD_ACCESS_DENIED') || message.includes('WORKSPACE_ACCESS_DENIED')) return new WorkspaceAgentServiceError('forbidden', 'Thread is not accessible')
  if (message.includes('THREAD_NOT_FOUND') || message.includes('AGENT_NOT_FOUND')) return new WorkspaceAgentServiceError('not_found', 'Thread not found')
  return error instanceof Error ? error : new Error(message)
}
