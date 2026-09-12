import type { WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'

export const NEW_AGENT_EVENT = 'overlay:sidebar-new-agent'
export const NEW_KNOWLEDGE_BASE_EVENT = 'overlay:sidebar-new-knowledge-base'
export const AGENT_DIRECTORY_CHANGED_EVENT = 'overlay:agent-directory-changed'
export const AGENT_DRAFT_PREVIEW_EVENT = 'overlay:agent-draft-preview'

export type AgentDirectoryChangedEventDetail = {
  workspaceId: string
}

export function dispatchAgentDirectoryChanged(workspaceId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AgentDirectoryChangedEventDetail>(AGENT_DIRECTORY_CHANGED_EVENT, {
    detail: { workspaceId },
  }))
}

export type AgentDraftPreviewPatch = {
  name: string
  description: string
  avatarColor: string
  avatarShape: WorkspaceAgentCreatureShape
}

export type AgentDraftPreviewEventDetail = {
  workspaceId: string
  agentId: string
  /** Directory maps in the conversation view key on principal, not agent id. */
  principalId?: string
  /** The editor's unsaved draft, or null to clear the preview for this agent. */
  patch: AgentDraftPreviewPatch | null
}

/**
 * Streams the agent editor's unsaved identity draft so the sidebar roster and
 * conversation header reflect typing in real time. `patch: null` clears the
 * override — cancel, close, and save all clear it (the saved values land via
 * the directory-changed refetch).
 */
export function dispatchAgentDraftPreview(detail: AgentDraftPreviewEventDetail): void {
  if (typeof window === 'undefined' || !detail.agentId) return
  window.dispatchEvent(new CustomEvent<AgentDraftPreviewEventDetail>(AGENT_DRAFT_PREVIEW_EVENT, {
    detail,
  }))
}
