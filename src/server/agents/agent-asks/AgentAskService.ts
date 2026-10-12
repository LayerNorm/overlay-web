import 'server-only'

import { createHash } from 'node:crypto'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import {
  agentLineagePart,
  ASK_REFUSAL_MESSAGE,
  lineageForTriggerMessage,
  MAX_AGENT_ASKS_PER_ROOT,
  MAX_AGENT_ASKS_PER_TURN,
  MAX_AGENT_POSTS_PER_ROOT,
  MAX_AGENT_POSTS_PER_TURN,
  MAX_CHAIN_TOKENS,
  MAX_OUTSIDE_ASKS_PER_DAY,
  MAX_OUTSIDE_ASKS_PER_HOUR,
  nextLineage,
  nextLineageForMentions,
  type AgentLineage,
} from '@/shared/agents/agent-lineage'
import type { ConversationMessageRow } from '@/server/conversations/ActConversationRepository'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'

const REPLY_WAIT_MS = 80_000
const REPLY_POLL_MS = 2_000
const MAX_REPLY_CHARS = 20_000
const MAX_QUESTION_CHARS = 8_000
const MAX_MENTIONS = 3

export class AgentAskError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'AgentAskError'
  }
}

type Collaboration = Pick<ConversationCollaborationRepository,
  'createDirectMessage' | 'addAgentMessage' | 'addMessage' | 'listMessages' | 'listParticipants' | 'getAccessibleConversation'>

export type AgentAskStatus = 'completed' | 'working' | 'failed'
export type AgentAskResult = {
  status: AgentAskStatus
  agent: string
  /** Where the asked agent answers, to read it later with `read`. */
  conversationId: string
  turnId: string
  reply?: string
  error?: string
}

export type AgentPostResult = { posted: true; messageId: string; conversationId: string; asked: string[] }

type BudgetClaim = { ok: true } | { ok: false; reason: 'budget' | 'turn_limit' }
type Caller = { agentId: string; conversationId: string; turnId: string }
type Person = { actorUserId: string; actorPrincipalId: string; workspaceId: string }

/**
 * Agents asking agents. The question is posted as a message by the asking agent into a conversation of the person,
 * the asking agent, and the asked agent, and the asked agent answers it through the same turn machinery as any
 * mention, so it runs with the person's access, bills the same place, and is visible to the person.
 *
 * Which turn is asking, and so how far down a chain of questions it is, is read from the database (the message that
 * triggered the asking turn), never taken from the model.
 *
 * An outside app (ChatGPT, Claude, Cursor…) has no agent identity, so it asks as the person: the question is the
 * person's own message in the agent's direct conversation, and the agent's turn starts a new chain.
 */
export class AgentAskService {
  constructor(private readonly dependencies: {
    collaboration: Collaboration
    /** The agents the person can see, which is also who they can ask. */
    directory: (actorUserId: string, workspaceId: string) => Promise<WorkspaceAgentDirectoryItem[]>
    /** Takes one question from the request's and the turn's budgets. */
    claimBudget: (args: { workspaceId: string; rootKey: string; turnKey: string; maxRoot: number; maxTurn: number }) => Promise<BudgetClaim>
    /** Gives back a question taken by `claimBudget` when it could not be asked. */
    releaseBudget: (args: { workspaceId: string; rootKey: string; turnKey: string }) => Promise<void>
    /** Remembers a reply a request's question started, and lists them, to add up what a chain has used. */
    recordReply: (args: { workspaceId: string; rootKey: string; conversationId: string; turnId: string }) => Promise<void>
    listReplies: (args: { workspaceId: string; rootKey: string }) => Promise<Array<{ conversationId: string; turnId: string }>>
    /** Starts the addressed agents' turns for a message; returns the turns it opened. */
    startTurns: (args: {
      actorUserId: string; conversationId: string; messageId: string; mentionedPrincipalIds: string[]
      initiatorPrincipalId: string; prompt: string; turnId: string; workspaceId: string
    }) => Promise<Array<{ agentId: string; turnId: string }>>
    sleep?: (ms: number) => Promise<void>
    now?: () => number
    waitMs?: number
  }) {}

