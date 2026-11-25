/**
 * Memories follow the place, not the agent (internal/develop/workspace-and-personal.md).
 *
 * What an agent learns in a workspace context (a room others can read, a workspace automation) is workspace knowledge.
 * A workspace agent is a principal, not a user, so it keeps that knowledge under a synthetic owner id derived from its
 * agent id; the rows carry the workspace, which makes them visible to every member during recall.
 *
 * What an agent learns in a personal context (a 1:1 chat, a personal automation) is the person's private memory,
 * whichever agent saves it. An agent only one person can see (creator-only, or a personal chief) never makes
 * workspace knowledge.
 *
 * The prefix is deliberately not a legal user id in any backend, so an agent memory owner can never collide with a real
 * user and can always be told apart from one.
 */
const AGENT_MEMORY_OWNER_PREFIX = 'agent-memory:'

/** The memory owner id for a workspace agent. */
export function agentMemoryOwnerId(agentId: string): string {
  const normalized = agentId.trim()
  if (!normalized) throw new Error('agentId is required to derive an agent memory owner id')
  return `${AGENT_MEMORY_OWNER_PREFIX}${normalized}`
}

/** The agent fields that decide who keeps what it remembers. */
export type MemoryPlaceAgent = { id: string; agentRole?: string; chiefOwnerUserId?: string; visibility?: string }

/**
 * Who keeps what an agent remembers in this place: the agent itself (workspace knowledge) only in a workspace context
 * and only for an agent the whole workspace can see. Everything else is private to the person — a personal chief's
 * owner, otherwise the person the agent is working for.
 */
export function memoryOwnerForPlace(args: { actorUserId: string; agent: MemoryPlaceAgent; workspaceContext: boolean }): string {
  const { agent } = args
  if (agent.agentRole === 'personal_chief') {
    if (!agent.chiefOwnerUserId) throw new Error('A personal chief must have an owner')
    return agent.chiefOwnerUserId
  }
  return args.workspaceContext && agent.visibility !== 'creator' ? agentMemoryOwnerId(agent.id) : args.actorUserId
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
