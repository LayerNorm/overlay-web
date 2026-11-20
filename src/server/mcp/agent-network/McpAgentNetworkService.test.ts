import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod/v3'
import { tool } from '@/server/ai/sdk'
import type { McpPrincipal } from '../McpAccessService'
import type { McpAgentJoin, McpAgentNetworkRepository, McpInboxItem } from './McpAgentNetworkRepository'
import { McpAgentNetworkError, McpAgentNetworkService } from './McpAgentNetworkService'
import { joinedAgentTools, joinRequestTools, joinStatusTools, withUnreadNotice } from './mcp-agent-tools'

const principal: McpPrincipal = { grantId: 'grant-1', userId: 'owner', workspaceId: 'ws', access: 'write', clientName: 'Claude Code' }

function memoryNetwork() {
  const joins = new Map<string, McpAgentJoin>()
  const inbox: McpInboxItem[] = []
  const notices: string[] = []
  let next = 0
  const repository: McpAgentNetworkRepository = {
    getJoinByGrant: async (grantId) => [...joins.values()].find((join) => join.grantId === grantId) ?? null,
    getJoin: async (joinId) => joins.get(joinId) ?? null,
    listJoins: async (workspaceId) => [...joins.values()].filter((join) => join.workspaceId === workspaceId && (join.status === 'pending' || join.status === 'approved')),
    requestJoin: async (args) => {
      const existing = [...joins.values()].find((join) => join.grantId === args.grantId)
      if (existing) return { ok: true, join: existing }
      const join: McpAgentJoin = { id: `join-${++next}`, grantId: args.grantId, userId: args.userId, workspaceId: args.workspaceId, name: args.name, description: args.description, status: 'pending', requestedAt: args.now }
      joins.set(join.id, join)
      return { ok: true, join }
    },
    decideJoin: async (args) => {
      const join = joins.get(args.joinId)
      if (!join || join.status !== 'pending') return null
      Object.assign(join, { status: args.decision, agentId: args.agentId, principalId: args.principalId, decidedAt: args.now })
      return join
    },
    updateJoin: async (args) => {
      const join = joins.get(args.joinId)
      if (!join) return null
      if (args.action === 'remove') join.status = 'removed'
      else join.pausedAt = args.action === 'pause' ? args.now : undefined
      return join
    },
    removeJoinByGrant: async ({ grantId }) => {
      const join = [...joins.values()].find((candidate) => candidate.grantId === grantId && candidate.status === 'approved')
      if (!join) return null
      join.status = 'removed'
      return join
    },
    touchPresence: async ({ joinId, now }) => { const join = joins.get(joinId); if (join) join.lastSeenAt = now },
    presence: async (agentIds) => [...joins.values()].filter((join) => join.agentId && agentIds.includes(join.agentId))
      .map((join) => ({ agentId: join.agentId!, lastSeenAt: join.lastSeenAt, paused: join.pausedAt !== undefined, ownerUserId: join.userId })),
    enqueue: async (args) => {
      const join = [...joins.values()].find((candidate) => candidate.agentId === args.agentId && candidate.status === 'approved')
      if (!join || join.pausedAt !== undefined) return { queued: false, paused: Boolean(join?.pausedAt) }
      inbox.push({ id: `item-${++next}`, conversationId: args.conversationId, messageId: args.messageId, turnId: args.turnId, actorUserId: args.actorUserId,
        fromName: args.fromName, fromKind: args.fromKind, text: args.text, lineage: args.lineage, threadRootMessageId: args.threadRootMessageId, createdAt: args.now })
      return { queued: true, lastSeenAt: join.lastSeenAt, paused: false }
    },
    notifyOwnerAway: async ({ agentId }) => { notices.push(agentId); return true },
    countUnread: async () => inbox.filter((item) => item.deliveredAt === undefined && item.repliedAt === undefined).length,
    collect: async ({ onlyNew, now }) => {
      const open = inbox.filter((item) => item.repliedAt === undefined && (!onlyNew || item.deliveredAt === undefined))
      for (const item of open) item.deliveredAt ??= now
      return open
    },
    getInboxItem: async ({ itemId }) => inbox.find((item) => item.id === itemId) ?? null,
    markReplied: async ({ itemId, now }) => { const item = inbox.find((candidate) => candidate.id === itemId); if (!item || item.repliedAt) return false; item.repliedAt = now; return true },
    latestDelivered: async ({ since }) => [...inbox].reverse().find((item) => (item.deliveredAt ?? 0) > since) ?? null,
    deleteAllForUser: async () => 0,
  }
  return { repository, joins, inbox, notices }
}

