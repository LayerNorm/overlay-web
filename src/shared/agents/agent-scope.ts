import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { PanelScope } from '../workspaces/panel-scope'

export function agentsInScope(
  agents: readonly WorkspaceAgentDirectoryItem[],
  viewerPrincipalId: string | null,
  scope: PanelScope,
  solo: boolean,
): WorkspaceAgentDirectoryItem[] {
  return agents.filter((agent) => !agent.archivedAt && (solo || (viewerPrincipalId !== null && (
    scope === 'personal'
      ? agent.createdByPrincipalId === viewerPrincipalId
      : agent.createdByPrincipalId !== viewerPrincipalId
  ))))
}
