import 'server-only'

import { createHash } from 'node:crypto'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import {
  agentLineagePart,
  ASK_REFUSAL_MESSAGE,
  lineageForTriggerMessage,
  MAX_AGENT_ASKS_PER_ROOT,
  MAX_AGENT_ASKS_PER_TURN,
  nextLineage,
} from '@/shared/agents/agent-lineage'
import type { ConversationMessageRow } from '@/server/conversations/ActConversationRepository'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'

const REPLY_WAIT_MS = 80_000
const REPLY_POLL_MS = 2_000
const MAX_REPLY_CHARS = 20_000
const MAX_QUESTION_CHARS = 8_000

export class AgentAskError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'AgentAskError'
  }
}

type Collaboration = Pick<ConversationCollaborationRepository,
  'createDirectMessage' | 'addAgentMessage' | 'listMessages' | 'getAccessibleConversation'>

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

/**
 * Agents asking agents. The question is posted as a message by the asking agent into a conversation of the person,
 * the asking agent, and the asked agent, and the asked agent answers it through the same turn machinery as any
 * mention, so it runs with the person's access, bills the same place, and is visible to the person.
 *
 * Which turn is asking, and so how far down a chain of questions it is, is read from the database (the message that
 * triggered the asking turn), never taken from the model.
 */