function setup(options: { roles?: Record<string, 'owner' | 'admin' | 'member'> } = {}) {
  const network = memoryNetwork()
  const roles = options.roles ?? { owner: 'member', admin: 'admin' }
  let clock = 1_000_000
  const created: Array<Record<string, unknown>> = []
  const archived: string[] = []
  const posted: Array<Record<string, unknown>> = []
  const added: string[] = []
  const asks: Array<Record<string, unknown>> = []
  const rooms: Record<string, { conversationType: 'channel' | 'dm' | 'personal'; participants: string[] }> = {
    channel: { conversationType: 'channel', participants: ['p-owner'] },
    dm: { conversationType: 'dm', participants: ['p-owner', 'p-bob'] },
    personal: { conversationType: 'personal', participants: [] },
  }
  const service = new McpAgentNetworkService({
    network: network.repository,
    agents: {
      create: async (input) => { created.push(input); return { id: input.agentId, name: input.name } as never },
      archive: async ({ agentId }) => { archived.push(agentId); return true },
      list: async () => [{ name: 'Claude Code' }] as never,
    },
    workspaces: {
      resolveActiveWorkspace: async (userId) => {
        const role = roles[userId]
        if (!role) throw new Error('no access')
        return { workspace: { id: 'ws' }, principal: { id: `p-${userId}` }, membership: { role } } as never
      },
    },
    collaboration: {
      addAgentMessage: async (args) => { posted.push(args); return 'posted-1' },
      addParticipant: async (args) => { added.push(args.principalId); rooms[args.conversationId]!.participants.push(args.principalId); return {} as never },
      getAccessibleConversation: async ({ conversationId }) => rooms[conversationId] ? { _id: conversationId, title: conversationId, conversationType: rooms[conversationId]!.conversationType } as never : null,
      listAccessibleConversations: async () => [],
      listMessages: async ({ messageId }) => messageId === 'm-agent'
        ? [{ _id: 'm-agent', authorKind: 'agent', authorPrincipalId: 'p-chief', turnId: 'ask_1', content: 'Status?', createdAt: 1, parts: [{ type: 'data-agent-lineage', data: { rootTurnId: 'root-1', hop: 1, chain: ['chief', 'agent-id'] } }] }] as never
        : [{ _id: messageId, authorKind: 'human', authorPrincipalId: 'p-bob', turnId: 't', content: 'Hello agent', createdAt: 1 }] as never,
      listParticipants: async ({ conversationId }) => [
        ...(rooms[conversationId]?.participants ?? []).filter((principalId) => principalId !== 'p-bob').map((principalId) => ({ principalId, displayName: principalId, principalType: principalId === 'p-agent' ? 'agent' : 'human', status: 'active' })),
        { principalId: 'p-bob', displayName: 'Bob', principalType: 'human', status: 'active' },
        { principalId: 'p-chief', displayName: 'Chief', principalType: 'agent', status: 'active' },
      ] as never,
    },
    asks: () => ({
      ask: async (args) => { asks.push(args); return { status: 'completed', agent: 'Chief', conversationId: 'c', turnId: 't', reply: 'ok' } },
      post: async (args) => { asks.push(args); return { posted: true, messageId: 'm', conversationId: args.conversationId, asked: [] } },
      read: async () => ({ status: 'working', agent: 'The agent', conversationId: 'c', turnId: 't' }),
      list: async () => [],
    }) as never,
    audit: { record: async () => ({}) as never },
    now: () => clock,
    sleep: async (ms) => { clock += ms },
    id: (() => { let n = 0; return () => n++ === 0 ? 'agent-id' : 'p-agent' })(),
  })
  const approve = async () => {
    const join = await service.requestJoin(principal, { name: 'Claude Code', description: 'Writes code' })
    await service.decide({ actorUserId: 'admin', workspaceId: 'ws', joinId: join.id, decision: 'approve' })
    return (await service.resolveJoined(principal, await service.joinFor(principal)))!
  }
  return { service, network, created, archived, posted, added, asks, approve, advance: (ms: number) => { clock += ms } }
}

test('a join request changes nothing until an owner or admin approves it', async () => {
  const { service, created } = setup()
  const join = await service.requestJoin(principal, { name: '  Claude\u0000 Code ' })
  assert.equal(join.status, 'pending')
  assert.equal(join.name, 'Claude Code')
  assert.equal(await service.resolveJoined(principal, join), null)
  await assert.rejects(service.decide({ actorUserId: 'owner', workspaceId: 'ws', joinId: join.id, decision: 'approve' }), (error: McpAgentNetworkError) => error.code === 'forbidden')
  assert.equal(created.length, 0)
  await assert.rejects(service.requestJoin(principal, { name: '   ' }), (error: McpAgentNetworkError) => error.code === 'name_required')
})

