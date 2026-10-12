import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { agentLineagePart, MAX_AGENT_ASKS_PER_ROOT } from '@/shared/agents/agent-lineage'
import { AgentAskError, AgentAskService } from './AgentAskService'

const agent = (id: string, name: string, extra: Partial<WorkspaceAgentDirectoryItem> = {}): WorkspaceAgentDirectoryItem => ({
  id, name, principalId: `p-${id}`, workspaceId: 'ws', instructions: '', harness: 'overlay', modelId: 'm', allowedToolIds: [],
  invocationPolicy: 'mention', visibility: 'workspace', createdByPrincipalId: 'u', createdAt: 0, updatedAt: 0,
  teamIds: [], roomCount: 0, ...extra,
})

type Row = Record<string, unknown> & { _id: string; turnId: string }

function setup(options: { agents?: WorkspaceAgentDirectoryItem[]; trigger?: Row | null; replyAfterPolls?: number; replyStatus?: 'completed' | 'error' | 'generating'; startFails?: boolean; roomParticipants?: string[]; recorded?: Array<{ conversationId: string; turnId: string }>; replyTokens?: number; claimDenied?: 'budget' | 'turn_limit' } = {}) {
  const agents = options.agents ?? [agent('scout', 'Scout'), agent('planner', 'Planner'), agent('writer', 'Writer')]
  const trigger: Row | null = options.trigger === undefined
    ? { _id: 'm1', turnId: 'human-turn-1', authorKind: 'human', content: 'hi', role: 'user', mode: 'act', contentType: 'text', createdAt: 0 } as Row
    : options.trigger
  const posted: Array<Record<string, unknown>> = []
  const started: Array<Record<string, unknown>> = []
  const claims: Array<Record<string, unknown>> = []
  const releases: Array<Record<string, unknown>> = []
  const recordedReplies: Array<Record<string, unknown>> = []
  const personMessages: Array<Record<string, unknown>> = []
  let polls = 0
  let clock = 0
  const service = new AgentAskService({
    directory: async () => agents,
    collaboration: {
      createDirectMessage: async () => ({ conversationId: 'room-1', workspaceId: 'ws', title: '', participants: [], created: true } as never),
      addMessage: async (args: Record<string, unknown>) => { personMessages.push(args); return 'pm1' },
      listParticipants: async () => (options.roomParticipants ?? ['p-scout', 'p-planner', 'human-1']).map((principalId) => ({ principalId })) as never,
      addAgentMessage: async (args: Record<string, unknown>) => { posted.push(args); return 'q1' },
      getAccessibleConversation: async (args: { conversationId: string }) => (args.conversationId === 'missing' ? null : { _id: args.conversationId, conversationType: args.conversationId === 'personal-1' ? 'personal' : 'channel' }) as never,
      listMessages: async (args: { messageId?: string }) => {
        if (args.messageId) return trigger ? [trigger] as never : []
        polls += 1
        const after = options.replyAfterPolls ?? 0
        if (polls <= after) return []
        return [{ _id: 'r1', turnId: 'agent_q1_planner', authorKind: 'agent', status: options.replyStatus ?? 'completed', content: 'the plan', tokens: { input: options.replyTokens ?? 0, output: 0 } }] as never
      },
    },
    claimBudget: async (args) => { claims.push(args); if (options.claimDenied) return { ok: false, reason: options.claimDenied }; return claims.length > MAX_AGENT_ASKS_PER_ROOT ? { ok: false, reason: 'budget' } : { ok: true } },
    recordReply: async (args) => { recordedReplies.push(args) },
    listReplies: async () => options.recorded ?? [],
    releaseBudget: async (args) => { releases.push(args) },
    startTurns: async (args) => { if (options.startFails) throw new Error('boom'); started.push(args); return [{ agentId: 'planner', turnId: 'agent_q1_planner' }] },
    sleep: async (ms) => { clock += ms },
    now: () => clock,
    waitMs: 6_000,
  })
  const ask = (overrides: Record<string, unknown> = {}) => service.ask({
    actorUserId: 'u1', actorPrincipalId: 'human-1', workspaceId: 'ws',
    caller: { agentId: 'scout', conversationId: 'c1', turnId: 'agent_m1_scout' },
    target: 'Planner', message: 'Make a plan', wait: true, ...overrides,
  } as never)
  const post = (overrides: Record<string, unknown> = {}) => service.post({
    actorUserId: 'u1', actorPrincipalId: 'human-1', workspaceId: 'ws',
    caller: { agentId: 'scout', conversationId: 'c1', turnId: 'agent_m1_scout' },
    conversationId: 'channel-1', text: 'Update for the room', mentions: [], ...overrides,
  } as never)
  return { service, ask, post, posted, started, claims, releases, recordedReplies, personMessages }
}

