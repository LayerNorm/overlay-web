import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { prepareRemoteMessageText } from './lib/remoteMessageText'

const modules = import.meta.glob('./**/*.ts')
const list = makeFunctionReference<'query'>('chat/personal:list')
const getSummary = makeFunctionReference<'query'>('chat/personal:getSummary')
const rename = makeFunctionReference<'mutation'>('chat/personal:rename')
const archive = makeFunctionReference<'mutation'>('chat/personal:setArchived')
const read = makeFunctionReference<'mutation'>('chat/personal:setRead')
const messages = makeFunctionReference<'query'>('chat/personal:getMessages')
const create = makeFunctionReference<'mutation'>('chat/personal:create')
const setPreferences = makeFunctionReference<'mutation'>('chat/personal:setPreferences')
const submit = makeFunctionReference<'mutation'>('chat/personal:submit')

afterEach(() => vi.unstubAllEnvs())

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

test('native transcript pagination preserves timestamp ties, variants and partial-turn context', async () => {
  const { t, user, args } = await fixture()
  const ids = await t.run(async ctx => {
    const base = { conversationId: args.conversationId, userId: 'u', turnId: 'turn', mode: 'ask' as const,
      contentType: 'text' as const, createdAt: 2 }
    const userId = await ctx.db.insert('conversationMessages', { ...base, role: 'user', content: 'Question',
      parts: [{ type: 'file', url: 'https://example.test/image.png', mediaType: 'image/png', fileName: 'image.png' }] })
    const first = await ctx.db.insert('conversationMessages', { ...base, role: 'assistant', content: 'First',
      variantIndex: 0, parts: [{ type: 'text', text: 'First' }] })
    const second = await ctx.db.insert('conversationMessages', { ...base, role: 'assistant', content: 'Second',
      variantIndex: 1, parts: [{ type: 'tool-invocation', toolInvocation: { toolCallId: 'call', toolName: 'lookup', state: 'result', toolInput: {}, toolOutput: { ok: true } } }] })
    return [userId, first, second]
  })
  const first = await user.query(messages, { ...args, paginationOpts: { numItems: 1, cursor: null } })
  expect(first.page[0].message._id).toBe(ids[2])
  expect(first.page[0].contextUser._id).toBe(ids[0])
  expect(first.page[0].contextUser.parts[0].fileName).toBe('image.png')
  expect(first.page[0].message.parts[0].toolInvocation.toolOutput).toEqual({ ok: true })
  const seen: string[] = []
  let cursor: string | null = null
  let done = false
  while (!done) {
    const result = await user.query(messages, { ...args, paginationOpts: { numItems: 1, cursor } })
    seen.push(...result.page.map((row: { message: { _id: string } }) => row.message._id))
    cursor = result.continueCursor
    done = result.isDone
  }
  expect(seen).toEqual([...ids].reverse())
  expect(new Set(seen).size).toBe(ids.length)
  await expect(t.withIdentity({ subject: 'other' }).query(messages, { ...args, paginationOpts: { numItems: 1, cursor: null } }))
    .rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(user.query(messages, { ...args, userId: 'u', paginationOpts: { numItems: 1, cursor: null } })).rejects.toThrow()
})