test('approval creates an mcp agent owned by the person who connected it, under a free name', async () => {
  const { service, created, approve } = setup()
  const agent = await approve()
  assert.equal(created.length, 1)
  // "Claude Code" is taken in this workspace, so the agent gets the next free name.
  assert.deepEqual({ harness: created[0]!.harness, name: created[0]!.name, createdByPrincipalId: created[0]!.createdByPrincipalId, visibility: created[0]!.visibility },
    { harness: 'mcp', name: 'Claude Code 2', createdByPrincipalId: 'p-owner', visibility: 'workspace' })
  assert.equal(agent.join.agentId, 'agent-id')
  assert.equal(agent.owner.principalId, 'p-owner')
  const listed = await service.listForWorkspace({ actorUserId: 'owner', workspaceId: 'ws' })
  assert.equal(listed.canApprove, false)
  assert.equal(listed.agents[0]!.status, 'approved')
})

test('a member sees only their own pending requests; an admin sees all of them', async () => {
  const { service } = setup({ roles: { owner: 'member', admin: 'admin', other: 'member' } })
  await service.requestJoin(principal, { name: 'Claude Code' })
  assert.equal((await service.listForWorkspace({ actorUserId: 'other', workspaceId: 'ws' })).agents.length, 0)
  assert.equal((await service.listForWorkspace({ actorUserId: 'owner', workspaceId: 'ws' })).agents.length, 1)
  assert.equal((await service.listForWorkspace({ actorUserId: 'admin', workspaceId: 'ws' })).agents.length, 1)
})

test('a message to an away agent is queued and its owner is told; a connected agent is online', async () => {
  const { service, network, approve, advance } = setup()
  await approve()
  advance(10 * 60_000)
  const away = await service.deliver({ actorUserId: 'bob', workspaceId: 'ws', conversationId: 'channel', messageId: 'm1', prompt: 'x', targets: [{ agentId: 'agent-id', turnId: 'agent_m1_agent-id' }] })
  assert.deepEqual(away, [{ agentId: 'agent-id', turnId: 'agent_m1_agent-id', availability: 'away' }])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(network.notices, ['agent-id'])
  assert.equal(network.inbox[0]!.fromName, 'Bob')
  assert.equal(network.inbox[0]!.text, 'Hello agent')
  // Any request from the agent marks it connected.
  await service.resolveJoined(principal, await service.joinFor(principal))
  await new Promise((resolve) => setImmediate(resolve))
  const online = await service.deliver({ actorUserId: 'bob', workspaceId: 'ws', conversationId: 'channel', messageId: 'm2', prompt: 'x', targets: [{ agentId: 'agent-id', turnId: 'agent_m2_agent-id' }] })
  assert.equal(online[0]!.availability, 'online')
  assert.equal((await service.availability(['agent-id'])).get('agent-id'), 'online')
})

test('a reply is posted as the agent, under the asked turn, with the access of the person it was sent for', async () => {
  const { service, posted, approve } = setup()
  const agent = await approve()
  await service.deliver({ actorUserId: 'bob', workspaceId: 'ws', conversationId: 'dm', messageId: 'm1', prompt: 'x', targets: [{ agentId: 'agent-id', turnId: 'agent_m1_agent-id' }] })
  const [item] = await service.waitForMessages(agent, 5)
  assert.equal(item!.from, 'Bob')
  await service.reply(agent, { messageId: item!.messageId, text: 'On it.' })
  assert.deepEqual({ actorUserId: posted[0]!.actorUserId, authorPrincipalId: posted[0]!.authorPrincipalId, turnId: posted[0]!.turnId, conversationId: posted[0]!.conversationId, content: posted[0]!.content },
    { actorUserId: 'bob', authorPrincipalId: 'p-agent', turnId: 'agent_m1_agent-id', conversationId: 'dm', content: 'On it.' })
  await assert.rejects(service.reply(agent, { messageId: item!.messageId, text: 'Again' }), (error: McpAgentNetworkError) => error.code === 'already_replied')
  assert.deepEqual(await service.checkInbox(agent), [])
  // Nothing new: the wait ends at its timeout.
  assert.deepEqual(await service.waitForMessages(agent, 4), [])
})

test('posting adds the agent to a channel its owner can use, never to a private conversation', async () => {
  const { service, added, asks, approve } = setup()
  const agent = await approve()
  await service.post(agent, { conversationId: 'channel', text: 'Hello' })
  assert.deepEqual(added, ['p-agent'])
  assert.equal((asks[0]!.caller as { agentId: string }).agentId, 'agent-id')
  await assert.rejects(service.post(agent, { conversationId: 'dm', text: 'Hello' }), (error: McpAgentNetworkError) => error.code === 'not_in_conversation')
  await assert.rejects(service.post(agent, { conversationId: 'personal', text: 'Hello' }), (error: McpAgentNetworkError) => error.code === 'not_found')
  await assert.rejects(service.readRoom(agent, { conversationId: 'missing' }), (error: McpAgentNetworkError) => error.code === 'not_found')
})

