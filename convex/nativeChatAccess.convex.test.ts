import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const query = (name: string) => makeFunctionReference<'query'>(name)
const mutation = (name: string) => makeFunctionReference<'mutation'>(name)
const list = query('chat/personal:list')
const summary = query('chat/personal:getSummary')
const page = { numItems: 20, cursor: null }
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('authorizationRoles', {
      roleId: 'member', name: 'Member', capabilities: ['conversations.read', 'conversations.create', 'conversations.edit', 'conversations.delete'],
      isSystem: true, createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['owner', 'member']) {
      await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId, createdAt: 1 })
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const chat = (fields: Record<string, unknown>) => ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'owner', title: 'Chat', askModelIds: ['model'], actModelId: 'model', lastMode: 'act',
      createdAt: 1, lastModified: 1, ...fields,
    } as never)
    return {
      personal: await chat({ scope: 'personal' }),
      workspace: await chat({ scope: 'workspace' }),
      automation: await chat({ isAutomation: true }),
      agent: await chat({ agentId: 'agent' }),
      dm: await chat({ conversationType: 'dm', scope: 'workspace' }),
    }
  })
  return { t, ids, owner: t.withIdentity({ subject: 'owner' }), member: t.withIdentity({ subject: 'member' }) }
}

const submitArgs = (conversationId: unknown, turnId: string) => ({
  workspaceId: 'ws', conversationId, turnId, mode: 'act', modelId: 'model', contentType: 'text',
  parts: [{ type: 'text', text: `Prompt ${turnId}` }],
})

test('lists separate personal and workspace chats and hide automation, agent and room chats', async () => {
  const { owner, ids } = await fixture()
  const rows = async (scope: string) => (await owner.query(list, { workspaceId: 'ws', archived: false, scope, paginationOpts: page })).page.map((row: { _id: string }) => row._id)
  expect(await rows('personal')).toEqual([ids.personal])
  expect(await rows('workspace')).toEqual([ids.workspace])
  expect(await owner.query(summary, { workspaceId: 'ws', conversationId: ids.automation })).toMatchObject({ kind: 'automation', scope: 'personal' })
  expect(await owner.query(summary, { workspaceId: 'ws', conversationId: ids.workspace })).toMatchObject({ kind: 'workspace', scope: 'workspace' })
  expect(await owner.query(summary, { workspaceId: 'ws', conversationId: ids.agent })).toBeNull()
  expect(await owner.query(summary, { workspaceId: 'ws', conversationId: ids.dm })).toBeNull()
})

