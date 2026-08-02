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
