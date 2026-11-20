import 'server-only'

import { randomUUID } from 'node:crypto'
import { canManageWorkspace, type WorkspaceAccess } from '@overlay/workspace-contracts'
import type { AuditService } from '@/server/admin'
import type { AgentAskService, AgentAskResult, AgentPostResult } from '@/server/agents/agent-asks/AgentAskService'
import type { WorkspaceAgentRepository } from '@/server/agents/WorkspaceAgentRepository'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import { lineageForTriggerMessage, type AgentLineage } from '@/shared/agents/agent-lineage'
import { MCP_AGENT_MODEL_ID, mcpAgentAvailability, type McpAgentAvailability } from '@/shared/mcp/agent-network'
import type { McpPrincipal } from '../McpAccessService'
import type { McpAgentJoin, McpAgentNetworkRepository, McpInboxItem } from './McpAgentNetworkRepository'

/** Agents (pending or joined) one workspace may hold. */
export const MAX_MCP_AGENTS_PER_WORKSPACE = 50
const MAX_NAME_LENGTH = 60
const MAX_DESCRIPTION_LENGTH = 240
const MAX_MESSAGE_CHARS = 8_000
const MAX_ROOM_MESSAGE_CHARS = 4_000
/** A question an outside agent asks right after being shown another agent's message continues that agent's chain. */
const CHAIN_WINDOW_MS = 10 * 60_000
const WAIT_POLL_MS = 2_000
export const MAX_WAIT_SECONDS = 50

export class McpAgentNetworkError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'McpAgentNetworkError'
  }
}

type Collaboration = Pick<ConversationCollaborationRepository,
  'addAgentMessage' | 'addParticipant' | 'getAccessibleConversation' | 'listAccessibleConversations' | 'listMessages' | 'listParticipants'>
type Agents = Pick<WorkspaceAgentRepository, 'create' | 'archive' | 'list'>
type Asks = Pick<AgentAskService, 'ask' | 'post' | 'read' | 'list'>

/** An approved, unpaused outside agent making a request, with its owner's place in the workspace. */
export type JoinedMcpAgent = {
  join: McpAgentJoin & { agentId: string; principalId: string }
  owner: { userId: string; principalId: string; workspaceId: string }
}

