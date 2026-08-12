export const NEW_AGENT_EVENT = 'overlay:sidebar-new-agent'
export const NEW_KNOWLEDGE_BASE_EVENT = 'overlay:sidebar-new-knowledge-base'
export const AGENT_DIRECTORY_CHANGED_EVENT = 'overlay:agent-directory-changed'

export type AgentDirectoryChangedEventDetail = {
  workspaceId: string
}

export function dispatchAgentDirectoryChanged(workspaceId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AgentDirectoryChangedEventDetail>(AGENT_DIRECTORY_CHANGED_EVENT, {
    detail: { workspaceId },
  }))
}