export class AgentAskService {
  constructor(private readonly dependencies: {
    collaboration: Collaboration
    /** The agents the person can see, which is also who they can ask. */
    directory: (actorUserId: string, workspaceId: string) => Promise<WorkspaceAgentDirectoryItem[]>
    /** Takes one question from the request's and the turn's budgets. */
    claimBudget: (args: { workspaceId: string; rootKey: string; turnKey: string; maxRoot: number; maxTurn: number }) => Promise<{ ok: true } | { ok: false; reason: 'budget' | 'turn_limit' }>
    /** Starts the asked agent's turn for a message; returns the turns it opened. */
    startTurns: (args: {
      actorUserId: string; conversationId: string; messageId: string; mentionedPrincipalIds: string[]
      initiatorPrincipalId: string; prompt: string; turnId: string; workspaceId: string
    }) => Promise<Array<{ agentId: string; turnId: string }>>
    /** Gives back a question taken by `claimBudget` when it could not be asked. */
    releaseBudget: (args: { workspaceId: string; rootKey: string; turnKey: string }) => Promise<void>
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

  async ask(args: {
    actorUserId: string
    actorPrincipalId: string
    workspaceId: string
    /** The asking agent and the turn it is in; the tool supplies these from the turn, not from the model. */
    callerAgentId: string
    callerConversationId: string
    callerTurnId: string
    target: string
    message: string
    wait: boolean
  }): Promise<AgentAskResult> {
    const message = args.message.trim()
    if (!message) throw new AgentAskError('Say what you need from the agent.', 400, 'message_required')
    if (message.length > MAX_QUESTION_CHARS) throw new AgentAskError('That message is too long; shorten it.', 400, 'message_too_long')

    const directory = await this.dependencies.directory(args.actorUserId, args.workspaceId)
    const visible = directory.filter((agent) => !agent.archivedAt)
    const caller = visible.find((agent) => agent.id === args.callerAgentId)
    if (!caller) throw new AgentAskError('Only an agent can ask another agent.', 403, 'caller_not_an_agent')
    const wanted = args.target.trim().toLowerCase()
    const target = visible.find((agent) => agent.id === args.target.trim())
      ?? visible.find((agent) => agent.name.trim().toLowerCase() === wanted)
    if (!target) throw new AgentAskError(`No agent called "${args.target.trim()}" that you can ask. Use list_agents to see who is available.`, 404, 'agent_not_found')

    const trigger = await this.triggerMessage(args)
    const lineage = lineageForTriggerMessage(trigger, caller.id)
    const next = nextLineage({
      lineage, callerAgentId: caller.id, callerName: caller.name, targetAgentId: target.id, asksSoFarThisTurn: 0,
    })
    if (!next.ok) throw new AgentAskError(ASK_REFUSAL_MESSAGE[next.refusal], 409, `ask_${next.refusal}`)
    const keys = { workspaceId: args.workspaceId, rootKey: `root:${lineage.rootTurnId}`, turnKey: `turn:${args.callerTurnId}` }
    const claim = await this.dependencies.claimBudget({ ...keys, maxRoot: MAX_AGENT_ASKS_PER_ROOT, maxTurn: MAX_AGENT_ASKS_PER_TURN })
    if (!claim.ok) throw new AgentAskError(ASK_REFUSAL_MESSAGE[claim.reason], 429, `ask_${claim.reason}`)
    try {
      return await this.post({ args, caller, target, next: next.lineage })
    } catch (error) {
      // Nothing reached the other agent, so the question is not spent.
      await this.dependencies.releaseBudget(keys).catch((_releaseError) => undefined)
      throw error
    }
  }

  private async post(input: {
    args: Parameters<AgentAskService['ask']>[0]
    caller: WorkspaceAgentDirectoryItem
    target: WorkspaceAgentDirectoryItem
    next: ReturnType<typeof agentLineagePart>['data']
  }): Promise<AgentAskResult> {
    const { args, caller, target } = input
    const message = args.message.trim()

    const room = await this.dependencies.collaboration.createDirectMessage({
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
      principalIds: [args.actorPrincipalId, caller.principalId, target.principalId],
      title: `${caller.name} & ${target.name}`,
    })
    const content = `Asked by ${caller.name}: ${message}`
    const questionTurnId = `ask_${createHash('sha256').update(`${args.callerTurnId}:${target.id}:${message}`).digest('hex').slice(0, 24)}`
    const messageId = await this.dependencies.collaboration.addAgentMessage({
      actorUserId: args.actorUserId,
      authorPrincipalId: caller.principalId,
      clientNonce: questionTurnId,
      content,
      conversationId: room.conversationId,
      modelId: caller.modelId,
      parts: [{ type: 'text', text: content }, agentLineagePart(input.next)],
      turnId: questionTurnId,
      workspaceId: args.workspaceId,
    })
    const turns = await this.dependencies.startTurns({
      actorUserId: args.actorUserId,
      conversationId: room.conversationId,
      initiatorPrincipalId: args.actorPrincipalId,
      mentionedPrincipalIds: [target.principalId],
      messageId,
      prompt: content,
      turnId: questionTurnId,
      workspaceId: args.workspaceId,
    })
    const turn = turns.find((candidate) => candidate.agentId === target.id)
    if (!turn) throw new AgentAskError(`${target.name} could not be reached.`, 502, 'agent_unreachable')

    const handle = { agent: target.name, conversationId: room.conversationId, turnId: turn.turnId }
    if (!args.wait) return { status: 'working', ...handle }
    return await this.awaitReply({ actorUserId: args.actorUserId, workspaceId: args.workspaceId, ...handle })
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

  private async triggerMessage(args: {
    actorUserId: string; workspaceId: string; callerAgentId: string; callerConversationId: string; callerTurnId: string
  }): Promise<Pick<ConversationMessageRow, 'authorKind' | 'turnId' | 'parts'>> {
    // An agent turn id is `agent_<triggering message id>_<agent id>`.
    const prefix = 'agent_'
    const suffix = `_${args.callerAgentId}`
    if (!args.callerTurnId.startsWith(prefix) || !args.callerTurnId.endsWith(suffix)) {
      throw new AgentAskError('This turn cannot ask other agents.', 403, 'turn_unknown')
    }
    const messageId = args.callerTurnId.slice(prefix.length, args.callerTurnId.length - suffix.length)
    const rows = await this.dependencies.collaboration.listMessages({
      actorUserId: args.actorUserId, conversationId: args.callerConversationId, limit: 1, messageId, workspaceId: args.workspaceId,
    })
    const message = rows[0]
    if (!message) throw new AgentAskError('This turn cannot ask other agents.', 403, 'turn_unknown')
    return message
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
