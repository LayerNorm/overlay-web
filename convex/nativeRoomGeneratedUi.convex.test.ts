import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const save = makeFunctionReference<'mutation'>('collaboration/rooms:updateMessageUiPart')
const view = { version: 1 as const, kind: 'json_render' as const, catalogVersion: 1, title: 'Bug report', summary: 'Describe the bug.',
  specJson: '{"root":"title","state":{"title":""},"elements":{"title":{"type":"Input","props":{"label":"Title","value":{"$bindState":"/title"}}}}}' }

async function fixture(conversationType: 'dm' | 'channel' = 'channel') {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    for (const userId of ['member', 'outsider']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: userId, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const conversationId = await ctx.db.insert('conversations', { workspaceId: 'ws', userId: 'owner', conversationType,
      title: 'Agent thread', askModelIds: [], actModelId: 'model', lastMode: 'act', createdAt: 1, updatedAt: 1, lastModified: 1 })
    const participantId = await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'ws', principalId: 'p-member', principalType: 'human',
      role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1 })
    const rootId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'owner', turnId: 'root', role: 'user', mode: 'act', contentType: 'text', content: 'Show a form', createdAt: 1 })
    const messageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'owner', threadRootMessageId: rootId, turnId: 'answer', role: 'assistant',
      authorKind: 'agent', authorPrincipalId: 'agent', mode: 'act', contentType: 'text', content: 'Here is the form.', createdAt: 2, updatedAt: 2, parts: [
        { type: 'text', text: 'Here is the form.' },
        { type: 'data', id: 'view', dataType: 'overlay.generated_ui', data: view },
        { type: 'data', id: 'draft', dataType: 'overlay.generated_ui', data: { version: 1, kind: 'draft.text', body: 'Unchanged draft' } },
      ] })
    return { conversationId, participantId, rootId, messageId }
  })
  return { t, ...ids, member: t.withIdentity({ subject: 'member' }), args: { workspaceId: 'ws', conversationId: ids.conversationId,
    messageId: ids.messageId, partId: 'view', data: { ...view, stateJson: '{"title":"Sidebar disappears"}' } } }
}

test.each(['dm', 'channel'] as const)('native members save json-render state in %s without changing other parts', async type => {
  const { t, member, args, messageId, conversationId } = await fixture(type)
  const before = await t.run(ctx => ctx.db.get(messageId))
  await expect(member.mutation(save, args)).resolves.toEqual({ success: true })
  const after = await t.run(ctx => ctx.db.get(messageId))
  expect(after?.parts?.[1]).toMatchObject({ data: args.data })
  expect(after?.parts?.[0]).toEqual(before?.parts?.[0])
  expect(after?.parts?.[2]).toEqual(before?.parts?.[2])
  expect((await t.run(ctx => ctx.db.get(conversationId)))?.lastModified).toBeGreaterThan(1)
  await expect(member.mutation(save, { ...args, data: { ...view, stateJson: '{}' } })).resolves.toEqual({ success: true })
})

