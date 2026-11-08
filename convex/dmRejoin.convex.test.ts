import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'dm-rejoin-secret'
const createDm = makeFunctionReference<'mutation'>('collaboration/directMessages:createDirectMessage')
const roomState = makeFunctionReference<'query'>('collaboration/rooms:state')
const roomList = makeFunctionReference<'query'>('collaboration/roomList:list')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'Team', slug: 'team', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
  })
  const start = () => t.mutation(createDm, { actorUserId: 'alice', workspaceId: 'ws', principalIds: ['p-bob'], serverSecret: secret }) as Promise<{ conversationId: string; created: boolean }>
  return { t, start, alice: t.withIdentity({ subject: 'alice' }) }
}

async function leave(t: Awaited<ReturnType<typeof fixture>>['t'], conversationId: string, patch: Record<string, unknown>) {
  await t.run(async ctx => {
    const row = (await ctx.db.query('conversationParticipants').collect())
      .find(participant => participant.conversationId === conversationId && participant.principalId === 'p-alice')!
    await ctx.db.patch(row._id, patch)
  })
}

test('starting a DM you left reopens it for you instead of returning a room you cannot read', async () => {
  const { t, start, alice } = await fixture()
  const first = await start()
  expect(first.created).toBe(true)
  await leave(t, first.conversationId, { status: 'removed', removedAt: 5 })
  expect(await alice.query(roomState, { workspaceId: 'ws', conversationId: first.conversationId })).toBeNull()

  const again = await start()
  expect(again).toMatchObject({ conversationId: first.conversationId, created: false })
  expect(await alice.query(roomState, { workspaceId: 'ws', conversationId: first.conversationId })).not.toBeNull()
  const { rooms } = await alice.query(roomList, { workspaceId: 'ws', kind: 'dm' }) as { rooms: Array<{ _id: string }> }
  expect(rooms.map(room => room._id)).toEqual([first.conversationId])
})

test('starting an archived DM unarchives it, and a missing participant row is recreated', async () => {
  const { t, start, alice } = await fixture()
  const first = await start()
  await leave(t, first.conversationId, { archivedAt: 9 })
  await start()
  expect(await alice.query(roomState, { workspaceId: 'ws', conversationId: first.conversationId })).not.toBeNull()

  await t.run(async ctx => {
    const row = (await ctx.db.query('conversationParticipants').collect())
      .find(participant => participant.conversationId === first.conversationId && participant.principalId === 'p-alice')!
    await ctx.db.delete(row._id)
  })
  await start()
  expect(await alice.query(roomState, { workspaceId: 'ws', conversationId: first.conversationId })).not.toBeNull()
})
