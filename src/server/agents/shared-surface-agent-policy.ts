import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'

export type SharedSurfaceAgentContext = {
  surfaceExecution: SurfaceTurnExecution
}

export function sharedSurfaceAgentContext(
  surfaceExecution: SurfaceTurnExecution | undefined,
  sharedRoom: boolean,
): SharedSurfaceAgentContext | undefined {
  return surfaceExecution && sharedRoom ? { surfaceExecution } : undefined
}

export function isAvailableToSharedSurface(
  agent: Pick<WorkspaceAgentDirectoryItem, 'visibility' | 'agentRole' | 'chiefScope'>,
): boolean {
  return agent.visibility === 'workspace' && agent.agentRole !== 'personal_chief' && agent.chiefScope !== 'personal'
}

export function filterSharedSurfaceAgents<T extends Pick<WorkspaceAgentDirectoryItem, 'visibility' | 'agentRole' | 'chiefScope'>>(
  agents: T[],
  context?: SharedSurfaceAgentContext,
): T[] {
  return context ? agents.filter(isAvailableToSharedSurface) : agents
}