test('native form writes reject unauthenticated users, non-members and caller identity arguments', async () => {
  const { t, member, args } = await fixture()
  await expect(t.mutation(save, args)).rejects.toThrow('Unauthorized')
  await expect(t.withIdentity({ subject: 'outsider' }).mutation(save, args)).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
  await expect(t.withIdentity({ subject: 'stranger' }).mutation(save, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(member.mutation(save, { ...args, actorUserId: 'owner' })).rejects.toThrow()
  await t.run(async ctx => {
    const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'ws').eq('principalId', 'p-member')).unique()
    await ctx.db.patch(membership!._id, { status: 'suspended' })
  })
  await expect(member.mutation(save, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('native form writes reject archived and removed room participants', async () => {
  const { t, member, args, participantId } = await fixture()
  for (const archivedAt of [0, 10]) {
    await t.run(ctx => ctx.db.patch(participantId, { archivedAt }))
    await expect(member.mutation(save, args)).rejects.toThrow('Unauthorized')
  }
  await t.run(ctx => ctx.db.patch(participantId, { archivedAt: undefined, status: 'removed' }))
  await expect(member.mutation(save, args)).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
})

test('native form writes enforce read-only compatibility for the actual message thread', async () => {
  const { t, member, args, conversationId, rootId, messageId } = await fixture()
  await t.run(ctx => ctx.db.insert('conversationAgentRuns', { conversationId, turnId: 'old', userId: 'owner', userMessageId: rootId,
    assistantMessageId: messageId, mode: 'room', runner: 'workflow', status: 'completed', createdAt: 1, updatedAt: 1 }))
  await expect(member.mutation(save, args)).rejects.toThrow('native_runner_retired')
  const before = await t.run(ctx => ctx.db.get(messageId))
  expect(before?.parts?.[1]).toMatchObject({ data: view })
})

test('native form writes reject external and personal conversations even for their owner', async () => {
  const { t, member, args, conversationId } = await fixture()
  await t.run(ctx => ctx.db.patch(conversationId, { externalPlatform: 'slack' }))
  await expect(member.mutation(save, args)).rejects.toThrow('Unauthorized')
  await t.run(ctx => ctx.db.patch(conversationId, { externalPlatform: undefined, conversationType: 'personal', userId: 'member' }))
  await expect(member.mutation(save, args)).rejects.toThrow('Unauthorized')
})

test('native form writes enforce message scope and do not broaden draft permissions', async () => {
  const { t, member, args, messageId, conversationId } = await fixture()
  await expect(member.mutation(save, { ...args, workspaceId: 'other' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(member.mutation(save, { ...args, partId: 'missing' })).rejects.toThrow('Generated UI part not found')
  await expect(member.mutation(save, { ...args, partId: 'draft' })).rejects.toThrow('content cannot be changed')
  await expect(member.mutation(save, { ...args, data: { version: 1, kind: 'draft.text', body: 'Changed' } })).rejects.toThrow('content cannot be changed')
  const otherMessageId = await t.run(async ctx => {
    const other = await ctx.db.insert('conversations', { workspaceId: 'ws', userId: 'owner', title: 'Other', conversationType: 'channel',
      askModelIds: [], actModelId: 'model', lastMode: 'act', createdAt: 1, updatedAt: 1, lastModified: 1 })
    return ctx.db.insert('conversationMessages', { conversationId: other, userId: 'owner', turnId: 'other', role: 'assistant', mode: 'act', contentType: 'text', content: '', createdAt: 1 })
  })
  await expect(member.mutation(save, { ...args, messageId: otherMessageId })).rejects.toThrow('Message not found')
  await t.run(ctx => ctx.db.patch(messageId, { deletedAt: 3 }))
  await expect(member.mutation(save, args)).rejects.toThrow('Message not found')
  await t.run(ctx => ctx.db.patch(conversationId, { deletedAt: 3 }))
  await expect(member.mutation(save, args)).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
})

test('native form writes reject changes to immutable content and invalid or oversized state', async () => {
  const { member, args } = await fixture()
  for (const change of [{ specJson: '{}' }, { title: 'Changed' }, { summary: 'Changed' }, { catalogVersion: 2 }]) {
    await expect(member.mutation(save, { ...args, data: { ...args.data, ...change } })).rejects.toThrow('content cannot be changed')
  }
  for (const stateJson of ['[]', 'null', 'true', 'not JSON']) {
    await expect(member.mutation(save, { ...args, data: { ...args.data, stateJson } })).rejects.toThrow()
  }
  await expect(member.mutation(save, { ...args, data: { ...args.data, stateJson: JSON.stringify({ title: 'x'.repeat(65_536) }) } })).rejects.toThrow('Form state is too large')
  await expect(member.mutation(save, { ...args, data: { ...args.data, submittedAt: -1 } })).rejects.toThrow('Invalid submission time')
})

test('submitted native forms reject further edits and identical retries perform no writes', async () => {
  const { t, member, args, messageId, conversationId } = await fixture()
  const submitted = { ...args, data: { ...args.data, submittedAt: 42 } }
  await expect(member.mutation(save, submitted)).resolves.toEqual({ success: true })
  for (const data of [args.data, { ...submitted.data, stateJson: '{}' }, { ...submitted.data, submittedAt: 43 }]) {
    await expect(member.mutation(save, { ...args, data })).rejects.toThrow('already been submitted')
  }
  await t.run(async ctx => {
    await ctx.db.patch(messageId, { updatedAt: 10 })
    await ctx.db.patch(conversationId, { updatedAt: 11, lastModified: 12 })
  })
  await expect(member.mutation(save, submitted)).resolves.toEqual({ success: true })
  expect(await t.run(ctx => ctx.db.get(messageId))).toMatchObject({ updatedAt: 10, parts: [{ type: 'text' }, { data: submitted.data }, { type: 'data' }] })
  expect(await t.run(ctx => ctx.db.get(conversationId))).toMatchObject({ updatedAt: 11, lastModified: 12 })
})
