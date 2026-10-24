import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  AGENT_DIRECTORY_CHANGED_EVENT,
  type AgentDirectoryChangedEventDetail,
} from '@/shared/workspace/sidebar-events'

export type AgentDirectoryState = {
  workspaceId: string | null
  agents: WorkspaceAgentDirectoryItem[] | null
  viewerPrincipalId: string | null
  error: string | null
}

export function subscribeAgentDirectory(
  workspaceId: string,
  onChange: (state: AgentDirectoryState) => void,
  events: EventTarget,
): () => void {
  let generation = 0
  let disposed = false
  const load = () => {
    const request = ++generation
    onChange({ workspaceId, agents: null, viewerPrincipalId: null, error: null })
    void overlayAppClient.agents.list(workspaceId).then((response) => {
      if (disposed || request !== generation) return
      onChange({ workspaceId, agents: response.agents, viewerPrincipalId: response.viewerPrincipalId ?? null, error: null })
    }).catch(() => {
      if (disposed || request !== generation) return
      onChange({ workspaceId, agents: [], viewerPrincipalId: null, error: 'Could not load your agents. Check your connection and retry.' })
    })
  }
  const refresh = (event: Event) => {
    const detail = (event as CustomEvent<AgentDirectoryChangedEventDetail>).detail
    if (detail?.workspaceId === workspaceId) load()
  }
  events.addEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refresh)
  load()
  return () => {
    disposed = true
    events.removeEventListener(AGENT_DIRECTORY_CHANGED_EVENT, refresh)
  }
}
