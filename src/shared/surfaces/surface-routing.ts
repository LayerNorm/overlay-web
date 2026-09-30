/**
 * Picks which bound agent answers a message in a surface channel.
 *
 * A Slack workspace installs one bot (`@Overlay`), so several agents can share
 * a channel and people address one by name right after the mention:
 * `@Overlay PR agent review this`. Resolution order:
 *   1. an agent named at the start of the message (longest name wins),
 *   2. the agent that owns the thread, for follow-ups,
 *   3. the only agent bound to the channel,
 *   4. otherwise ambiguous, so the caller can list the agents to choose from.
 */
export type SurfaceRoutingCandidate = {
  bindingId: string
  agentName: string
}

export type SurfaceRoutingResult<T extends SurfaceRoutingCandidate> =
  | { kind: 'agent'; candidate: T; text: string }
  | { kind: 'ambiguous'; agentNames: string[] }
  | { kind: 'none' }

// After a leading agent name: end of text, whitespace, or address punctuation.
const NAME_BOUNDARY = /^(?:$|[\s,:;.!?—–-])/

export function routeSurfaceMessage<T extends SurfaceRoutingCandidate>(args: {
  candidates: readonly T[]
  text: string
  threadBindingId?: string | null
}): SurfaceRoutingResult<T> {
  if (args.candidates.length === 0) return { kind: 'none' }
  const text = args.text.trim()

  const byNameLength = [...args.candidates].sort((a, b) => b.agentName.length - a.agentName.length)
  for (const candidate of byNameLength) {
    const name = candidate.agentName.trim()
    if (!name) continue
    const lead = text.replace(/^@/, '')
    if (lead.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue
    const rest = lead.slice(name.length)
    if (!NAME_BOUNDARY.test(rest)) continue
    return { kind: 'agent', candidate, text: rest.replace(/^[\s,:;.!?—–-]+/, '').trim() }
  }

  const threadOwner = args.threadBindingId
    ? args.candidates.find((candidate) => candidate.bindingId === args.threadBindingId)
    : undefined
  if (threadOwner) return { kind: 'agent', candidate: threadOwner, text }

  if (args.candidates.length === 1) return { kind: 'agent', candidate: args.candidates[0], text }

  return { kind: 'ambiguous', agentNames: args.candidates.map((candidate) => candidate.agentName) }
}

export function ambiguousAgentPrompt(agentNames: readonly string[], botName = 'Overlay'): string {
  const names = agentNames.map((name) => `*${name}*`).join(', ')
  return `Several agents are in this channel: ${names}. Start your message with the agent's name, `
    + `for example \`@${botName} ${agentNames[0]} …\`.`
}