test('an agent asks another by name; the question is posted by the asking agent with its lineage and the answer comes back', async () => {
  const { ask, posted, started } = setup()
  const result = await ask()
  assert.equal(result.status, 'completed')
  assert.equal(result.reply, 'the plan')
  assert.equal(result.agent, 'Planner')
  assert.equal(posted[0]!.authorPrincipalId, 'p-scout')
  assert.match(String(posted[0]!.content), /^Asked by Scout: Make a plan/)
  const lineage = (posted[0]!.parts as Array<{ type: string; data?: unknown }>).find((part) => part.type === 'data-agent-lineage')!.data
  assert.deepEqual(lineage, { rootTurnId: 'human-turn-1', hop: 1, chain: ['scout', 'planner'], askedByAgentId: 'scout', askedByName: 'Scout', parentConversationId: 'c1' })
  assert.deepEqual(started[0]!.mentionedPrincipalIds, ['p-planner'])
  assert.equal(started[0]!.initiatorPrincipalId, 'human-1', 'the asked agent acts for the person, not for the asking agent')
})

test('the same question asked twice is the same message', async () => {
  const { ask, posted } = setup()
  await ask()
  await ask()
  assert.equal(posted[0]!.clientNonce, posted[1]!.clientNonce)
})

test('without wait it returns a handle at once; a reply that is slow becomes a handle too, and read finds it later', async () => {
  const quick = setup()
  const handle = await quick.ask({ wait: false })
  assert.equal(handle.status, 'working')
  assert.equal(handle.turnId, 'agent_q1_planner')

  const slow = setup({ replyAfterPolls: 99 })
  const result = await slow.ask()
  assert.equal(result.status, 'working')
  assert.equal(result.conversationId, 'room-1')

  const later = setup()
  const read = await later.service.read({ actorUserId: 'u1', workspaceId: 'ws', conversationId: 'room-1', turnId: 'agent_q1_planner' })
  assert.equal(read.status, 'completed')
  assert.equal(read.reply, 'the plan')
})

test('a failed reply is reported as failed, not as an answer', async () => {
  const { ask } = setup({ replyStatus: 'error' })
  const result = await ask()
  assert.equal(result.status, 'failed')
  assert.equal(result.reply, undefined)
})

test('an agent cannot ask itself, an agent already in the chain, or someone the person cannot see', async () => {
  const code = async (promise: Promise<unknown>) => (await promise.then(() => null, (error: unknown) => error)) as AgentAskError | null
  assert.equal((await code(setup().ask({ target: 'scout' })))?.code, 'ask_self')

  const chained = setup({ trigger: { _id: 'm1', turnId: 'ask-9', authorKind: 'agent', parts: [agentLineagePart({ rootTurnId: 'r', hop: 1, chain: ['writer', 'scout'], askedByAgentId: 'writer' })] } as Row })
  assert.equal((await code(chained.ask({ target: 'Writer' })))?.code, 'ask_cycle')

  assert.equal((await code(setup().ask({ target: 'Nobody' })))?.code, 'agent_not_found')
  const hidden = setup({ agents: [agent('scout', 'Scout'), agent('planner', 'Planner', { archivedAt: 1 })] })
  assert.equal((await code(hidden.ask()))?.code, 'agent_not_found')
})

test('the chain stops at the hop limit, and a refusal spends nothing', async () => {
  const deep = setup({ trigger: { _id: 'm1', turnId: 'ask-9', authorKind: 'agent', parts: [agentLineagePart({ rootTurnId: 'r', hop: 3, chain: ['a', 'b', 'c', 'scout'], askedByAgentId: 'c' })] } as Row })
  await assert.rejects(deep.ask(), (error: AgentAskError) => error.code === 'ask_hop_limit')
  assert.equal(deep.claims.length, 0)
  assert.equal(deep.posted.length, 0)
})

test('the budget refuses before anything is posted, and an unknown or foreign turn cannot ask at all', async () => {
  const spent = setup()
  spent.claims.push(...Array.from({ length: MAX_AGENT_ASKS_PER_ROOT }, () => ({})))
  await assert.rejects(spent.ask(), (error: AgentAskError) => error.code === 'ask_budget')
  assert.equal(spent.posted.length, 0)

  await assert.rejects(setup({ trigger: null }).ask(), (error: AgentAskError) => error.code === 'turn_unknown')
  await assert.rejects(setup().ask({ caller: { agentId: 'scout', conversationId: 'c1', turnId: 'agent_m1_planner' } }), (error: AgentAskError) => error.code === 'turn_unknown')
  await assert.rejects(setup().ask({ caller: { agentId: 'ghost', conversationId: 'c1', turnId: 'agent_m1_ghost' } }), (error: AgentAskError) => error.code === 'caller_not_an_agent')
})

test('list shows the agents that can be asked, not the caller and not archived ones', async () => {
  const { service } = setup({ agents: [agent('scout', 'Scout'), agent('planner', 'Planner', { description: 'Plans' }), agent('old', 'Old', { archivedAt: 1 }), agent('cc', 'Claude Code', { harness: 'claude-code' })] })
  const list = await service.list({ actorUserId: 'u1', workspaceId: 'ws', callerAgentId: 'scout' })
  assert.deepEqual(list.map((entry) => [entry.name, entry.kind.startsWith('Overlay')]), [['Planner', true], ['Claude Code', false]])
})

