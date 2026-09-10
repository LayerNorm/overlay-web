export const AGENT_IDENTITY_PREVIEW_EVENT = 'overlay:agent-identity-preview'

export type AgentIdentityPreviewDetail = {
  workspaceId: string
  agentId: string
  principalId: string
  name: string
  avatarColor?: string
  avatarShape?: string
}

export function dispatchAgentIdentityPreview(detail: AgentIdentityPreviewDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AgentIdentityPreviewDetail>(
    AGENT_IDENTITY_PREVIEW_EVENT,
    { detail },
  ))
}

export type AgentIdentity = {
  name: string
  avatarColor?: string
  avatarShape?: string
}

export function mergeAgentIdentityPreview(
  map: ReadonlyMap<string, AgentIdentity>,
  detail: AgentIdentityPreviewDetail,
): Map<string, AgentIdentity> {
  const next = new Map(map)
  next.set(detail.principalId, {
    ...map.get(detail.principalId),
    name: detail.name,
    avatarColor: detail.avatarColor,
    avatarShape: detail.avatarShape,
  })
  return next
}

export function applyAgentIdentityPreview<
  T extends { id: string; name: string; avatarColor?: string; avatarShape?: string },
>(agents: T[], detail: AgentIdentityPreviewDetail): T[] {
  if (!agents.some((agent) => agent.id === detail.agentId)) return agents
  return agents.map((agent) => agent.id === detail.agentId
    ? {
        ...agent,
        name: detail.name,
        avatarColor: detail.avatarColor,
        avatarShape: detail.avatarShape,
      }
    : agent)
}