test('native transcript hydrates remote text only behind current parent authorization', async () => {
  const { t, user, args } = await fixture()
  const content = 'Full canonical response. '.repeat(3000)
  await t.run(async ctx => {
    const id = await ctx.db.insert('conversationMessages', { conversationId: args.conversationId, userId: 'u',
      turnId: 'remote', role: 'assistant', mode: 'act', content: '', contentType: 'text', createdAt: 2 })
    const row = (await ctx.db.get(id))!
    const { textChanged: _textChanged, ...stored } = await prepareRemoteMessageText(ctx, row, {
      content, parts: [{ type: 'text', text: content }],
    })
    await ctx.db.patch(id, stored)
  })
  const queryArgs = { ...args, paginationOpts: { numItems: 10, cursor: null } }
  const result = await user.query(messages, queryArgs)
  expect(result.page[0].message.content).toBe(content)
  expect(result.page[0].message.parts[0].text).toBe(content)
  expect(result.page[0].contextUser).toBeNull()
  await t.run(async ctx => {
    const membership = (await ctx.db.query('workspaceMemberships').first())!
    await ctx.db.patch(membership._id, { status: 'suspended' })
  })
  await expect(user.query(messages, queryArgs)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('native create retries reuse one scoped chat and preferences remain canonical', async () => {
  const { t, user } = await fixture()
  await t.run(async ctx => {
    const role = (await ctx.db.query('authorizationRoles').first())!
    await ctx.db.patch(role._id, { capabilities: ['conversations.read', 'conversations.edit', 'conversations.create'] })
  })
  const input = { workspaceId: 'ws', clientId: 'same-attempt', title: 'Native',
    askModelIds: ['model'], actModelId: 'model', lastMode: 'act' as const }
  const id = await user.mutation(create, input)
  expect(await user.mutation(create, input)).toBe(id)
  const args = { workspaceId: 'ws', conversationId: id }
  await user.mutation(setPreferences, { ...args, askModelIds: ['other'], actModelId: 'other', lastMode: 'ask' })
  expect(await user.query(getSummary, args)).toMatchObject({ askModelIds: ['other'], actModelId: 'other', lastMode: 'ask' })
  await t.run(ctx => ctx.db.patch(id, { deletedAt: 3 }))
  await expect(user.mutation(create, input)).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  expect(await t.run(ctx => ctx.db.query('conversations').withIndex('by_userId_clientId', q => q.eq('userId', 'u').eq('clientId', input.clientId)).collect()))
    .toHaveLength(1)
})

test('native submission commits one authenticated user turn before execution and retries cannot overwrite it', async () => {
  const { t, user, args } = await fixture()
  const input = { ...args, turnId: 'stable-turn', mode: 'act' as const, modelId: 'model', contentType: 'text' as const,
    parts: [{ type: 'text' as const, text: 'Durable prompt' },
      { type: 'file' as const, url: 'https://example.test/file.png', fileName: 'file.png', mediaType: 'image/png' }] }
  const first = await user.mutation(submit, input)
  expect(await user.mutation(submit, input)).toEqual(first)
  await expect(user.mutation(submit, { ...input, parts: [{ type: 'text', text: 'Different prompt' }] })).rejects.toThrow('TURN_ID_REUSED')
  await expect(t.withIdentity({ subject: 'other' }).mutation(submit, input)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  vi.stubEnv('INTERNAL_API_SECRET', 'native-chat-fixture')
  await t.mutation(makeFunctionReference<'mutation'>('chat/conversations:addMessage'), {
    conversationId: args.conversationId, userId: 'u', serverSecret: 'native-chat-fixture', turnId: input.turnId,
    role: 'user', mode: 'ask', contentType: 'text', content: 'Transport representation', skipMemoryExtraction: true,
  })
  const rows = await t.run(ctx => ctx.db.query('conversationMessages').withIndex('by_conversationId_turnId_role', q =>
    q.eq('conversationId', args.conversationId).eq('turnId', input.turnId).eq('role', 'user')).collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ _id: first.messageId, content: 'Durable prompt', mode: 'act', userId: 'u' })
  expect(rows[0].parts?.[1]).toMatchObject({ fileName: 'file.png' })
})

test('native submit rejects retired threads before writing a user turn', async () => {
  const { t, user, args } = await fixture()
  const retiredTurnId = 'retired-root'
  await t.run(async ctx => {
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: args.conversationId, userId: 'u', turnId: retiredTurnId, role: 'user',
      mode: 'act', content: 'Old prompt', contentType: 'text', createdAt: 2,
    })
    const assistantMessageId = await ctx.db.insert('conversationMessages', {
      conversationId: args.conversationId, userId: 'u', turnId: retiredTurnId, role: 'assistant',
      mode: 'act', content: 'Old response', contentType: 'text', status: 'completed', createdAt: 3,
    })
    await ctx.db.insert('conversationAgentRuns', {
      conversationId: args.conversationId, userId: 'u', turnId: retiredTurnId,
      userMessageId, assistantMessageId, mode: 'work', runner: 'tool_loop',
      status: 'completed', createdAt: 2, updatedAt: 3,
    })
  })
  const turnId = 'blocked-native-submit'
  await expect(user.mutation(submit, {
    ...args, turnId, mode: 'act', modelId: 'model', contentType: 'text',
    parts: [{ type: 'text', text: 'Must not be stored' }],
  })).rejects.toThrow('native_runner_retired')
  const rows = await t.run(ctx => ctx.db.query('conversationMessages')
    .withIndex('by_conversationId_turnId_role', q =>
      q.eq('conversationId', args.conversationId).eq('turnId', turnId).eq('role', 'user'))
    .collect())
  expect(rows).toEqual([])
})

test('first native send creates chat and user atomically and a denied send leaves no chat behind', async () => {
  const { t, user } = await fixture()
  const roleId = await t.run(async ctx => {
    const role = (await ctx.db.query('authorizationRoles').first())!
    await ctx.db.patch(role._id, { capabilities: ['conversations.create', 'conversations.edit', 'conversations.read'] })
    return role._id
  })
  const input = { workspaceId: 'ws', clientId: 'new-native', turnId: 'first-turn', mode: 'act' as const,
    modelId: 'model', contentType: 'text' as const, parts: [{ type: 'text' as const, text: 'First prompt' }] }
  const first = await user.mutation(submit, input)
  expect(await user.mutation(submit, input)).toEqual(first)
  await t.run(ctx => ctx.db.patch(roleId, { capabilities: ['conversations.create'] }))
  await expect(user.mutation(submit, { ...input, clientId: 'denied-native', turnId: 'denied-turn' })).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  expect(await t.run(ctx => ctx.db.query('conversations').withIndex('by_userId_clientId', q => q.eq('userId', 'u').eq('clientId', 'denied-native')).collect()))
    .toEqual([])
})

test('native output metadata is owner-scoped and a stale files policy does not hide text history', async () => {
  const { t, user, args } = await fixture()
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://fixture.convex.cloud')
  const { policyId, fileId } = await t.run(async ctx => {
    const role = (await ctx.db.query('authorizationRoles').first())!
    await ctx.db.patch(role._id, { capabilities: ['conversations.read', 'files.read'] })
    const policyId = await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'fixture', sourceOrigin: 'https://app.example.test', expiresAt: Date.now() + 60_000,
      snapshot: { version: 1, backendUrl: 'https://fixture.convex.cloud', revision: 'a'.repeat(64),
        features: { files: true, skills: false, mcpServers: false, externalAgents: false, connectedAgents: false, workspaceHandles: false },
        rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' } },
    })
    await ctx.db.insert('conversationMessages', { conversationId: args.conversationId, userId: 'u', turnId: 'media',
      role: 'user', mode: 'act', content: 'Image prompt', contentType: 'image', createdAt: 1 })
    const base = { userId: 'u', workspaceId: 'ws', conversationId: String(args.conversationId), turnId: 'media',
      type: 'file' as const, kind: 'output' as const, name: 'Result', outputType: 'image', r2Key: 'private-key', createdAt: 1, updatedAt: 1 }
    const fileId = await ctx.db.insert('files', base)
    await ctx.db.insert('files', { ...base, workspaceId: 'other' })
    await ctx.db.insert('files', { ...base, userId: 'other' })
    await ctx.db.insert('files', { ...base, scope: 'workspace' })
    return { policyId, fileId }
  })
  const input = { ...args, paginationOpts: { numItems: 10, cursor: null } }
  const result = await user.query(messages, input)
  expect(result.page[0].outputs).toHaveLength(1)
  expect(result.page[0].outputs[0]).toMatchObject({ _id: fileId, url: `/api/v1/files/${fileId}/content` })
  expect(result.page[0].outputs[0]).not.toHaveProperty('r2Key')
  await t.run(ctx => ctx.db.patch(policyId, { expiresAt: 0 }))
  const denied = await user.query(messages, input)
  expect(denied.page[0].message.content).toBe('Image prompt')
  expect(denied.page[0].outputs).toEqual([])
})

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
