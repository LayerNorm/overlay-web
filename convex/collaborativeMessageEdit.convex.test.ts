import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { hydrateRemoteMessage, prepareRemoteMessageText } from './lib/remoteMessageText'

const modules = import.meta.glob('./**/*.ts')
const secret = 'collaborative-message-edit-test-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
const edit = makeFunctionReference<'mutation'>('collaboration/directMessages:editMessage')
const finalize = makeFunctionReference<'mutation'>('collaboration/directMessages:finalizeAgentMessage')
const fail = makeFunctionReference<'mutation'>('collaboration/directMessages:failAgentMessage')
const sanitize = makeFunctionReference<'mutation'>('collaboration/directMessages:sanitizeAgentMessageTextParts')
const completeTool = makeFunctionReference<'mutation'>('collaboration/directMessages:completeAgentToolInvocation')

for (const chunked of [false, true]) {
  test(`editing ${chunked ? 'chunked' : 'inline'} human text updates rendered parts and preserves attachments`, async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async ctx => {
      await ctx.db.insert('workspacePrincipals', { principalId: 'human', workspaceId: 'qa', type: 'human', userId: 'owner', displayName: 'QA', createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { membershipId: 'qa-member', workspaceId: 'qa', principalId: 'human', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
      const conversationId = await ctx.db.insert('conversations', { userId: 'owner', workspaceId: 'qa', title: 'QA', conversationType: 'personal', lastModified: 1, updatedAt: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'm' })
      const messageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'owner', authorKind: 'human', authorPrincipalId: 'human', turnId: 't', role: 'user', mode: 'act', content: 'Original message', parts: [{ type: 'text', text: 'Original ' }, { type: 'file', url: 'https://example.test/file', mediaType: 'text/plain' }, { type: 'text', text: 'message' }], contentType: 'text', status: 'completed', createdAt: 1, updatedAt: 1 })
      if (chunked) {
        const message = (await ctx.db.get(messageId))!
        const patch = await prepareRemoteMessageText(ctx, message, { content: message.content, parts: message.parts! })
        await ctx.db.patch(messageId, { content: patch.content, parts: patch.parts, remoteTextStored: patch.remoteTextStored })
      }
      return { conversationId, messageId }
    })
    expect(await t.mutation(edit, { ...ids, actorUserId: 'owner', workspaceId: 'qa', serverSecret: secret, content: '  Saved message  ' })).toBe(true)
    const message = await t.run(async ctx => hydrateRemoteMessage(ctx, (await ctx.db.get(ids.messageId))!))
    expect(message.content).toBe('Saved message')
    expect(message.parts?.filter(p => p.type === 'text')).toEqual([{ type: 'text', text: 'Saved message' }])
    expect(message.parts?.filter(p => p.type === 'file')).toEqual([{ type: 'file', url: 'https://example.test/file', mediaType: 'text/plain' }])
    expect(message.editHistory?.[0]?.content).toBe('Original message')
    expect(message.editedAt).toBeGreaterThan(1)
    await t.run(async ctx => { await ctx.db.patch(ids.messageId, { authorPrincipalId: 'someone-else' }) })
    expect(await t.mutation(edit, { ...ids, actorUserId: 'owner', workspaceId: 'qa', serverSecret: secret, content: 'Unauthorized edit' })).toBe(false)
    expect((await t.run(async ctx => hydrateRemoteMessage(ctx, (await ctx.db.get(ids.messageId))!))).content).toBe('Saved message')
  })
}

test('finalizing an assistant message strips textual tool-call parts and preserves non-text parts', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', { principalId: 'human', workspaceId: 'qa', type: 'human', userId: 'owner', displayName: 'QA', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'qa-member', workspaceId: 'qa', principalId: 'human', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
    const conversationId = await ctx.db.insert('conversations', { userId: 'owner', workspaceId: 'qa', title: 'QA', conversationType: 'personal', lastModified: 1, updatedAt: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'm' })
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', authorKind: 'agent', authorPrincipalId: 'agent', turnId: 't',
      role: 'assistant', mode: 'act', content: 'Streaming', parts: [], contentType: 'text', status: 'generating',
      createdAt: 1, updatedAt: 1,
    })
    const retainedMessageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', authorKind: 'agent', authorPrincipalId: 'agent', turnId: 't',
      role: 'assistant', mode: 'act', content: 'Partial\n\n[[{"name":"get_note","parameters":{"noteId":"n1"}}]]',
      parts: [
        { type: 'text', text: 'Partial\n\n[[{"name":"get_note","parameters":{"noteId":"n1"}}]]' },
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'call', toolName: 'get_note', state: 'output-available' } },
      ],
      contentType: 'text', status: 'completed', createdAt: 2, updatedAt: 2,
    })
    const failedMessageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', authorKind: 'agent', authorPrincipalId: 'agent', turnId: 't',
      role: 'assistant', mode: 'act', content: 'Partial answer\n\n[[{"name":"get_note","parameters":{"noteId":"n1"}}]]',
      parts: [
        { type: 'text', text: 'Partial answer\n\n[[{"name":"get_note","parameters":{"noteId":"n1"}}]]' },
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'failed-call', toolName: 'get_note', state: 'output-available' } },
      ],
      contentType: 'text', status: 'generating', createdAt: 3, updatedAt: 3,
    })
    return { conversationId, messageId, retainedMessageId, failedMessageId }
  })
  const toolProgress = {
    type: 'tool-invocation',
    toolInvocation: { toolCallId: 'call', toolName: 'get_note', state: 'output-available' },
  }
  const answer = { type: 'text', text: 'The note says 6.' }
  const protocol = '[[{"name":"get_note","parameters":{"noteId":"n1"}}]]'
  await t.mutation(finalize, {
    conversationId: ids.conversationId,
    messageId: ids.messageId,
    actorUserId: 'owner',
    workspaceId: 'qa',
    serverSecret: secret,
    content: 'The note says 6.',
    parts: [{ type: 'text', text: protocol }, toolProgress, answer],
    toolNames: ['get_note'],
  })
  const message = await t.run(async ctx => await ctx.db.get(ids.messageId))
  expect(message?.parts).toEqual([toolProgress, answer])
  expect(message?.content).toBe('The note says 6.')
  expect(message?.status).toBe('completed')
  await t.mutation(sanitize, {
    actorUserId: 'owner',
    authorPrincipalId: 'agent',
    conversationId: ids.conversationId,
    messageId: ids.retainedMessageId,
    toolNames: ['get_note'],
    turnId: 't',
    workspaceId: 'qa',
    serverSecret: secret,
  })
  const retainedMessage = await t.run(async ctx => await ctx.db.get(ids.retainedMessageId))
  expect(retainedMessage?.content).toBe('Partial')
  expect(retainedMessage?.parts).toEqual([
    { type: 'text', text: 'Partial' },
    toolProgress,
  ])
  expect(retainedMessage?.status).toBe('completed')
  await t.mutation(fail, {
    actorUserId: 'owner',
    conversationId: ids.conversationId,
    messageId: ids.failedMessageId,
    toolNames: ['get_note'],
    workspaceId: 'qa',
    serverSecret: secret,
  })
  const failedMessage = await t.run(async ctx => await ctx.db.get(ids.failedMessageId))
  expect(failedMessage?.content).toBe('Partial answer')
  expect(failedMessage?.parts).toEqual([
    { type: 'text', text: 'Partial answer' },
    { type: 'tool-invocation', toolInvocation: { toolCallId: 'failed-call', toolName: 'get_note', state: 'output-available' } },
  ])
  expect(failedMessage?.status).toBe('error')
})