test('another workspace member cannot read or change any AI chat, even one filed under Workspace', async () => {
  const { owner, member, ids } = await fixture()
  await owner.mutation(mutation('chat/personal:submit'), submitArgs(ids.workspace, 'turn'))
  expect((await member.query(list, { workspaceId: 'ws', archived: false, scope: 'workspace', paginationOpts: page })).page).toEqual([])
  for (const conversationId of [ids.personal, ids.workspace, ids.automation]) {
    const args = { workspaceId: 'ws', conversationId }
    expect(await member.query(summary, args)).toBeNull()
    await expect(member.query(query('chat/personal:getMessages'), { ...args, paginationOpts: page })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(member.query(query('chat/personal:getExecution'), args)).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(member.mutation(mutation('chat/personal:submit'), submitArgs(conversationId, 'attack'))).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(member.mutation(mutation('chat/personal:rename'), { ...args, title: 'Taken' })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(member.mutation(mutation('chat/personal:setArchived'), { ...args, archived: true })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(member.mutation(mutation('chat/personal:deleteTurn'), { ...args, turnId: 'turn' })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(member.mutation(mutation('chat/personal:branch'), { ...args, turnId: 'turn', clientId: 'steal' })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
    await expect(member.mutation(mutation('chat/personal:addAssistantNote'), { ...args, turnId: 'turn', text: 'Forged' })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  }
})

test('removing a member, or signing out, ends access to their own chats', async () => {
  const { t, owner, ids } = await fixture()
  const args = { workspaceId: 'ws', conversationId: ids.workspace }
  await expect(t.query(summary, args)).rejects.toThrow('UNAUTHENTICATED')
  await t.run(async ctx => {
    const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'ws').eq('principalId', 'p-owner')).unique()
    await ctx.db.patch(membership!._id, { status: 'suspended' })
  })
  await expect(owner.query(summary, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('parallel transcript reads return only authorized rows and preserve strict callers', async () => {
  const { t, owner, member, ids } = await fixture()
  const getMessages = query('chat/personal:getMessages')
  const args = { workspaceId: 'ws', conversationId: ids.personal, paginationOpts: page, unavailableAsEmpty: true }
  await owner.mutation(mutation('chat/personal:submit'), submitArgs(ids.personal, 'allowed'))
  expect((await owner.query(getMessages, args)).page).toHaveLength(1)
  expect(await member.query(getMessages, args)).toMatchObject({ page: [], isDone: true })
  await expect(member.query(getMessages, { ...args, unavailableAsEmpty: false })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  for (const conversationId of [ids.agent, ids.dm]) {
    expect(await owner.query(getMessages, { ...args, conversationId })).toMatchObject({ page: [], isDone: true })
  }
  await t.run(ctx => ctx.db.patch(ids.personal, { deletedAt: 2 }))
  expect(await owner.query(getMessages, args)).toMatchObject({ page: [], isDone: true })
})

test('parallel transcript reads enforce conversation workspace even when viewer belongs to both workspaces', async () => {
  const { t, owner } = await fixture()
  const getMessages = query('chat/personal:getMessages')
  const foreignConversationId = await t.run(async ctx => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'ws-foreign', kind: 'organization', name: 'Foreign', slug: 'qa-foreign',
      status: 'active', createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspacePrincipals', {
      workspaceId: 'ws-foreign', principalId: 'p-owner-foreign', userId: 'owner',
      type: 'human', displayName: 'owner', createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspaceMemberships', {
      workspaceId: 'ws-foreign', principalId: 'p-owner-foreign', membershipId: 'm-owner-foreign',
      role: 'member', status: 'active', joinedAt: 1, updatedAt: 1,
    })
    return ctx.db.insert('conversations', {
      workspaceId: 'ws-foreign', userId: 'owner', title: 'Foreign chat', askModelIds: ['model'],
      actModelId: 'model', lastMode: 'act', createdAt: 1, lastModified: 1, scope: 'personal',
    } as never)
  })

  expect(await owner.query(summary, { workspaceId: 'ws-foreign', conversationId: foreignConversationId }))
    .toMatchObject({ workspaceId: 'ws-foreign' })

  const crossWorkspaceArgs = {
    workspaceId: 'ws', conversationId: foreignConversationId, paginationOpts: page, unavailableAsEmpty: true,
  }
  expect(await owner.query(getMessages, crossWorkspaceArgs))
    .toMatchObject({ page: [], isDone: true, continueCursor: '' })
  await expect(owner.query(getMessages, { ...crossWorkspaceArgs, unavailableAsEmpty: false }))
    .rejects.toThrow('CONVERSATION_ACCESS_DENIED')
})

test('optional transcript reads return empty for a valid missing ID while strict callers deny it', async () => {
  const { t, owner, ids } = await fixture()
  const getMessages = query('chat/personal:getMessages')
  await t.run(ctx => ctx.db.delete(ids.personal))

  const args = { workspaceId: 'ws', conversationId: ids.personal, paginationOpts: page, unavailableAsEmpty: true }
  expect(await owner.query(getMessages, args)).toMatchObject({ page: [], isDone: true, continueCursor: '' })
  await expect(owner.query(getMessages, { ...args, unavailableAsEmpty: false }))
    .rejects.toThrow('CONVERSATION_ACCESS_DENIED')
})

test('optional transcript reads do not bypass authentication, membership or capability checks', async () => {
  const { t, owner, ids } = await fixture()
  const getMessages = query('chat/personal:getMessages')
  const args = { workspaceId: 'ws', conversationId: ids.workspace, paginationOpts: page, unavailableAsEmpty: true }
  await expect(t.query(getMessages, args)).rejects.toThrow('UNAUTHENTICATED')
  await t.run(async ctx => {
    const role = await ctx.db.query('authorizationRoles').withIndex('by_roleId', q => q.eq('roleId', 'member')).unique()
    await ctx.db.patch(role!._id, { capabilities: [] })
  })
  await expect(owner.query(getMessages, args)).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  await t.run(async ctx => {
    const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'ws').eq('principalId', 'p-owner')).unique()
    await ctx.db.patch(membership!._id, { status: 'suspended' })
  })
  await expect(owner.query(getMessages, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('a new chat keeps the scope it was created in', async () => {
  const { owner } = await fixture()
  const { conversationId } = await owner.mutation(mutation('chat/personal:submit'), {
    ...submitArgs(undefined, 'first'), clientId: 'client', title: 'New conversation', scope: 'workspace',
  })
  expect(await owner.query(summary, { workspaceId: 'ws', conversationId })).toMatchObject({ scope: 'workspace', kind: 'workspace' })
})

test('deleting a turn removes only that turn', async () => {
  const { t, owner, ids } = await fixture()
  const submit = mutation('chat/personal:submit')
  await owner.mutation(submit, submitArgs(ids.workspace, 'keep'))
  await owner.mutation(submit, submitArgs(ids.workspace, 'drop'))
  expect(await owner.mutation(mutation('chat/personal:deleteTurn'), { workspaceId: 'ws', conversationId: ids.workspace, turnId: 'drop' })).toEqual({ deletedMessages: 1 })
  const turns = await t.run(ctx => ctx.db.query('conversationMessages').withIndex('by_conversationId', q => q.eq('conversationId', ids.workspace)).collect())
  expect(turns.map(message => message.turnId)).toEqual(['keep'])
})

test('branching copies through the chosen turn, keeps scope, and is safe to retry', async () => {
  const { t, owner, ids } = await fixture()
  const submit = mutation('chat/personal:submit')
  await owner.mutation(submit, submitArgs(ids.workspace, 'one'))
  await owner.mutation(submit, submitArgs(ids.workspace, 'two'))
  const args = { workspaceId: 'ws', conversationId: ids.workspace, turnId: 'one', clientId: 'branch' }
  const branch = mutation('chat/personal:branch')
  const branchId = await owner.mutation(branch, args)
  expect(await owner.mutation(branch, args)).toBe(branchId)
  const copied = await t.run(ctx => ctx.db.query('conversationMessages').withIndex('by_conversationId', q => q.eq('conversationId', branchId)).collect())
  expect(copied.map(message => message.turnId)).toEqual(['one'])
  expect(await owner.query(summary, { workspaceId: 'ws', conversationId: branchId })).toMatchObject({ scope: 'workspace' })
  await expect(owner.mutation(branch, { ...args, turnId: 'missing', clientId: 'other' })).rejects.toThrow('TURN_NOT_FOUND')
})

test('assistant notes need an existing turn, stay bounded, and replace rather than duplicate', async () => {
  const { t, owner, ids } = await fixture()
  const args = { workspaceId: 'ws', conversationId: ids.workspace, turnId: 'media', text: 'Generated 1 image.' }
  const note = mutation('chat/personal:addAssistantNote')
  await expect(owner.mutation(note, args)).rejects.toThrow('TURN_NOT_FOUND')
  await owner.mutation(mutation('chat/personal:submit'), submitArgs(ids.workspace, 'media'))
  await expect(owner.mutation(note, { ...args, text: 'x'.repeat(4001) })).rejects.toThrow('INVALID_NOTE')
  await owner.mutation(note, args)
  await owner.mutation(note, { ...args, text: 'Generated 2 images.' })
  const assistants = await t.run(ctx => ctx.db.query('conversationMessages').withIndex('by_conversationId', q => q.eq('conversationId', ids.workspace)).collect())
  expect(assistants.filter(message => message.role === 'assistant').map(message => message.content)).toEqual(['Generated 2 images.'])
})
