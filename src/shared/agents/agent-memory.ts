/**
 * Agents own memories the way people do.
 *
 * A workspace agent is a principal, not a user, so it has no `userId` to hang
 * memories off. Memory rows are keyed by an opaque owner string, so an agent
 * owns its memories under a synthetic id derived from its agent id. The rows
 * still carry the workspace, which is what makes them visible to the rest of
 * the workspace during recall — an agent's memory is workspace knowledge, not
 * private state.
 *
 * The prefix is deliberately not a legal user id in any backend, so an agent
 * memory owner can never collide with a real user and can always be told apart
 * from one.
 */
const AGENT_MEMORY_OWNER_PREFIX = 'agent-memory:'

/** The memory owner id for a workspace agent. */
export function agentMemoryOwnerId(agentId: string): string {
  const normalized = agentId.trim()
  if (!normalized) throw new Error('agentId is required to derive an agent memory owner id')
  return `${AGENT_MEMORY_OWNER_PREFIX}${normalized}`
}

/**
 * Who keeps what an agent remembers. A personal Overlay remembers for the one person it belongs to, so its memories are
 * that person's private memories (`memory-visibility.ts` makes them `owner`) and never surface in a shared room. Every
 * other agent remembers as itself, which is workspace knowledge.
 */
export function agentMemoryOwner(agent: { id: string; agentRole?: string; chiefOwnerUserId?: string }): string {
  if (agent.agentRole === 'personal_chief') {
    if (!agent.chiefOwnerUserId) throw new Error('A personal Overlay must have an owner')
    return agent.chiefOwnerUserId
  }
  return agentMemoryOwnerId(agent.id)
}

/** Whether a memory owner id belongs to an agent rather than a human. */
export function isAgentMemoryOwnerId(ownerId: string | undefined): boolean {
  return Boolean(ownerId?.startsWith(AGENT_MEMORY_OWNER_PREFIX))
}

/** The agent id behind an agent memory owner id, or undefined for a human owner. */
export function agentIdFromMemoryOwnerId(ownerId: string | undefined): string | undefined {
  if (!isAgentMemoryOwnerId(ownerId)) return undefined
  const agentId = ownerId!.slice(AGENT_MEMORY_OWNER_PREFIX.length).trim()
  return agentId || undefined
}
