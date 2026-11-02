import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

type ChiefIdentity = Pick<WorkspaceAgentDirectoryItem, 'agentRole' | 'isDefault'>

export function usesOverlayMark(agent: ChiefIdentity | null | undefined): boolean {
  if (agent?.agentRole === 'personal_chief') return false
  return agent?.agentRole === 'workspace_chief' || agent?.isDefault === true
}

export function isChief(agent: ChiefIdentity): boolean {
  return agent.agentRole === 'workspace_chief' || agent.agentRole === 'personal_chief'
}

export function chiefRoleLabel(agent: ChiefIdentity): string {
  return agent.agentRole === 'workspace_chief' ? 'Workspace chief of staff'
    : agent.agentRole === 'personal_chief' ? 'Personal chief of staff' : 'Agent'
}

export function isPinnedChief(
  agent: Pick<WorkspaceAgentDirectoryItem, 'agentRole' | 'createdByPrincipalId'>,
  viewerPrincipalId: string | null | undefined,
): boolean {
  return agent.agentRole === 'workspace_chief'
    || (agent.agentRole === 'personal_chief' && agent.createdByPrincipalId === viewerPrincipalId)
}

export function pinChiefs<T extends Pick<WorkspaceAgentDirectoryItem, 'agentRole' | 'createdByPrincipalId'>>(
  agents: readonly T[], viewerPrincipalId: string | null | undefined,
): T[] {
  const rank = (agent: T) => agent.agentRole === 'workspace_chief' ? 0 : isPinnedChief(agent, viewerPrincipalId) ? 1 : 2
  return [...agents].sort((a, b) => rank(a) - rank(b))
}
