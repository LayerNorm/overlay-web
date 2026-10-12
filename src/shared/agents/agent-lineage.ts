/**
 * Who asked whom, for agents that ask other agents.
 *
 * A turn started by a person has hop 0. When an agent asks another agent, the question is posted as a message by
 * the asking agent that carries a lineage part; the asked agent's turn is triggered by that message, so its own
 * lineage is read back from the message that triggered it. The model never supplies or sees a lineage, so it
 * cannot forge or reset one, and a person's own messages cannot carry one (message parts from people are
 * restricted to text and files).
 */

export const AGENT_LINEAGE_PART_TYPE = 'data-agent-lineage'

/** An agent may ask an agent that asks an agent: person → A (0) → B (1) → C (2) → D (3). */
export const MAX_AGENT_HOPS = 3
/** Questions one person's message may cause across every agent it reaches, so fan-out cannot multiply cost. */
export const MAX_AGENT_ASKS_PER_ROOT = 12
/** Questions one turn may ask directly. */
export const MAX_AGENT_ASKS_PER_TURN = 3
/** Messages one turn may post into other conversations, and one person's message may cause across a chain. */
export const MAX_AGENT_POSTS_PER_TURN = 5
export const MAX_AGENT_POSTS_PER_ROOT = 20
/**
 * What the asked agents of one chain may use in total (input plus output tokens of their replies). Counts alone do not
 * bound cost, since one question can start a long turn; this stops the next question once the chain has used this much.
 */
export const MAX_CHAIN_TOKENS = 500_000
/** An outside app (ChatGPT, Claude, …) asking an agent for a person: per hour and per day. */
export const MAX_OUTSIDE_ASKS_PER_HOUR = 30
export const MAX_OUTSIDE_ASKS_PER_DAY = 100

export type AgentLineage = {
  /** The turn id of the person's message that started the whole chain. */
  rootTurnId: string
  /** 0 for a turn a person started; one more for each agent that passed the question on. */
  hop: number
  /** Agent ids from the first agent asked to the current one. */
  chain: string[]
  /** The agent that asked (absent at hop 0). */
  askedByAgentId?: string
  askedByName?: string
  /** Where the asking turn was running, so the question can link back to it. */
  parentConversationId?: string
}

export type AgentLineagePart = { type: typeof AGENT_LINEAGE_PART_TYPE; data: AgentLineage }

export function agentLineagePart(lineage: AgentLineage): AgentLineagePart {
  return { type: AGENT_LINEAGE_PART_TYPE, data: lineage }
}

function isLineage(value: unknown): value is AgentLineage {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return typeof data.rootTurnId === 'string' && data.rootTurnId.length > 0
    && Number.isInteger(data.hop) && (data.hop as number) >= 0 && (data.hop as number) <= MAX_AGENT_HOPS + 1
    && Array.isArray(data.chain) && data.chain.every((id) => typeof id === 'string')
}

/**
 * The lineage a turn runs under, from the message that triggered it. Only an agent-authored message is trusted to
 * carry one; anything else starts a new chain at hop 0 rooted at its own turn.
 */
export function lineageForTriggerMessage(message: {
  authorKind?: string
  turnId?: string
  parts?: ReadonlyArray<Record<string, unknown>> | null
}, agentId: string): AgentLineage {
  if (message.authorKind === 'agent') {
    const carried = message.parts?.find((part) => part.type === AGENT_LINEAGE_PART_TYPE)?.data
    if (isLineage(carried)) return carried
  }
  return { rootTurnId: message.turnId ?? '', hop: 0, chain: [agentId] }
}

export type AskRefusal = 'self' | 'cycle' | 'hop_limit' | 'turn_limit'

/** Whether `caller` (running under `lineage`) may ask `targetAgentId`, and the lineage the asked agent runs under. */
export function nextLineage(args: {
  lineage: AgentLineage
  callerAgentId: string
  callerName?: string
  targetAgentId: string
  asksSoFarThisTurn: number
  parentConversationId?: string
}): { ok: true; lineage: AgentLineage } | { ok: false; refusal: AskRefusal } {
  if (args.targetAgentId === args.callerAgentId) return { ok: false, refusal: 'self' }
  if (args.lineage.chain.includes(args.targetAgentId)) return { ok: false, refusal: 'cycle' }
  if (args.lineage.hop + 1 > MAX_AGENT_HOPS) return { ok: false, refusal: 'hop_limit' }
  if (args.asksSoFarThisTurn >= MAX_AGENT_ASKS_PER_TURN) return { ok: false, refusal: 'turn_limit' }
  return {
    ok: true,
    lineage: {
      rootTurnId: args.lineage.rootTurnId,
      hop: args.lineage.hop + 1,
      chain: [...args.lineage.chain, args.targetAgentId],
      askedByAgentId: args.callerAgentId,
      ...(args.callerName ? { askedByName: args.callerName } : {}),
      ...(args.parentConversationId ? { parentConversationId: args.parentConversationId } : {}),
    },
  }
}

export const ASK_REFUSAL_MESSAGE: Record<AskRefusal | 'budget' | 'spend' | 'post_limit' | 'outside_limit', string> = {
  spend: 'The agents in this chain have already used as much as one request may. Answer with what you have.',
  post_limit: `You have posted as many messages as one request may (${MAX_AGENT_POSTS_PER_TURN} per turn).`,
  outside_limit: 'Too many questions to agents from outside apps recently. Try again later.',
  self: 'An agent cannot ask itself.',
  cycle: 'That agent is already part of this chain of questions, so asking it would loop. Answer with what you have.',
  hop_limit: `Agents can pass a question on at most ${MAX_AGENT_HOPS} times. Answer with what you have.`,
  turn_limit: `One turn can ask at most ${MAX_AGENT_ASKS_PER_TURN} questions. Combine them or answer with what you have.`,
  budget: 'This request has already asked other agents as many questions as one request may. Answer with what you have.',
}

/**
 * The lineage for one message that addresses several agents at once (an agent posting a message that mentions them):
 * each target is checked as an ask would be, and the chain gains all of them, one hop on.
 */
export function nextLineageForMentions(args: {
  lineage: AgentLineage
  callerAgentId: string
  callerName?: string
  targetAgentIds: readonly string[]
  parentConversationId?: string
}): { ok: true; lineage: AgentLineage } | { ok: false; refusal: AskRefusal } {
  const targets = [...new Set(args.targetAgentIds)]
  let first: AgentLineage | null = null
  for (const targetAgentId of targets) {
    const next = nextLineage({
      lineage: args.lineage, callerAgentId: args.callerAgentId, callerName: args.callerName, targetAgentId, asksSoFarThisTurn: 0,
      parentConversationId: args.parentConversationId,
    })
    if (!next.ok) return next
    first ??= next.lineage
  }
  if (!first) return { ok: false, refusal: 'self' }
  return { ok: true, lineage: { ...first, chain: [...args.lineage.chain, ...targets] } }
}
