import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const rooms = makeFunctionReference<'query'>('collaboration/archive:rooms')
const files = makeFunctionReference<'query'>('files/browse:list')

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const room = (title: string, conversationType: 'channel' | 'dm') => ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'alice', title, conversationType, scope: 'workspace', createdAt: 1, updatedAt: 1, lastModified: 1,
      lastMode: 'act', askModelIds: [], actModelId: 'm',
    } as never)
    const general = await room('general', 'channel')
    const dm = await room('alice, bob', 'dm')
    // An archived agent thread is listed with its agent, never as a DM.
    const thread = await ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'alice', title: 'agent thread', conversationType: 'dm', agentId: 'agent-1', scope: 'workspace',
      createdAt: 1, updatedAt: 1, lastModified: 1, lastMode: 'act', askModelIds: [], actModelId: 'm',
    } as never)
    const join = (conversationId: typeof general, principalId: string, archivedAt?: number) => ctx.db.insert('conversationParticipants', {
      conversationId, workspaceId: 'ws', principalId, principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1, ...(archivedAt ? { archivedAt } : {}),
    } as never)
    // Alice archived #general for herself; Bob did not. The DM is archived for Bob only.
    await join(general, 'p-alice', 5)
    await join(general, 'p-bob')
    await join(dm, 'p-alice')
    await join(dm, 'p-bob', 7)
    await join(thread, 'p-alice', 6)
    const file = (fields: Record<string, unknown>) => ctx.db.insert('files', {
      workspaceId: 'ws', userId: 'alice', type: 'file', kind: 'upload', createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    await file({ name: 'Old shared.md', scope: 'workspace', archivedAt: 9 })
    await file({ name: 'Old private.md', archivedAt: 9, archivedFromScope: 'personal' })
    await file({ name: 'Current.md', scope: 'workspace' })
    return { general, dm }
  })
  return { t, as: (subject: string) => t.withIdentity({ subject }), ids }
}

test('archived rooms are per person: each sees only the rooms they archived', async () => {
  const { as, ids } = await fixture()
  expect((await as('alice').query(rooms, { workspaceId: 'ws' }) as Array<{ _id: string; conversationType: string }>)
    .map(row => [row._id, row.conversationType])).toEqual([[ids.general, 'channel']])
  expect((await as('bob').query(rooms, { workspaceId: 'ws' }) as Array<{ _id: string }>).map(row => row._id)).toEqual([ids.dm])
  expect(await as('stranger').query(rooms, { workspaceId: 'ws' })).toBeNull()
})

test('the archived file view lists archived files the person may read, and restore shows live', async () => {
  const { t, as } = await fixture()
  const names = async (subject: string) => ((await as(subject).query(files, { workspaceId: 'ws', view: 'archived' })) as Array<{ name: string }>).map(row => row.name).sort()
  expect(await names('alice')).toEqual(['Old private.md', 'Old shared.md'])
  expect(await names('bob')).toEqual(['Old shared.md'])
  await t.run(async ctx => {
    const row = (await ctx.db.query('files').collect()).find(file => file.name === 'Old shared.md')!
    await ctx.db.patch(row._id, { archivedAt: undefined })
  })
  expect(await names('bob')).toEqual([])
})

test('older archived files stay listed behind many newer active ones', async () => {
  const { t, as } = await fixture()
  await t.run(async ctx => {
    for (let i = 0; i < 305; i++) {
      await ctx.db.insert('files', { workspaceId: 'ws', userId: 'alice', type: 'file', kind: 'upload', name: `new-${i}`, createdAt: 100 + i, updatedAt: 100 + i } as never)
    }
  })
  const rows = await as('alice').query(files, { workspaceId: 'ws', view: 'archived' }) as Array<{ name: string }>
  expect(rows.map(row => row.name).sort()).toEqual(['Old private.md', 'Old shared.md'])
})

test('a linked archived room can be included by id, and only by the member who archived it', async () => {
  const { as, ids } = await fixture()
  type Row = { _id: string }
  // Alice archived #general; Bob did not, so including it changes nothing for him.
  expect((await as('alice').query(rooms, { workspaceId: 'ws', include: ids.general }) as Row[]).map(row => row._id)).toEqual([ids.general])
  expect((await as('bob').query(rooms, { workspaceId: 'ws', include: ids.general }) as Row[]).map(row => row._id)).toEqual([ids.dm])
  // The DM is archived for Bob only; Alice cannot pull it in by id.
  expect((await as('alice').query(rooms, { workspaceId: 'ws', include: ids.dm }) as Row[]).map(row => row._id)).toEqual([ids.general])
})
