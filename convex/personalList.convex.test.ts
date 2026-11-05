import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const list = makeFunctionReference<'query'>('chat/personal:list')
const getSummary = makeFunctionReference<'query'>('chat/personal:getSummary')
const rename = makeFunctionReference<'mutation'>('chat/personal:rename')
const archive = makeFunctionReference<'mutation'>('chat/personal:setArchived')
const read = makeFunctionReference<'mutation'>('chat/personal:setRead')

async function fixture() {
  const t = convexTest(schema, modules)
  const conversationId = await t.run(async ctx => {
    await ctx.db.insert('authorizationRoles', { roleId: 'member', name: 'Member', capabilities: ['conversations.read', 'conversations.edit'], isSystem: false, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId: 'u', createdAt: 1 })
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: 'p', userId: 'u', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: 'p', membershipId: 'm', role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    return ctx.db.insert('conversations', { workspaceId: 'ws', userId: 'u', title: 'Original', askModelIds: [], actModelId: 'model', lastMode: 'act', createdAt: 1, lastModified: 1 })
  })
  const user = t.withIdentity({ subject: 'u' })
  const args = { workspaceId: 'ws', conversationId }
  const page = { workspaceId: 'ws', archived: false, paginationOpts: { numItems: 2, cursor: null } }
  return { t, user, args, page }
}

test('native lists converge on rename, archive and restore; repeats do not duplicate events or participants', async () => {
  const { t, user, args, page } = await fixture()
  const observer = t.withIdentity({ subject: 'u' })
  await user.mutation(rename, { ...args, title: '  Renamed! ' })
  expect((await observer.query(list, page)).page[0].title).toBe('Renamed')
  await user.mutation(archive, { ...args, archived: true })
  await user.mutation(archive, { ...args, archived: true })
  expect((await observer.query(list, page)).page).toEqual([])
  expect((await observer.query(list, { ...page, archived: true })).page).toHaveLength(1)
  await user.mutation(archive, { ...args, archived: false })
  expect((await observer.query(list, page)).page).toHaveLength(1)
  expect(await t.run(ctx => ctx.db.query('conversationParticipants').collect())).toHaveLength(1)
  expect(await t.run(ctx => ctx.db.query('conversationEvents').collect())).toHaveLength(3)
  await expect(t.withIdentity({ subject: 'other' }).mutation(rename, { ...args, title: 'Spoof' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('pagination preserves its cursor across excluded rows, equal timestamps and legacy automation bindings', async () => {
  const { t, user, args, page } = await fixture()
  await t.run(async ctx => {
    for (let i = 0; i < 4; i++) {
      await ctx.db.insert('conversations', { workspaceId: 'ws', userId: 'u', title: `Eligible ${i}`, askModelIds: [], actModelId: 'model', lastMode: 'act', createdAt: 1, lastModified: 1 })
    }
    await ctx.db.insert('automations', { workspaceId: 'ws', userId: 'u', conversationId: args.conversationId, createdAt: 1, updatedAt: 1 })
  })
  const ids: string[] = []
  let cursor: string | null = null
  let done = false
  while (!done) {
    const result = await user.query(list, { ...page, paginationOpts: { numItems: 2, cursor } })
    ids.push(...result.page.map((row: { _id: string }) => row._id))
    cursor = result.continueCursor
    done = result.isDone
  }
  expect(ids).toHaveLength(4)
  expect(new Set(ids).size).toBe(4)
  expect(ids).not.toContain(args.conversationId)
  await expect(user.mutation(rename, { ...args, title: 'Automation' })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
})

test('read acknowledgement is bounded by the observed message, not a later completion', async () => {
  const { t, user, args } = await fixture()
  const [first, second] = await t.run(async ctx => Promise.all([2, 3].map(createdAt => ctx.db.insert('conversationMessages', {
    conversationId: args.conversationId,
    userId: 'u',
    turnId: `turn-${createdAt}`,
    role: 'assistant',
    mode: 'act',
    content: 'QA',
    contentType: 'text',
    createdAt,
  }))))
  await user.mutation(read, { ...args, unread: false, throughMessageId: first })
  expect((await user.query(getSummary, args)).unread).toBe(true)
  await user.mutation(read, { ...args, unread: false, throughMessageId: second })
  await user.mutation(read, { ...args, unread: false, throughMessageId: first })
  expect((await user.query(getSummary, args)).unread).toBe(false)
  await user.mutation(read, { ...args, unread: true })
  expect((await user.query(getSummary, args)).unread).toBe(true)
})

test('native operations enforce current direct and group capabilities independently of ownership', async () => {
  const { t, user, args, page } = await fixture()
  await t.run(async ctx => {
    const role = await ctx.db.query('authorizationRoles').first()
    await ctx.db.patch(role!._id, { capabilities: ['conversations.read'] })
  })
  expect((await user.query(list, page)).page).toHaveLength(1)
  await expect(user.mutation(rename, { ...args, title: 'Denied' })).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  const groupId = await t.run(async ctx => {
    await ctx.db.insert('authorizationRoles', { roleId: 'editors', name: 'Editors', capabilities: ['conversations.edit'], isSystem: false, createdAt: 1, updatedAt: 1 })
    const id = await ctx.db.insert('authorizationGroups', { groupId: 'editors', name: 'Editors', source: 'local', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('authorizationGroupMemberships', { groupId: 'editors', userId: 'u', source: 'local', createdAt: 1 })
    await ctx.db.insert('authorizationGroupRoles', { groupId: 'editors', roleId: 'editors', createdAt: 1 })
    return id
  })
  await user.mutation(rename, { ...args, title: 'Allowed' })
  await t.run(ctx => ctx.db.patch(groupId, { archivedAt: 2 }))
  await expect(user.mutation(rename, { ...args, title: 'Denied again' })).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  await t.run(async ctx => {
    const role = await ctx.db.query('authorizationRoles').withIndex('by_roleId', q => q.eq('roleId', 'member')).unique()
    await ctx.db.patch(role!._id, { archivedAt: 2 })
  })
  await expect(user.query(list, page)).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  await expect(user.mutation(archive, { ...args, archived: true })).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
})