test('a question that could not be delivered is given back to the budget', async () => {
  const failing = setup({ startFails: true })
  await assert.rejects(failing.ask(), /boom/)
  assert.equal(failing.claims.length, 1)
  assert.deepEqual(failing.releases, [{ workspaceId: 'ws', rootKey: 'root:human-turn-1', turnKey: 'turn:agent_m1_scout' }])
  const fine = setup()
  await fine.ask()
  assert.equal(fine.releases.length, 0)
})

test('the question carries a link back to the conversation the asking turn was in', async () => {
  const { ask, posted } = setup()
  await ask()
  const lineage = (posted[0]!.parts as Array<{ type: string; data?: { parentConversationId?: string } }>).find((part) => part.type === 'data-agent-lineage')!.data
  assert.equal(lineage!.parentConversationId, 'c1')
})

test('an agent posts into a conversation it is part of; mentioned agents answer there and count as questions', async () => {
  const room = setup({ roomParticipants: ['p-scout', 'p-planner', 'human-1'] })
  const result = await room.post({ mentions: ['Planner'] })
  assert.deepEqual(result, { posted: true, messageId: 'q1', conversationId: 'channel-1', asked: ['Planner'] })
  assert.equal(room.posted[0]!.conversationId, 'channel-1')
  assert.equal(room.posted[0]!.authorPrincipalId, 'p-scout')
  const lineage = (room.posted[0]!.parts as Array<{ type: string; data?: unknown }>).find((part) => part.type === 'data-agent-lineage')!.data as { hop: number; chain: string[] }
  assert.equal(lineage.hop, 1)
  assert.deepEqual(lineage.chain, ['scout', 'planner'])
  assert.deepEqual(room.started[0]!.mentionedPrincipalIds, ['p-planner'])
  assert.equal(room.claims.length, 2, 'one post and one question were taken from the budgets')
  assert.equal(room.recordedReplies.length, 1)

  const plain = setup()
  await plain.post()
  assert.equal(plain.started.length, 0, 'a post that mentions nobody starts nobody')
  assert.equal(plain.posted[0]!.parts && (plain.posted[0]!.parts as Array<{ type: string }>).some((part) => part.type === 'data-agent-lineage'), false)
})

test('posting is refused outside the person\'s reach: a personal chat, an unseen conversation, a room the agent is not in, or a mention of someone not there', async () => {
  const code = async (promise: Promise<unknown>) => (await promise.then(() => null, (error: unknown) => error)) as AgentAskError | null
  assert.equal((await code(setup().post({ conversationId: 'missing' })))?.code, 'not_found')
  assert.equal((await code(setup().post({ conversationId: 'personal-1' })))?.code, 'not_found')
  assert.equal((await code(setup({ roomParticipants: ['p-planner', 'human-1'] }).post()))?.code, 'not_in_conversation')
  assert.equal((await code(setup({ roomParticipants: ['p-scout', 'human-1'] }).post({ mentions: ['Planner'] })))?.code, 'agent_not_in_conversation')
  assert.equal((await code(setup().post({ mentions: ['scout'] })))?.code, 'ask_self')
  assert.equal((await code(setup().post({ mentions: ['Planner', 'Writer', 'Scout', 'Extra'] })))?.code, 'too_many_mentions')
})

test('a chain that has used its token budget cannot ask again, and a refusal posts nothing', async () => {
  const spent = setup({ recorded: [{ conversationId: 'room-1', turnId: 'agent_q1_planner' }], replyTokens: 600_000 })
  await assert.rejects(spent.ask(), (error: AgentAskError) => error.code === 'ask_spend')
  assert.equal(spent.posted.length, 0)
  assert.equal(spent.claims.length, 0)

  const fine = setup({ recorded: [{ conversationId: 'room-1', turnId: 'agent_q1_planner' }], replyTokens: 1_000 })
  assert.equal((await fine.ask()).status, 'completed')
})

test('an outside app asks an agent as the person: their own message, a fresh chain, limited per hour and per day', async () => {
  const outside = setup()
  const result = await outside.service.ask({ actorUserId: 'u1', actorPrincipalId: 'human-1', workspaceId: 'ws', target: 'Planner', message: 'Plan my week', wait: true })
  assert.equal(result.status, 'completed')
  assert.equal(outside.personMessages.length, 1)
  assert.equal(outside.posted.length, 0, 'no agent speaks for the person')
  assert.match(String(outside.personMessages[0]!.content), /^Asked from an outside app: Plan my week/)
  assert.deepEqual(outside.started[0]!.mentionedPrincipalIds, ['p-planner'])
  assert.match(String(outside.claims[0]!.rootKey), /^outside-hour:u1:/)

  const limited = setup({ claimDenied: 'budget' })
  await assert.rejects(
    limited.service.ask({ actorUserId: 'u1', actorPrincipalId: 'human-1', workspaceId: 'ws', target: 'Planner', message: 'x', wait: true }),
    (error: AgentAskError) => error.code === 'ask_outside_limit',
  )
  assert.equal(limited.personMessages.length, 0)
})
