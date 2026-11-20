import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'mcp-agent-network-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const query = (name: string) => makeFunctionReference<'query'>(`mcp/agentNetwork:${name}`)
const mutation = (name: string) => makeFunctionReference<'mutation'>(`mcp/agentNetwork:${name}`)
const auth = { serverSecret: secret }
const request = { ...auth, grantId: 'grant_1', userId: 'user_1', workspaceId: 'ws_1', name: 'Sam\'s Claude Code', maxOpen: 2, now: 1_000 }

async function approved(convex: ReturnType<typeof convexTest>) {
  const { join } = await convex.mutation(mutation('requestJoinByServer'), request)
  await convex.mutation(mutation('decideJoinByServer'), {
    ...auth, joinId: join.id, workspaceId: 'ws_1', decidedByUserId: 'admin_1', decision: 'approved', agentId: 'agent_1', principalId: 'principal_1', now: 2_000,
  })
  return join.id as string
}

const message = (turnId: string, now: number) => ({
  ...auth, agentId: 'agent_1', workspaceId: 'ws_1', conversationId: 'conv_1', messageId: `msg_${turnId}`, turnId,
  actorUserId: 'user_2', fromName: 'Bob', fromKind: 'person', text: 'Can you check the build?', now,
})

describe('Convex MCP agent network', () => {
  test('every function rejects a wrong server secret', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.query(query('getJoinByGrantByServer'), { serverSecret: 'nope', grantId: 'x' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('requestJoinByServer'), { ...request, serverSecret: 'nope' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('enqueueInboxByServer'), { ...message('t', 1), serverSecret: 'nope' })).rejects.toThrow(/Unauthorized/)
  })

  test('a request is pending until decided, once per grant, and a workspace holds a limited number', async () => {
    const convex = convexTest(schema, modules)
    const first = await convex.mutation(mutation('requestJoinByServer'), request)
    expect(first.join).toMatchObject({ status: 'pending', name: 'Sam\'s Claude Code' })
    // Asking again while pending renames the request instead of adding one.
    const again = await convex.mutation(mutation('requestJoinByServer'), { ...request, name: 'Claude Code' })
    expect(again.join).toMatchObject({ id: first.join.id, name: 'Claude Code', status: 'pending' })
    await convex.mutation(mutation('requestJoinByServer'), { ...request, grantId: 'grant_2' })
    expect(await convex.mutation(mutation('requestJoinByServer'), { ...request, grantId: 'grant_3' })).toMatchObject({ ok: false, reason: 'too_many_agents' })
    // Approval needs the agent it creates, and a decided request cannot be decided again.
    await expect(convex.mutation(mutation('decideJoinByServer'), {
      ...auth, joinId: first.join.id, workspaceId: 'ws_1', decidedByUserId: 'admin_1', decision: 'approved', now: 2_000,
    })).rejects.toThrow(/MCP_AGENT_REQUIRED/)
    expect(await convex.mutation(mutation('decideJoinByServer'), {
      ...auth, joinId: first.join.id, workspaceId: 'ws_other', decidedByUserId: 'admin_1', decision: 'declined', now: 2_000,
    })).toBeNull()
    const declined = await convex.mutation(mutation('decideJoinByServer'), {
      ...auth, joinId: first.join.id, workspaceId: 'ws_1', decidedByUserId: 'admin_1', decision: 'declined', now: 2_000,
    })
    expect(declined).toMatchObject({ status: 'declined' })
    expect(await convex.mutation(mutation('decideJoinByServer'), {
      ...auth, joinId: first.join.id, workspaceId: 'ws_1', decidedByUserId: 'admin_1', decision: 'approved', agentId: 'a', principalId: 'p', now: 3_000,
    })).toBeNull()
    // A declined request stays declined when the agent asks again.
    expect((await convex.mutation(mutation('requestJoinByServer'), request)).join).toMatchObject({ status: 'declined' })
  })

  test('nothing is queued for an agent that has not been approved, or is paused', async () => {
    const convex = convexTest(schema, modules)
    expect(await convex.mutation(mutation('enqueueInboxByServer'), message('t1', 5_000))).toMatchObject({ queued: false })
    const joinId = await approved(convex)
    await convex.mutation(mutation('updateJoinByServer'), { ...auth, joinId, workspaceId: 'ws_1', action: 'pause', now: 3_000 })
    expect(await convex.mutation(mutation('enqueueInboxByServer'), message('t1', 5_000))).toMatchObject({ queued: false, paused: true })
    await convex.mutation(mutation('updateJoinByServer'), { ...auth, joinId, workspaceId: 'ws_1', action: 'resume', now: 4_000 })
    expect(await convex.mutation(mutation('enqueueInboxByServer'), message('t1', 5_000))).toMatchObject({ queued: true, paused: false })
  })

  test('the inbox delivers each message once, keeps it until answered, and a long-poll sees only new ones', async () => {
    const convex = convexTest(schema, modules)
    await approved(convex)
    await convex.mutation(mutation('enqueueInboxByServer'), message('t1', 5_000))
    // The same turn queued twice (a retried send) is one message.
    await convex.mutation(mutation('enqueueInboxByServer'), message('t1', 5_001))
    expect(await convex.query(query('countUnreadByServer'), { ...auth, agentId: 'agent_1', now: 6_000 })).toBe(1)
    const first = await convex.mutation(mutation('collectInboxByServer'), { ...auth, agentId: 'agent_1', onlyNew: true, limit: 20, now: 6_000 })
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ fromName: 'Bob', text: 'Can you check the build?', turnId: 't1' })
    expect(await convex.query(query('countUnreadByServer'), { ...auth, agentId: 'agent_1', now: 6_500 })).toBe(0)
    await convex.mutation(mutation('enqueueInboxByServer'), message('t2', 7_000))
    expect((await convex.mutation(mutation('collectInboxByServer'), { ...auth, agentId: 'agent_1', onlyNew: true, limit: 20, now: 7_500 })).map((item: { turnId: string }) => item.turnId)).toEqual(['t2'])
    // Unanswered messages are still listed, oldest first, until the agent replies.
    expect((await convex.mutation(mutation('collectInboxByServer'), { ...auth, agentId: 'agent_1', onlyNew: false, limit: 20, now: 8_000 })).map((item: { turnId: string }) => item.turnId)).toEqual(['t1', 't2'])
    expect(await convex.mutation(mutation('markRepliedByServer'), { ...auth, agentId: 'agent_other', itemId: first[0].id, now: 8_500 })).toBe(false)
    expect(await convex.mutation(mutation('markRepliedByServer'), { ...auth, agentId: 'agent_1', itemId: first[0].id, now: 8_500 })).toBe(true)
    expect(await convex.mutation(mutation('markRepliedByServer'), { ...auth, agentId: 'agent_1', itemId: first[0].id, now: 8_600 })).toBe(false)
    expect((await convex.mutation(mutation('collectInboxByServer'), { ...auth, agentId: 'agent_1', onlyNew: false, limit: 20, now: 9_000 })).map((item: { turnId: string }) => item.turnId)).toEqual(['t2'])
    expect(await convex.query(query('getInboxItemByServer'), { ...auth, agentId: 'agent_other', itemId: first[0].id })).toBeNull()
  })

  test('presence is throttled, and removing an agent clears what was waiting for it', async () => {
    const convex = convexTest(schema, modules)
    const joinId = await approved(convex)
    await convex.mutation(mutation('touchPresenceByServer'), { ...auth, joinId, now: 1_500 })
    expect((await convex.query(query('presenceByAgentsByServer'), { ...auth, agentIds: ['agent_1', 'missing'] }))).toEqual([{ agentId: 'agent_1', lastSeenAt: 1_000, paused: false, ownerUserId: 'user_1' }])
    await convex.mutation(mutation('touchPresenceByServer'), { ...auth, joinId, now: 60_000 })
    expect((await convex.query(query('presenceByAgentsByServer'), { ...auth, agentIds: ['agent_1'] }))[0].lastSeenAt).toBe(60_000)
    await convex.mutation(mutation('enqueueInboxByServer'), message('t1', 61_000))
    expect(await convex.mutation(mutation('updateJoinByServer'), { ...auth, joinId, workspaceId: 'ws_1', action: 'remove', now: 62_000 })).toMatchObject({ status: 'removed' })
    expect(await convex.query(query('countUnreadByServer'), { ...auth, agentId: 'agent_1', now: 63_000 })).toBe(0)
    expect(await convex.mutation(mutation('enqueueInboxByServer'), message('t2', 64_000))).toMatchObject({ queued: false })
    expect(await convex.query(query('listJoinsByWorkspaceByServer'), { ...auth, workspaceId: 'ws_1' })).toEqual([])
  })

  test('a revoked grant removes its agent', async () => {
    const convex = convexTest(schema, modules)
    await approved(convex)
    expect(await convex.mutation(mutation('removeJoinByGrantByServer'), { ...auth, grantId: 'grant_1', now: 9_000 })).toMatchObject({ status: 'removed', agentId: 'agent_1' })
    expect(await convex.mutation(mutation('removeJoinByGrantByServer'), { ...auth, grantId: 'grant_1', now: 9_500 })).toBeNull()
  })
})