export type McpAgentJoinView = {
  id: string
  name: string
  description: string
  status: 'pending' | 'approved'
  paused: boolean
  availability: McpAgentAvailability | null
  ownerUserId: string
  ownedByYou: boolean
  agentId: string | null
  requestedAt: number
  lastSeenAt: number | null
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/**
 * Outside agents as members of a workspace. Any agent that speaks MCP (ChatGPT, Claude Code, Codex…) asks to join
 * with its grant; a workspace admin approves; from then on the grant is that agent: it reads and posts in rooms under
 * its own name, asks other agents and is asked by them. MCP cannot start a turn, so what is sent to the agent waits
 * in its inbox until it collects it. The agent acts with its owner's access to the workspace, never more.
 */
export class McpAgentNetworkService {
  constructor(private readonly dependencies: {
    network: McpAgentNetworkRepository
    agents: Agents
    workspaces: { resolveActiveWorkspace(userId: string, workspaceId?: string): Promise<WorkspaceAccess> }
    collaboration: Collaboration
    asks: () => Asks
    audit: Pick<AuditService, 'record'>
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    id?: () => string
  }) {}

  // ── The agent's side ──────────────────────────────────────────────────────────────────────────────────────────

  async joinFor(principal: McpPrincipal): Promise<McpAgentJoin | null> {
    return await this.dependencies.network.getJoinByGrant(principal.grantId)
  }

  /** The agent asks to join. Nothing in the workspace changes until an admin approves. */
  async requestJoin(principal: McpPrincipal, input: { name: unknown; description?: unknown }): Promise<McpAgentJoin> {
    const name = clean(input.name, MAX_NAME_LENGTH)
    if (!name) throw new McpAgentNetworkError('Give the name this agent should have in the workspace.', 400, 'name_required')
    const description = clean(input.description, MAX_DESCRIPTION_LENGTH)
    const result = await this.dependencies.network.requestJoin({
      grantId: principal.grantId, userId: principal.userId, workspaceId: principal.workspaceId, name,
      ...(description ? { description } : {}), maxOpen: MAX_MCP_AGENTS_PER_WORKSPACE, now: this.now(),
    })
    if (!result.ok || !result.join) {
      throw new McpAgentNetworkError(
        result.reason === 'too_many_agents' ? 'This workspace already has as many outside agents as it can hold.' : 'Could not send the request to join.',
        result.reason === 'too_many_agents' ? 409 : 503, result.reason ?? 'unavailable',
      )
    }
    if (result.join.status === 'pending') {
      await this.audit('mcp.agent.join_requested', principal.userId, result.join.id, { workspaceId: principal.workspaceId, name })
    }
    return result.join
  }

  /** The acting agent for a request, or null when the grant has not joined, is paused, or was removed. */
  async resolveJoined(principal: McpPrincipal, join: McpAgentJoin | null): Promise<JoinedMcpAgent | null> {
    if (!join || join.status !== 'approved' || join.pausedAt !== undefined || !join.agentId || !join.principalId) return null
    const access = await this.dependencies.workspaces.resolveActiveWorkspace(principal.userId, principal.workspaceId)
    void this.dependencies.network.touchPresence({ joinId: join.id, now: this.now() }).catch((_error) => undefined)
    return {
      join: { ...join, agentId: join.agentId, principalId: join.principalId },
      owner: { userId: principal.userId, principalId: access.principal.id, workspaceId: access.workspace.id },
    }
  }

  async unreadCount(agent: JoinedMcpAgent): Promise<number> {
    return await this.dependencies.network.countUnread({ agentId: agent.join.agentId, now: this.now() }).catch((_error) => 0)
  }

  async checkInbox(agent: JoinedMcpAgent, options: { onlyNew?: boolean; limit?: number } = {}) {
    const items = await this.dependencies.network.collect({
      agentId: agent.join.agentId, onlyNew: options.onlyNew === true, limit: options.limit ?? 20, now: this.now(),
    })
    return items.map(inboxView)
  }

  /** Holds the request open until a message arrives or the wait ends, keeping the agent shown as connected. */
  async waitForMessages(agent: JoinedMcpAgent, timeoutSeconds?: number) {
    const sleep = this.dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const deadline = this.now() + Math.max(1, Math.min(MAX_WAIT_SECONDS, Math.floor(timeoutSeconds ?? MAX_WAIT_SECONDS))) * 1_000
    for (;;) {
      if (await this.unreadCount(agent) > 0) return await this.checkInbox(agent, { onlyNew: true })
      if (this.now() >= deadline) return []
      await sleep(WAIT_POLL_MS)
      void this.dependencies.network.touchPresence({ joinId: agent.join.id, now: this.now() }).catch((_error) => undefined)
    }
  }

  /** Answer a message from the inbox, in the room it came from, as this agent. */
  async reply(agent: JoinedMcpAgent, input: { messageId: string; text: string }) {
    const text = this.cleanMessage(input.text)
    const item = await this.dependencies.network.getInboxItem({ agentId: agent.join.agentId, itemId: input.messageId })
    if (!item) throw new McpAgentNetworkError('That message is not in your inbox. Use check_inbox to see what is waiting.', 404, 'not_found')
    if (item.repliedAt !== undefined) throw new McpAgentNetworkError('You already replied to that message. Use post_message to say more.', 409, 'already_replied')
    // Posted with the access of the person the message was sent for, who can see that room by definition.
    const postedId = await this.dependencies.collaboration.addAgentMessage({
      messagePurpose: 'agent_request', actorUserId: item.actorUserId, authorPrincipalId: agent.join.principalId,
      clientNonce: `mcp-reply:${item.turnId}`, content: text, conversationId: item.conversationId, modelId: MCP_AGENT_MODEL_ID,
      parts: [{ type: 'text', text }], turnId: item.turnId, workspaceId: agent.owner.workspaceId,
      ...(item.threadRootMessageId ? { threadRootMessageId: item.threadRootMessageId } : {}),
    }).catch((error) => { throw roomError(error) })
    await this.dependencies.network.markReplied({ agentId: agent.join.agentId, itemId: item.id, now: this.now() })
    return { replied: true, messageId: postedId, conversationId: item.conversationId }
  }

  async listRooms(agent: JoinedMcpAgent) {
    const rows = await this.dependencies.collaboration.listAccessibleConversations({
      actorUserId: agent.owner.userId, workspaceId: agent.owner.workspaceId,
    })
    return rows
      .filter((row) => (row.conversationType === 'channel' || row.conversationType === 'dm') && !row.deletedAt && !row.externalPlatform)
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 100)
      .map((row) => ({
        conversationId: row._id,
        name: row.title,
        kind: row.conversationType === 'channel' ? 'channel' : 'direct or group message',
        lastActivity: new Date(row.lastModified).toISOString(),
      }))
  }

  async readRoom(agent: JoinedMcpAgent, input: { conversationId: string; limit?: number }) {
    const base = { actorUserId: agent.owner.userId, conversationId: input.conversationId, workspaceId: agent.owner.workspaceId }
    const conversation = await this.requireRoom(base)
    const [participants, messages] = await Promise.all([
      this.dependencies.collaboration.listParticipants(base),
      this.dependencies.collaboration.listMessages({ ...base, limit: Math.max(1, Math.min(100, Math.floor(input.limit ?? 30))) }),
    ])
    const names = new Map(participants.map((participant) => [participant.principalId, participant]))
    return {
      conversationId: input.conversationId,
      name: conversation.title,
      youAreAMember: names.get(agent.join.principalId)?.status === 'active',
      members: participants.filter((participant) => participant.status === 'active')
        .map((participant) => ({ name: participant.displayName, kind: participant.principalType === 'agent' ? 'agent' : 'person' })),
      messages: [...messages].filter((message) => !message.deletedAt)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((message) => ({
          id: message._id,
          from: message.authorPrincipalId === agent.join.principalId
            ? 'you'
            : names.get(message.authorPrincipalId ?? '')?.displayName ?? message.importedAuthorName ?? (message.authorKind === 'agent' ? 'An agent' : 'Someone'),
          kind: message.authorKind === 'agent' ? 'agent' : 'person',
          text: message.content.slice(0, MAX_ROOM_MESSAGE_CHARS),
          at: new Date(message.createdAt).toISOString(),
          ...(message.status === 'generating' ? { stillWriting: true } : {}),
        })),
    }
  }

  /** Post in a room as this agent, optionally mentioning agents there (each mention is a question to that agent). */
  async post(agent: JoinedMcpAgent, input: { conversationId: string; text: string; mentions?: string[] }): Promise<AgentPostResult> {
    const base = { actorUserId: agent.owner.userId, conversationId: input.conversationId, workspaceId: agent.owner.workspaceId }
    const conversation = await this.requireRoom(base)
    const participants = await this.dependencies.collaboration.listParticipants(base)
    const member = participants.some((participant) => participant.principalId === agent.join.principalId && participant.status === 'active')
    if (!member) {
      // The owner could add the agent to this channel by hand; a private conversation needs someone in it to do so.
      if (conversation.conversationType !== 'channel') {
        throw new McpAgentNetworkError('You are not in that conversation. Someone in it has to add you first.', 403, 'not_in_conversation')
      }
      await this.dependencies.collaboration.addParticipant({ ...base, principalId: agent.join.principalId }).catch((error) => { throw roomError(error) })
    }
    return await this.dependencies.asks().post({
      actorUserId: agent.owner.userId, actorPrincipalId: agent.owner.principalId, workspaceId: agent.owner.workspaceId,
      caller: this.caller(agent), conversationId: input.conversationId, text: input.text, mentions: input.mentions ?? [],
      outsideAgent: await this.outsideCall(agent),
    })
  }

  async ask(agent: JoinedMcpAgent, input: { agent: string; message: string; wait?: boolean }): Promise<AgentAskResult> {
    return await this.dependencies.asks().ask({
      actorUserId: agent.owner.userId, actorPrincipalId: agent.owner.principalId, workspaceId: agent.owner.workspaceId,
      caller: this.caller(agent), target: input.agent, message: input.message, wait: input.wait !== false,
      outsideAgent: await this.outsideCall(agent),
    })
  }

  async readReply(agent: JoinedMcpAgent, input: { conversationId: string; turnId: string }) {
    return await this.dependencies.asks().read({
      actorUserId: agent.owner.userId, workspaceId: agent.owner.workspaceId, conversationId: input.conversationId, turnId: input.turnId,
    })
  }

  async listAgents(agent: JoinedMcpAgent) {
    return await this.dependencies.asks().list({
      actorUserId: agent.owner.userId, workspaceId: agent.owner.workspaceId, callerAgentId: agent.join.agentId,
    })
  }

  // ── Delivery: what Overlay sends to an outside agent ──────────────────────────────────────────────────────────

  /**
   * Queues a room message for the outside agents it addresses. This stands in for starting a run: the agent's
   * answer is written later, under the same turn id, when it calls `reply`.
   */
  async deliver(args: {
    actorUserId: string; workspaceId: string; conversationId: string; messageId: string; prompt: string
    threadRootMessageId?: string; targets: Array<{ agentId: string; turnId: string }>
  }): Promise<Array<{ agentId: string; turnId: string; availability: 'online' | 'away' }>> {
    if (args.targets.length === 0) return []
    const base = { actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId }
    const [rows, participants] = await Promise.all([
      this.dependencies.collaboration.listMessages({ ...base, limit: 1, messageId: args.messageId }),
      this.dependencies.collaboration.listParticipants(base),
    ])
    const message = rows[0]
    const author = participants.find((participant) => participant.principalId === message?.authorPrincipalId)
    const fromKind = message?.authorKind === 'agent' ? 'agent' as const : 'person' as const
    const fromName = author?.displayName ?? (fromKind === 'agent' ? 'An agent' : 'Someone')
    const now = this.now()
    const delivered: Array<{ agentId: string; turnId: string; availability: 'online' | 'away' }> = []
    for (const target of args.targets) {
      const lineage = message && fromKind === 'agent' ? lineageForTriggerMessage(message, target.agentId) : undefined
      const result = await this.dependencies.network.enqueue({
        agentId: target.agentId, workspaceId: args.workspaceId, conversationId: args.conversationId, messageId: args.messageId,
        turnId: target.turnId, actorUserId: args.actorUserId, fromName, fromKind,
        text: (message?.content || args.prompt).slice(0, MAX_MESSAGE_CHARS),
        ...(lineage ? { lineage } : {}), ...(args.threadRootMessageId ? { threadRootMessageId: args.threadRootMessageId } : {}), now,
      })
      if (!result.queued) continue
      const availability = mcpAgentAvailability({ lastSeenAt: result.lastSeenAt, paused: result.paused, now }) === 'online' ? 'online' : 'away'
      delivered.push({ ...target, availability })
      if (availability === 'away') void this.notifyOwnerAway(target.agentId, args.workspaceId, args.conversationId, fromName).catch((_error) => undefined)
    }
    return delivered
  }

  async availability(agentIds: string[]): Promise<Map<string, McpAgentAvailability>> {
    const now = this.now()
    const rows = await this.dependencies.network.presence(agentIds)
    return new Map(rows.map((row) => [row.agentId, mcpAgentAvailability({ lastSeenAt: row.lastSeenAt, paused: row.paused, now })]))
  }

  // ── The workspace's side: who is asking to join, and who has ──────────────────────────────────────────────────

  async listForWorkspace(args: { actorUserId: string; workspaceId: string }): Promise<{ canApprove: boolean; agents: McpAgentJoinView[] }> {
    const access = await this.dependencies.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const canApprove = canManageWorkspace(access.membership.role)
    const now = this.now()
    const joins = await this.dependencies.network.listJoins(access.workspace.id)
    return {
      canApprove,
      // A member sees who has joined, and their own requests; only an admin sees other people's pending requests.
      agents: joins.filter((join) => join.status === 'approved' || canApprove || join.userId === args.actorUserId).map((join) => ({
        id: join.id,
        name: join.name,
        description: join.description ?? '',
        status: join.status as 'pending' | 'approved',
        paused: join.pausedAt !== undefined,
        availability: join.status === 'approved' ? mcpAgentAvailability({ lastSeenAt: join.lastSeenAt, paused: join.pausedAt !== undefined, now }) : null,
        ownerUserId: join.userId,
        ownedByYou: join.userId === args.actorUserId,
        agentId: join.agentId ?? null,
        requestedAt: join.requestedAt,
        lastSeenAt: join.lastSeenAt ?? null,
      })),
    }
  }

  /** A workspace admin lets the agent in (creating its agent row) or turns it away. */
  async decide(args: { actorUserId: string; workspaceId: string; joinId: string; decision: 'approve' | 'decline' }): Promise<McpAgentJoin> {
    const access = await this.dependencies.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (!canManageWorkspace(access.membership.role)) {
      throw new McpAgentNetworkError('Only a workspace owner or admin can let an agent join.', 403, 'forbidden')
    }
    const join = await this.dependencies.network.getJoin(args.joinId)
    if (!join || join.workspaceId !== access.workspace.id || join.status !== 'pending') {
      throw new McpAgentNetworkError('That request was not found, or was already decided.', 404, 'not_found')
    }
    const now = this.now()
    if (args.decision === 'decline') {
      const declined = await this.dependencies.network.decideJoin({ joinId: join.id, workspaceId: access.workspace.id, decidedByUserId: args.actorUserId, decision: 'declined', now })
      if (!declined) throw new McpAgentNetworkError('That request was already decided.', 409, 'conflict')
      await this.audit('mcp.agent.join_declined', args.actorUserId, join.id, { workspaceId: access.workspace.id })
      return declined
    }
    // The owner must still be a member: the agent acts with their access.
    const owner = await this.dependencies.workspaces.resolveActiveWorkspace(join.userId, access.workspace.id).catch((_error) => null)
    if (!owner) throw new McpAgentNetworkError('The person who connected this agent is no longer in the workspace.', 409, 'owner_left')
    const agentId = this.id()
    const principalId = this.id()
    const name = await this.availableName(access.workspace.id, join.name)
    await this.dependencies.agents.create({
      agentId, principalId, workspaceId: access.workspace.id, name,
      ...(join.description ? { description: join.description } : {}),
      instructions: join.description || 'An outside agent that joined this workspace over MCP.',
      harness: 'mcp', modelId: MCP_AGENT_MODEL_ID, allowedToolIds: [], teamIds: [], visibility: 'workspace',
      createdByPrincipalId: owner.principal.id, now,
    })
    const approved = await this.dependencies.network.decideJoin({
      joinId: join.id, workspaceId: access.workspace.id, decidedByUserId: args.actorUserId, decision: 'approved', agentId, principalId, now,
    })
    if (!approved) {
      await this.dependencies.agents.archive({ agentId, workspaceId: access.workspace.id, now }).catch((_error) => undefined)
      throw new McpAgentNetworkError('That request was already decided.', 409, 'conflict')
    }
    await this.audit('mcp.agent.join_approved', args.actorUserId, join.id, { workspaceId: access.workspace.id, agentId })
    return approved
  }

  /** The owner or a workspace admin pauses, resumes, or removes an agent (or withdraws a pending request). */
  async update(args: { actorUserId: string; workspaceId: string; joinId: string; action: 'pause' | 'resume' | 'remove' }): Promise<McpAgentJoin> {
    const access = await this.dependencies.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const join = await this.dependencies.network.getJoin(args.joinId)
    if (!join || join.workspaceId !== access.workspace.id || (join.status !== 'approved' && join.status !== 'pending')) {
      throw new McpAgentNetworkError('That agent was not found.', 404, 'not_found')
    }
    if (join.userId !== args.actorUserId && !canManageWorkspace(access.membership.role)) {
      throw new McpAgentNetworkError('Only the person who connected this agent or a workspace admin can change it.', 403, 'forbidden')
    }
    const now = this.now()
    const updated = await this.dependencies.network.updateJoin({ joinId: join.id, workspaceId: access.workspace.id, action: args.action, now })
    if (!updated) throw new McpAgentNetworkError('That agent was not found.', 404, 'not_found')
    if (args.action === 'remove' && join.agentId) {
      await this.dependencies.agents.archive({ agentId: join.agentId, workspaceId: access.workspace.id, now }).catch((_error) => undefined)
    }
    await this.audit(`mcp.agent.${args.action}`, args.actorUserId, join.id, { workspaceId: access.workspace.id })
    return updated
  }

  /** Disconnecting the app in Settings ends the agent it joined as. */
  async onGrantRevoked(grantId: string): Promise<void> {
    const now = this.now()
    const removed = await this.dependencies.network.removeJoinByGrant({ grantId, now })
    if (removed?.agentId) {
      await this.dependencies.agents.archive({ agentId: removed.agentId, workspaceId: removed.workspaceId, now }).catch((_error) => undefined)
    }
  }

  async onAccountDeleted(userId: string): Promise<void> {
    await this.dependencies.network.deleteAllForUser(userId)
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** Rate-limit keys for an agent with no Overlay turn: its questions and posts are counted per hour. */
  private caller(agent: JoinedMcpAgent) {
    return { agentId: agent.join.agentId, conversationId: '', turnId: `mcp:${agent.join.agentId}:${Math.floor(this.now() / 3_600_000)}` }
  }

  /**
   * The chain a question or post from this agent belongs to. Right after it was shown another agent's message it
   * continues that chain, so agents passing a question between them still hit the hop limit; otherwise it starts
   * one of its own, counted per day so the daily total is bounded too.
   */
  private async outsideCall(agent: JoinedMcpAgent): Promise<{ lineage: AgentLineage; nonce: string }> {
    const now = this.now()
    const latest = await this.dependencies.network.latestDelivered({ agentId: agent.join.agentId, since: now - CHAIN_WINDOW_MS }).catch((_error) => null)
    const carried = latest && latest.fromKind === 'agent' && (latest.deliveredAt ?? 0) > now - CHAIN_WINDOW_MS ? latest.lineage : undefined
    return {
      lineage: carried ?? { rootTurnId: `mcp:${agent.join.agentId}:${Math.floor(now / 86_400_000)}`, hop: 0, chain: [agent.join.agentId] },
      nonce: randomUUID(),
    }
  }

  private async notifyOwnerAway(agentId: string, workspaceId: string, conversationId: string, fromName: string) {
    const [presence] = await this.dependencies.network.presence([agentId])
    if (!presence) return
    const owner = await this.dependencies.workspaces.resolveActiveWorkspace(presence.ownerUserId, workspaceId)
    await this.dependencies.network.notifyOwnerAway({ agentId, ownerPrincipalId: owner.principal.id, conversationId, fromName, now: this.now() })
  }

  private async requireRoom(base: { actorUserId: string; conversationId: string; workspaceId: string }) {
    const conversation = await this.dependencies.collaboration.getAccessibleConversation(base).catch((_error) => null)
    if (!conversation || (conversation.conversationType ?? 'personal') === 'personal') {
      throw new McpAgentNetworkError('That room was not found. Use list_rooms to see the rooms you can use.', 404, 'not_found')
    }
    return conversation
  }

  private async availableName(workspaceId: string, wanted: string): Promise<string> {
    const taken = new Set((await this.dependencies.agents.list({ workspaceId })).filter((agent) => !agent.archivedAt).map((agent) => agent.name.trim().toLowerCase()))
    if (!taken.has(wanted.toLowerCase())) return wanted
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${wanted} ${suffix}`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
    return `${wanted} ${this.id().slice(0, 6)}`
  }

  private cleanMessage(raw: string) {
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text) throw new McpAgentNetworkError('Write the message to send.', 400, 'message_required')
    if (text.length > MAX_MESSAGE_CHARS) throw new McpAgentNetworkError('That message is too long; shorten it.', 400, 'message_too_long')
    return text
  }

  private async audit(action: string, userId: string, resourceId: string, metadata: Record<string, unknown>) {
    await this.dependencies.audit.record({
      action, actorType: 'user', actorUserId: userId, outcome: 'success', resourceType: 'mcp_agent', resourceId, metadata,
    }).catch((_error) => undefined)
  }

  private now() { return this.dependencies.now?.() ?? Date.now() }
  private id() { return this.dependencies.id?.() ?? randomUUID() }
}

function inboxView(item: McpInboxItem) {
  return {
    messageId: item.id,
    from: item.fromName,
    fromKind: item.fromKind,
    conversationId: item.conversationId,
    text: item.text,
    receivedAt: new Date(item.createdAt).toISOString(),
  }
}

function roomError(error: unknown): McpAgentNetworkError {
  const text = String(error instanceof Error ? error.message : error)
  if (text.includes('AGENT_PARTICIPANT_REQUIRED')) return new McpAgentNetworkError('You are no longer in that conversation.', 403, 'not_in_conversation')
  return new McpAgentNetworkError('That room is not available to you any more.', 403, 'room_unavailable')
}
