import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const list = makeFunctionReference<'query'>('collaboration/roomList:list')

type Row = { _id: string; title: string; conversationType: string; otherParticipantTypes: string[] }

test('the room list shows the viewer’s own active rooms, newest first, and updates live', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaces', { workspaceId: 'other', kind: 'organization', name: 'Other', slug: 'other', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const room = (title: string, conversationType: string, lastModified: number, extra: Record<string, unknown> = {}) => ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'alice', title, conversationType, scope: 'workspace', createdAt: 1, updatedAt: 1, lastModified,
      lastMode: 'act', askModelIds: [], actModelId: 'm', ...extra,
    } as never)
    const join = (conversationId: Awaited<ReturnType<typeof room>>, principalId: string, extra: Record<string, unknown> = {}) => ctx.db.insert('conversationParticipants', {
      conversationId, workspaceId: 'ws', principalId, principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1, ...extra,
    } as never)
    const general = await room('general', 'channel', 10)
    const dm = await room('alice, bob', 'dm', 20)
    const archived = await room('old', 'channel', 30)
    const left = await room('left', 'channel', 40)
    const deleted = await room('gone', 'channel', 50, { deletedAt: 5 })
    const agentThread = await room('agent thread', 'channel', 60, { agentId: 'agent-1' })
    const automation = await room('automation', 'channel', 70, { isAutomation: true })
    const bobOnly = await room('bob only', 'channel', 80)
    for (const id of [general, dm, deleted, agentThread, automation]) await join(id, 'p-alice')
    await join(dm, 'p-bob')
    await join(archived, 'p-alice', { archivedAt: 9 })
    await join(left, 'p-alice', { status: 'removed' })
    await join(bobOnly, 'p-bob')
    return { general, dm }
  })
  const as = (subject: string) => t.withIdentity({ subject })
  const all = await as('alice').query(list, { workspaceId: 'ws', kind: 'all' }) as Row[]
  expect(all.map(row => row.title)).toEqual(['alice, bob', 'general'])
  expect(all[0].otherParticipantTypes).toEqual(['human'])
  expect((await as('alice').query(list, { workspaceId: 'ws', kind: 'channel' }) as Row[]).map(row => row.title)).toEqual(['general'])
  expect((await as('alice').query(list, { workspaceId: 'ws', kind: 'dm' }) as Row[]).map(row => row.title)).toEqual(['alice, bob'])

  // A new message moves #general to the top; archiving the DM removes it.
  await t.run(async ctx => {
    await ctx.db.patch(ids.general, { lastModified: 100 })
    const participant = (await ctx.db.query('conversationParticipants').collect())
      .find(row => row.conversationId === ids.dm && row.principalId === 'p-alice')!
    await ctx.db.patch(participant._id, { archivedAt: 101 })
  })
  expect((await as('alice').query(list, { workspaceId: 'ws', kind: 'all' }) as Row[]).map(row => row.title)).toEqual(['general'])

  // Other members see only their own rooms; strangers and other workspaces get nothing.
  expect((await as('bob').query(list, { workspaceId: 'ws', kind: 'all' }) as Row[]).map(row => row.title)).toEqual(['bob only', 'alice, bob'])
  expect(await as('stranger').query(list, { workspaceId: 'ws', kind: 'all' })).toBeNull()
  expect(await as('alice').query(list, { workspaceId: 'other', kind: 'all' })).toBeNull()
})