test('completing a tool invocation updates only its matching input part on a completed message', async () => {
  const t = convexTest(schema, modules)
  const inputPart = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: 'call',
      toolName: 'read_file',
      state: 'input-available',
      toolInput: { path: 'notes.md' },
    },
  }
  const otherPart = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: 'other-call',
      toolName: 'read_file',
      state: 'input-available',
      toolInput: { path: 'other.md' },
    },
  }
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'human', workspaceId: 'qa', type: 'human', userId: 'owner',
      displayName: 'QA', createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'qa-member', workspaceId: 'qa', principalId: 'human',
      role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1,
    })
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'owner', workspaceId: 'qa', title: 'QA', conversationType: 'personal',
      lastModified: 1, updatedAt: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'm',
    })
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', authorKind: 'agent', authorPrincipalId: 'agent', turnId: 'turn',
      role: 'assistant', mode: 'act', content: 'Reply remains unchanged',
      parts: [{ type: 'text', text: 'Reply remains unchanged' }, inputPart, otherPart],
      contentType: 'text', status: 'completed', createdAt: 1, updatedAt: 1,
    })
    const finalizedMessageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', authorKind: 'agent', authorPrincipalId: 'agent', turnId: 'turn',
      role: 'assistant', mode: 'act', content: 'Already finalized',
      parts: [{
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: 'call',
          toolName: 'read_file',
          state: 'output-available',
          toolInput: { path: 'notes.md' },
          toolOutput: { content: 'existing result' },
        },
      }],
      contentType: 'text', status: 'completed', createdAt: 2, updatedAt: 2,
    })
    return { conversationId, messageId, finalizedMessageId }
  })
  const args = {
    actorUserId: 'owner',
    authorPrincipalId: 'agent',
    conversationId: ids.conversationId,
    messageId: ids.messageId,
    turnId: 'turn',
    workspaceId: 'qa',
    toolCallId: 'call',
    toolName: 'read_file',
    state: 'output-error' as const,
    output: { error: 'file unavailable' },
    serverSecret: secret,
  }

  await t.mutation(completeTool, args)

  const message = await t.run(async ctx => await ctx.db.get(ids.messageId))
  expect(message?.status).toBe('completed')
  expect(message?.content).toBe('Reply remains unchanged')
  expect(message?.parts).toEqual([
    { type: 'text', text: 'Reply remains unchanged' },
    {
      type: 'tool-invocation',
      toolInvocation: {
        toolCallId: 'call',
        toolName: 'read_file',
        state: 'output-error',
        toolInput: { path: 'notes.md' },
        toolOutput: { error: 'file unavailable' },
      },
    },
    otherPart,
  ])
  expect(message?.updatedAt).toBeGreaterThan(1)

  const beforeNoOps = await t.run(async ctx => ({
    message: await ctx.db.get(ids.messageId),
    finalizedMessage: await ctx.db.get(ids.finalizedMessageId),
  }))
  await t.mutation(completeTool, { ...args, authorPrincipalId: 'other-agent' })
  await t.mutation(completeTool, { ...args, turnId: 'other-turn' })
  await t.mutation(completeTool, { ...args, toolName: 'write_file' })
  await t.mutation(completeTool, { ...args, messageId: ids.finalizedMessageId })
  const afterNoOps = await t.run(async ctx => ({
    message: await ctx.db.get(ids.messageId),
    finalizedMessage: await ctx.db.get(ids.finalizedMessageId),
  }))
  expect(afterNoOps).toEqual(beforeNoOps)
})
