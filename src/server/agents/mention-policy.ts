import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

export type AgentInvocationCandidate = {
  principalId: string
  principalType: 'human' | 'agent'
}

export function resolveMentionFirstInvocations(args: {
  authorKind: 'human' | 'agent' | 'model' | 'system'
  conversationType: 'personal' | 'dm' | 'channel'
  participants: AgentInvocationCandidate[]
  mentionedPrincipalIds?: string[]
  repliedToAgentPrincipalId?: string
}): string[] {
  if (args.authorKind !== 'human' || args.conversationType === 'personal') return []
  const activeAgents = args.participants
    .filter((participant) => participant.principalType === 'agent')
    .map((participant) => participant.principalId)
  if (activeAgents.length === 0) return []
  const humans = args.participants.filter((participant) => participant.principalType === 'human')
  if (args.conversationType === 'dm' && humans.length === 1 && activeAgents.length === 1) {
    return activeAgents
  }
  const explicit = new Set(args.mentionedPrincipalIds ?? [])
  if (args.repliedToAgentPrincipalId) explicit.add(args.repliedToAgentPrincipalId)
  return activeAgents.filter((principalId) => explicit.has(principalId))
}

/**
 * Intersects mention-policy candidates with the actor-visible agent
 * directory. The directory comes from `WorkspaceAgentService.list`, which
 * already excludes creator-only agents the actor may not reach — so a
 * candidate missing from it (or archived) is silently dropped: mentioning an
 * agent the author cannot see behaves exactly as if the mention had targeted
 * a non-agent, and no error reaches the room that could disclose existence.
 */
export function resolveInvocableAgents(args: {
  candidatePrincipalIds: string[]
  visibleAgents: WorkspaceAgentDirectoryItem[]
}): WorkspaceAgentDirectoryItem[] {
  const byPrincipalId = new Map(args.visibleAgents.map((agent) => [agent.principalId, agent]))
  return args.candidatePrincipalIds.flatMap((principalId) => {
    const agent = byPrincipalId.get(principalId)
    return agent && !agent.archivedAt ? [agent] : []
  })
}