  async list(args: { actorUserId: string; workspaceId: string; callerAgentId?: string }) {
    const directory = await this.dependencies.directory(args.actorUserId, args.workspaceId)
    return directory
      .filter((agent) => !agent.archivedAt && agent.id !== args.callerAgentId)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description ?? '',
        kind: agent.harness === 'overlay' ? 'Overlay agent' : 'Other agent (Claude Code, Codex, …)',
      }))
  }

  async ask(args: Person & {
    /** The asking agent and the turn it is in; absent for an outside app asking for the person. */
    caller?: Caller
    target: string
    message: string
    wait: boolean
  }): Promise<AgentAskResult> {
    const message = this.cleanMessage(args.message)
    const visible = await this.visibleAgents(args)
    const target = this.findAgent(visible, args.target)
    if (!target) throw new AgentAskError(`No agent called "${args.target.trim()}" that you can ask. Use list_agents to see who is available.`, 404, 'agent_not_found')
    if (!args.caller) return await this.askAsPerson({ ...args, message, target })

    const { caller, lineage } = await this.callerLineage(args, visible, args.caller)
    const next = nextLineage({
      lineage, callerAgentId: caller.id, callerName: caller.name, targetAgentId: target.id, asksSoFarThisTurn: 0,
      parentConversationId: args.caller.conversationId,
    })
    if (!next.ok) throw new AgentAskError(ASK_REFUSAL_MESSAGE[next.refusal], 409, `ask_${next.refusal}`)
    await this.refuseIfChainSpentTooMuch(args, lineage)
    const keys = { workspaceId: args.workspaceId, rootKey: `root:${lineage.rootTurnId}`, turnKey: `turn:${args.caller.turnId}` }
    const claim = await this.dependencies.claimBudget({ ...keys, maxRoot: MAX_AGENT_ASKS_PER_ROOT, maxTurn: MAX_AGENT_ASKS_PER_TURN })
    if (!claim.ok) throw new AgentAskError(ASK_REFUSAL_MESSAGE[claim.reason], 429, `ask_${claim.reason}`)
    try {
      const room = await this.dependencies.collaboration.createDirectMessage({
        actorUserId: args.actorUserId,
        workspaceId: args.workspaceId,
        principalIds: [args.actorPrincipalId, caller.principalId, target.principalId],
        title: `${caller.name} & ${target.name}`,
      })
      const content = `Asked by ${caller.name}: ${message}`
      const questionTurnId = `ask_${createHash('sha256').update(`${args.caller.turnId}:${target.id}:${message}`).digest('hex').slice(0, 24)}`
      const posted = await this.postAsAgent({
        person: args, caller, conversationId: room.conversationId, content, turnId: questionTurnId, lineage: next.lineage,
        mentions: [target], rootKey: keys.rootKey,
      })
      const turn = posted.turns.find((candidate) => candidate.agentId === target.id)
      if (!turn) throw new AgentAskError(`${target.name} could not be reached.`, 502, 'agent_unreachable')
      return await this.finishAsk({ person: args, agent: target.name, conversationId: room.conversationId, turnId: turn.turnId, wait: args.wait })
    } catch (error) {
      // Nothing reached the other agent, so the question is not spent.
      await this.dependencies.releaseBudget(keys).catch((_releaseError) => undefined)
      throw error
    }
  }

  /**
   * An agent posts a message into a conversation the person can see and the agent is part of, optionally mentioning
   * other agents in it, which starts their turns under the same chain limits as an ask. Does not wait for replies:
   * they arrive in that conversation.
   */
  async post(args: Person & {
    caller: Caller
    conversationId: string
    text: string
    mentions: string[]
  }): Promise<AgentPostResult> {
    const text = this.cleanMessage(args.text)
    if (args.mentions.length > MAX_MENTIONS) throw new AgentAskError(`Mention at most ${MAX_MENTIONS} agents in one message.`, 400, 'too_many_mentions')
    const visible = await this.visibleAgents(args)
    const { caller, lineage } = await this.callerLineage(args, visible, args.caller)
    const conversation = await this.dependencies.collaboration.getAccessibleConversation({
      actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId,
    })
    if (!conversation || (conversation.conversationType ?? 'personal') === 'personal') {
      throw new AgentAskError('That conversation was not found.', 404, 'not_found')
    }
    const participants = await this.dependencies.collaboration.listParticipants({
      actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId,
    })
    const inRoom = new Set(participants.map((participant) => participant.principalId))
    if (!inRoom.has(caller.principalId)) throw new AgentAskError('You are not part of that conversation, so you cannot post in it.', 403, 'not_in_conversation')

    const targets = args.mentions.map((mention) => {
      const agent = this.findAgent(visible, mention)
      if (!agent) throw new AgentAskError(`No agent called "${mention.trim()}" that you can mention.`, 404, 'agent_not_found')
      if (!inRoom.has(agent.principalId)) throw new AgentAskError(`${agent.name} is not in that conversation, so a mention would not reach them.`, 409, 'agent_not_in_conversation')
      return agent
    })
    const next = targets.length > 0
      ? nextLineageForMentions({
          lineage, callerAgentId: caller.id, callerName: caller.name, targetAgentIds: targets.map((target) => target.id),
          parentConversationId: args.caller.conversationId,
        })
      : null
    if (next && !next.ok) throw new AgentAskError(ASK_REFUSAL_MESSAGE[next.refusal], 409, `ask_${next.refusal}`)
    if (targets.length > 0) await this.refuseIfChainSpentTooMuch(args, lineage)

    // Posting spends the post budget; mentioning agents spends the ask budget too, one question per agent.
    const spent: Array<{ workspaceId: string; rootKey: string; turnKey: string }> = []
    const claim = async (kind: 'post' | 'root', maxRoot: number, maxTurn: number) => {
      const keys = { workspaceId: args.workspaceId, rootKey: `${kind}-root:${lineage.rootTurnId}`, turnKey: `${kind}-turn:${args.caller.turnId}` }
      const result = await this.dependencies.claimBudget({ ...keys, maxRoot, maxTurn })
      if (!result.ok) {
        throw new AgentAskError(
          result.reason === 'budget' || kind === 'root' ? ASK_REFUSAL_MESSAGE.budget : ASK_REFUSAL_MESSAGE.post_limit,
          429, kind === 'post' ? 'post_limit' : `ask_${result.reason}`,
        )
      }
      spent.push(keys)
    }
    try {
      await claim('post', MAX_AGENT_POSTS_PER_ROOT, MAX_AGENT_POSTS_PER_TURN)
      for (const _target of targets) {
        const askKeys = { workspaceId: args.workspaceId, rootKey: `root:${lineage.rootTurnId}`, turnKey: `turn:${args.caller.turnId}` }
        const result = await this.dependencies.claimBudget({ ...askKeys, maxRoot: MAX_AGENT_ASKS_PER_ROOT, maxTurn: MAX_AGENT_ASKS_PER_TURN })
        if (!result.ok) throw new AgentAskError(ASK_REFUSAL_MESSAGE[result.reason], 429, `ask_${result.reason}`)
        spent.push(askKeys)
      }
      const turnId = `post_${createHash('sha256').update(`${args.caller.turnId}:${args.conversationId}:${text}`).digest('hex').slice(0, 24)}`
      const posted = await this.postAsAgent({
        person: args, caller, conversationId: args.conversationId, content: text, turnId,
        ...(next?.ok ? { lineage: next.lineage } : {}), mentions: targets, rootKey: `root:${lineage.rootTurnId}`,
      })
      return { posted: true, messageId: posted.messageId, conversationId: args.conversationId, asked: targets.map((target) => target.name) }
    } catch (error) {
      for (const keys of spent) await this.dependencies.releaseBudget(keys).catch((_releaseError) => undefined)
      throw error
    }
  }

  /** The reply to an earlier ask that was still working. */
  async read(args: { actorUserId: string; workspaceId: string; conversationId: string; turnId: string }): Promise<AgentAskResult> {
    const accessible = await this.dependencies.collaboration.getAccessibleConversation({
      actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId,
    })
    if (!accessible) throw new AgentAskError('That conversation was not found.', 404, 'not_found')
    const reply = await this.findReply(args)
    return this.resultFrom(reply, { agent: 'The agent', conversationId: args.conversationId, turnId: args.turnId })
  }

  private cleanMessage(raw: string) {
    const message = raw.trim()
    if (!message) throw new AgentAskError('Say what you need from the agent.', 400, 'message_required')
    if (message.length > MAX_QUESTION_CHARS) throw new AgentAskError('That message is too long; shorten it.', 400, 'message_too_long')
    return message
  }

  private async visibleAgents(args: { actorUserId: string; workspaceId: string }) {
    return (await this.dependencies.directory(args.actorUserId, args.workspaceId)).filter((agent) => !agent.archivedAt)
  }

  private findAgent(visible: WorkspaceAgentDirectoryItem[], reference: string) {
    const wanted = reference.trim().toLowerCase()
    return visible.find((agent) => agent.id === reference.trim()) ?? visible.find((agent) => agent.name.trim().toLowerCase() === wanted)
  }

  private async callerLineage(person: Person, visible: WorkspaceAgentDirectoryItem[], caller: Caller) {
    const agent = visible.find((candidate) => candidate.id === caller.agentId)
    if (!agent) throw new AgentAskError('Only an agent can do that.', 403, 'caller_not_an_agent')
    const trigger = await this.triggerMessage(person, caller)
    return { caller: agent, lineage: lineageForTriggerMessage(trigger, agent.id) }
  }

  private async triggerMessage(person: Person, caller: Caller): Promise<Pick<ConversationMessageRow, 'authorKind' | 'turnId' | 'parts'>> {
    // An agent turn id is `agent_<triggering message id>_<agent id>`.
    const prefix = 'agent_'
    const suffix = `_${caller.agentId}`
    if (!caller.turnId.startsWith(prefix) || !caller.turnId.endsWith(suffix)) {
      throw new AgentAskError('This turn cannot ask other agents.', 403, 'turn_unknown')
    }
    const messageId = caller.turnId.slice(prefix.length, caller.turnId.length - suffix.length)
    const rows = await this.dependencies.collaboration.listMessages({
      actorUserId: person.actorUserId, conversationId: caller.conversationId, limit: 1, messageId, workspaceId: person.workspaceId,
    })
    const message = rows[0]
    if (!message) throw new AgentAskError('This turn cannot ask other agents.', 403, 'turn_unknown')
    return message
  }

  /** Refuses the next question once the replies this request's earlier questions started have used too much. */
  private async refuseIfChainSpentTooMuch(person: Person, lineage: AgentLineage) {
    const replies = await this.dependencies.listReplies({ workspaceId: person.workspaceId, rootKey: `root:${lineage.rootTurnId}` })
    if (replies.length === 0) return
    const byConversation = new Map<string, Set<string>>()
    for (const reply of replies) byConversation.set(reply.conversationId, (byConversation.get(reply.conversationId) ?? new Set()).add(reply.turnId))
    let used = 0
    for (const [conversationId, turnIds] of byConversation) {
      const rows = await this.dependencies.collaboration.listMessages({
        actorUserId: person.actorUserId, conversationId, limit: 50, workspaceId: person.workspaceId,
      })
      for (const row of rows) if (turnIds.has(row.turnId) && row.authorKind === 'agent') used += (row.tokens?.input ?? 0) + (row.tokens?.output ?? 0)
    }
    if (used >= MAX_CHAIN_TOKENS) throw new AgentAskError(ASK_REFUSAL_MESSAGE.spend, 429, 'ask_spend')
  }

  /** Posts a message as an agent (with a lineage when it asks someone), and starts the turns of the agents it mentions. */
  private async postAsAgent(args: {
    person: Person
    caller: WorkspaceAgentDirectoryItem
    conversationId: string
    content: string
    turnId: string
    lineage?: AgentLineage
    mentions: WorkspaceAgentDirectoryItem[]
    rootKey: string
  }) {
    const messageId = await this.dependencies.collaboration.addAgentMessage({
      actorUserId: args.person.actorUserId,
      authorPrincipalId: args.caller.principalId,
      clientNonce: args.turnId,
      content: args.content,
      conversationId: args.conversationId,
      modelId: args.caller.modelId,
      parts: [{ type: 'text', text: args.content }, ...(args.lineage ? [agentLineagePart(args.lineage)] : [])],
      turnId: args.turnId,
      workspaceId: args.person.workspaceId,
    })
    if (args.mentions.length === 0) return { messageId, turns: [] }
    const turns = await this.dependencies.startTurns({
      actorUserId: args.person.actorUserId,
      conversationId: args.conversationId,
      initiatorPrincipalId: args.person.actorPrincipalId,
      mentionedPrincipalIds: args.mentions.map((mention) => mention.principalId),
      messageId,
      prompt: args.content,
      turnId: args.turnId,
      workspaceId: args.person.workspaceId,
    })
    for (const turn of turns) {
      await this.dependencies.recordReply({
        workspaceId: args.person.workspaceId, rootKey: args.rootKey, conversationId: args.conversationId, turnId: turn.turnId,
      }).catch((_error) => undefined)
    }
    return { messageId, turns }
  }

  /** An outside app asks an agent for the person: the person's own message in the agent's direct conversation. */
  private async askAsPerson(args: Person & { target: WorkspaceAgentDirectoryItem; message: string; wait: boolean }): Promise<AgentAskResult> {
    const nowMs = (this.dependencies.now ?? Date.now)()
    const keys = {
      workspaceId: args.workspaceId,
      rootKey: `outside-hour:${args.actorUserId}:${Math.floor(nowMs / 3_600_000)}`,
      turnKey: `outside-day:${args.actorUserId}:${Math.floor(nowMs / 86_400_000)}`,
    }
    const claim = await this.dependencies.claimBudget({ ...keys, maxRoot: MAX_OUTSIDE_ASKS_PER_HOUR, maxTurn: MAX_OUTSIDE_ASKS_PER_DAY })
    if (!claim.ok) throw new AgentAskError(ASK_REFUSAL_MESSAGE.outside_limit, 429, 'ask_outside_limit')
    try {
      const room = await this.dependencies.collaboration.createDirectMessage({
        actorUserId: args.actorUserId, workspaceId: args.workspaceId, principalIds: [args.actorPrincipalId, args.target.principalId],
      })
      const content = `Asked from an outside app: ${args.message}`
      const turnId = `outside_${createHash('sha256').update(`${args.actorUserId}:${args.target.id}:${args.message}:${Math.floor(nowMs / 60_000)}`).digest('hex').slice(0, 24)}`
      const messageId = await this.dependencies.collaboration.addMessage({
        actorUserId: args.actorUserId, clientNonce: turnId, content, conversationId: room.conversationId, turnId, workspaceId: args.workspaceId,
      })
      const turns = await this.dependencies.startTurns({
        actorUserId: args.actorUserId, conversationId: room.conversationId, initiatorPrincipalId: args.actorPrincipalId,
        mentionedPrincipalIds: [args.target.principalId], messageId, prompt: content, turnId, workspaceId: args.workspaceId,
      })
      const turn = turns.find((candidate) => candidate.agentId === args.target.id)
      if (!turn) throw new AgentAskError(`${args.target.name} could not be reached.`, 502, 'agent_unreachable')
      return await this.finishAsk({ person: args, agent: args.target.name, conversationId: room.conversationId, turnId: turn.turnId, wait: args.wait })
    } catch (error) {
      await this.dependencies.releaseBudget(keys).catch((_releaseError) => undefined)
      throw error
    }
  }

  private async finishAsk(args: { person: Person; agent: string; conversationId: string; turnId: string; wait: boolean }) {
    const handle = { agent: args.agent, conversationId: args.conversationId, turnId: args.turnId }
    if (!args.wait) return { status: 'working' as const, ...handle }
    return await this.awaitReply({ actorUserId: args.person.actorUserId, workspaceId: args.person.workspaceId, ...handle })
  }

  private async findReply(args: { actorUserId: string; workspaceId: string; conversationId: string; turnId: string }) {
    const rows = await this.dependencies.collaboration.listMessages({
      actorUserId: args.actorUserId, conversationId: args.conversationId, limit: 50, workspaceId: args.workspaceId,
    })
    return rows.find((row) => row.turnId === args.turnId && row.authorKind === 'agent' && !row.deletedAt)
  }

  private resultFrom(
    reply: ConversationMessageRow | undefined,
    handle: { agent: string; conversationId: string; turnId: string },
  ): AgentAskResult {
    if (!reply || reply.status === 'generating' || reply.status === undefined && !reply.content) return { status: 'working', ...handle }
    const text = reply.content.slice(0, MAX_REPLY_CHARS)
    if (reply.status === 'error') return { status: 'failed', ...handle, error: text || `${handle.agent} could not answer.` }
    return { status: 'completed', ...handle, reply: text }
  }

  private async awaitReply(args: { actorUserId: string; workspaceId: string; agent: string; conversationId: string; turnId: string }) {
    const now = this.dependencies.now ?? Date.now
    const sleep = this.dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const deadline = now() + (this.dependencies.waitMs ?? REPLY_WAIT_MS)
    const handle = { agent: args.agent, conversationId: args.conversationId, turnId: args.turnId }
    for (;;) {
      const result = this.resultFrom(await this.findReply(args), handle)
      if (result.status !== 'working' || now() >= deadline) return result
      await sleep(REPLY_POLL_MS)
    }
  }
}
