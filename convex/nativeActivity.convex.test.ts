import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const notifications = makeFunctionReference<'query'>('collaboration/activity:notifications')
const markRead = makeFunctionReference<'mutation'>('collaboration/activity:markRead')

type Row = { id: string; readAt?: number; conversationType?: string; conversationId: string }

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const room = (title: string, conversationType: 'dm' | 'channel') => ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'bob', title, conversationType, scope: 'workspace',
      askModelIds: ['model'], actModelId: 'model', lastMode: 'act', createdAt: 1, lastModified: 1,
    } as never)
    const channel = await room('general', 'channel')
    const dm = await room('bob', 'dm')
    return { channel, dm }
  })
  const notify = (notificationId: string, conversationId: unknown, createdAt: number) => t.run(ctx => ctx.db.insert('workspaceNotifications', {
    notificationId, workspaceId: 'ws', recipientPrincipalId: 'p-alice', type: 'mention', conversationId,
    actorPrincipalId: 'p-bob', title: 'Bob mentioned you', createdAt,
  } as never))
  return { t, ids, notify, alice: t.withIdentity({ subject: 'alice' }), bob: t.withIdentity({ subject: 'bob' }) }
}

test('notifications carry their room type, so opening one needs no lookup', async () => {
  const { alice, ids, notify } = await fixture()
  await notify('n-channel', ids.channel, 1)
  await notify('n-dm', ids.dm, 2)
  const rows = await alice.query(notifications, { workspaceId: 'ws' }) as Row[]
  expect(Object.fromEntries(rows.map(row => [row.id, row.conversationType]))).toEqual({ 'n-channel': 'channel', 'n-dm': 'dm' })
})

test('marking what was seen leaves a notification that arrived meanwhile unread', async () => {
  const { alice, ids, notify } = await fixture()
  await notify('seen', ids.channel, 1)
  const seen = (await alice.query(notifications, { workspaceId: 'ws' }) as Row[]).map(row => row.id)
  await notify('arrived', ids.channel, 2)
  expect(await alice.mutation(markRead, { workspaceId: 'ws', notificationIds: seen })).toBe(1)
  const rows = await alice.query(notifications, { workspaceId: 'ws' }) as Row[]
  const firstReadAt = rows.find(row => row.id === 'seen')?.readAt
  expect(firstReadAt).toBeTypeOf('number')
  expect(rows.find(row => row.id === 'arrived')?.readAt).toBeUndefined()
  // Read time is monotonic: marking again neither moves it nor counts it.
  expect(await alice.mutation(markRead, { workspaceId: 'ws', notificationIds: seen })).toBe(0)
  expect((await alice.query(notifications, { workspaceId: 'ws' }) as Row[]).find(row => row.id === 'seen')?.readAt).toBe(firstReadAt)
})

test('opening a room marks only that room read', async () => {
  const { alice, ids, notify } = await fixture()
  await notify('in-channel', ids.channel, 1)
  await notify('in-dm', ids.dm, 2)
  await alice.mutation(markRead, { workspaceId: 'ws', conversationId: ids.channel })
  const rows = await alice.query(notifications, { workspaceId: 'ws' }) as Row[]
  expect(rows.find(row => row.id === 'in-channel')?.readAt).toBeTypeOf('number')
  expect(rows.find(row => row.id === 'in-dm')?.readAt).toBeUndefined()
})

test('each member sees only their own notifications, and outsiders read nothing', async () => {
  const { t, bob, ids, notify } = await fixture()
  await notify('for-alice', ids.channel, 1)
  expect(await bob.query(notifications, { workspaceId: 'ws' })).toEqual([])
  expect(await bob.mutation(markRead, { workspaceId: 'ws', notificationIds: ['for-alice'] })).toBe(0)
  expect(await t.withIdentity({ subject: 'stranger' }).query(notifications, { workspaceId: 'ws' })).toBeNull()
  expect(await t.query(notifications, { workspaceId: 'ws' })).toBeNull()
})