test('a question asked right after another agent\'s message continues that chain; otherwise it starts its own', async () => {
  const { service, asks, approve, advance } = setup()
  const agent = await approve()
  await service.ask(agent, { agent: 'Chief', message: 'Hi' })
  assert.deepEqual((asks[0]!.outsideAgent as { lineage: { hop: number; chain: string[] } }).lineage.hop, 0)
  await service.deliver({ actorUserId: 'owner', workspaceId: 'ws', conversationId: 'dm', messageId: 'm-agent', prompt: 'x', targets: [{ agentId: 'agent-id', turnId: 'agent_m-agent_agent-id' }] })
  await service.checkInbox(agent)
  await service.ask(agent, { agent: 'Other', message: 'Passing this on' })
  assert.deepEqual((asks[1]!.outsideAgent as { lineage: unknown }).lineage, { rootTurnId: 'root-1', hop: 1, chain: ['chief', 'agent-id'] })
  advance(11 * 60_000)
  await service.ask(agent, { agent: 'Other', message: 'Later' })
  assert.equal((asks[2]!.outsideAgent as { lineage: { hop: number } }).lineage.hop, 0)
  assert.notEqual((asks[1]!.outsideAgent as { nonce: string }).nonce, (asks[2]!.outsideAgent as { nonce: string }).nonce)
})

test('pausing stops the agent, only its owner or an admin may change it, and revoking the grant removes it', async () => {
  const { service, archived, approve } = setup({ roles: { owner: 'member', admin: 'admin', other: 'member' } })
  const agent = await approve()
  await assert.rejects(service.update({ actorUserId: 'other', workspaceId: 'ws', joinId: agent.join.id, action: 'pause' }), (error: McpAgentNetworkError) => error.code === 'forbidden')
  await service.update({ actorUserId: 'owner', workspaceId: 'ws', joinId: agent.join.id, action: 'pause' })
  assert.equal(await service.resolveJoined(principal, await service.joinFor(principal)), null)
  assert.deepEqual(await service.deliver({ actorUserId: 'bob', workspaceId: 'ws', conversationId: 'dm', messageId: 'm1', prompt: 'x', targets: [{ agentId: 'agent-id', turnId: 't' }] }), [])
  await service.update({ actorUserId: 'admin', workspaceId: 'ws', joinId: agent.join.id, action: 'resume' })
  await service.onGrantRevoked('grant-1')
  assert.deepEqual(archived, ['agent-id'])
  assert.equal(await service.resolveJoined(principal, await service.joinFor(principal)), null)
})

test('tools: only join_workspace before joining, only join_status while waiting, and an unread notice on every other result', async () => {
  const { service, approve } = setup()
  assert.deepEqual(Object.keys(joinRequestTools(principal, service)), ['join_workspace'])
  const pending = await service.requestJoin(principal, { name: 'Claude Code' })
  assert.deepEqual(Object.keys(joinStatusTools(pending)), ['join_status'])
  const agent = await approve()
  const tools = joinedAgentTools(agent, service)
  assert.deepEqual(Object.keys(tools).sort(), ['ask_agent', 'check_inbox', 'join_status', 'list_agents', 'list_rooms', 'post_message', 'read_agent_reply', 'read_room', 'reply', 'wait_for_messages'])
  const run = async (set: Record<string, unknown>, name: string) => await (set[name] as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute({}, { toolCallId: 'x', messages: [] })
  let unread = 2
  const noticed = withUnreadNotice({
    ...tools,
    echo: tool({ inputSchema: z.object({}), execute: async () => ({ ok: true }) }),
    text: tool({ inputSchema: z.object({}), execute: async () => 'plain' }),
  }, async () => unread)
  assert.deepEqual(await run(noticed, 'echo'), { ok: true, overlayInbox: 'You have 2 unread messages in Overlay. Call check_inbox to read them.' })
  assert.match(String(await run(noticed, 'text')), /^plain\n\nYou have 2 unread messages/)
  // The inbox tools carry the messages themselves.
  assert.equal('overlayInbox' in (await run(noticed, 'check_inbox') as object), false)
  unread = 0
  assert.deepEqual(await run(noticed, 'echo'), { ok: true })
  // A refused action is a tool result the agent can read, not a protocol error.
  assert.deepEqual(await run(joinedAgentTools(agent, { ...service, readRoom: async () => { throw new McpAgentNetworkError('That room was not found.', 404, 'not_found') } } as never), 'read_room'),
    { success: false, error: 'That room was not found.', code: 'not_found' })
})
