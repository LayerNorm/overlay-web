import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'native-thread-compatibility-test'
const mutation = (path: string) => makeFunctionReference<'mutation'>(path)
const query = (path: string) => makeFunctionReference<'query'>(path)
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function personalFixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const now = Date.now()
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'owner', workspaceId: 'workspace', title: 'Task', lastMode: 'act',
      actModelId: 'model', askModelIds: [], lastModified: now, createdAt: now, updatedAt: now,
    })
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'old-turn', role: 'user', mode: 'act',
      content: 'Old task', contentType: 'text', createdAt: now,
    })
    return { conversationId, userMessageId }
  })
  const run = await t.mutation(mutation('chat/conversations:startAgentRun'), {
    ...ids, userId: 'owner', turnId: 'old-turn', mode: 'chat', modelId: 'model',
    runner: 'workflow', executionEngine: 'overlay_harness', serverSecret: secret,
  })
  await t.run(async ctx => {
    await ctx.db.patch(run._id, { executionEngine: undefined, status: 'completed', completedAt: Date.now() })
  })
  return { t, ...ids, run }
}

test('tracked retired personal threads reject writes but keep history and projection readable', async () => {
  const { t, conversationId, userMessageId, run } = await personalFixture()
  await t.run(async ctx => {
    await ctx.db.patch(run.assistantMessageId, {
      parts: [{ type: 'data', dataType: 'overlay.generated_ui', id: 'draft', data: {
        version: 1, kind: 'draft.text', body: 'before',
      } }],
    })
  })
  await expect(t.query(query('chat/conversations:getNativeThreadCompatibility'), {
    conversationId, userId: 'owner', workspaceId: 'workspace', serverSecret: secret,
  })).resolves.toMatchObject({ readOnly: true, code: 'native_runner_retired' })
  await expect(t.mutation(mutation('chat/conversations:addMessage'), {
    conversationId, userId: 'owner', workspaceId: 'workspace', serverSecret: secret,
    turnId: 'new-turn', role: 'user', mode: 'act', content: 'new', contentType: 'text', parts: [],
  })).rejects.toThrow('native_runner_retired')
  await expect(t.mutation(mutation('chat/conversations:addMessages'), {
    conversationId, userId: 'owner', serverSecret: secret,
    rows: [{ turnId: 'old-turn', role: 'user', mode: 'act', content: 'replay', contentType: 'text', parts: [] }],
  })).rejects.toThrow('native_runner_retired')
  await expect(t.mutation(mutation('chat/conversations:deleteTurn'), {
    conversationId, userId: 'owner', serverSecret: secret, turnId: 'old-turn',
  })).rejects.toThrow('native_runner_retired')
  await expect(t.mutation(mutation('chat/conversations:updateMessageUiPart'), {
    conversationId, userId: 'owner', serverSecret: secret, messageId: run.assistantMessageId,
    partId: 'draft', data: { version: 1, kind: 'draft.text', body: 'after' },
  })).rejects.toThrow('native_runner_retired')
  const newTurnMessageId = await t.run(ctx => ctx.db.insert('conversationMessages', {
    conversationId, userId: 'owner', turnId: 'new-turn', role: 'user', mode: 'act',
    content: 'new task', contentType: 'text', createdAt: Date.now(),
  }))
  await expect(t.mutation(mutation('chat/conversations:startAgentRun'), {
    conversationId, userMessageId: newTurnMessageId, userId: 'owner', turnId: 'new-turn',
    mode: 'chat', modelId: 'model', runner: 'workflow', executionEngine: 'overlay_harness',
    serverSecret: secret,
  })).rejects.toThrow('native_runner_retired')
  await expect(t.query(query('chat/conversations:getMessages'), {
    conversationId, userId: 'owner', serverSecret: secret,
  })).resolves.toHaveLength(3)
  await expect(t.query(query('chat/conversations:getNativeThreadCompatibility'), {
    conversationId, userId: 'other', workspaceId: 'workspace', serverSecret: secret,
  })).rejects.toThrow('Unauthorized')
  expect(userMessageId).toBeDefined()
})

test('current native and remote-only history remains writable', async () => {
  const { t, conversationId } = await personalFixture()
  await t.run(async ctx => {
    const run = await ctx.db.query('conversationAgentRuns').first()
    if (run) await ctx.db.patch(run._id, { executionEngine: 'overlay_harness', status: 'queued', completedAt: undefined })
  })
  await expect(t.mutation(mutation('chat/conversations:addMessage'), {
    conversationId, userId: 'owner', workspaceId: 'workspace', serverSecret: secret,
    turnId: 'current', role: 'user', mode: 'act', content: 'new', contentType: 'text', parts: [],
  })).resolves.toBeDefined()
  await t.run(async ctx => {
    const run = await ctx.db.query('conversationAgentRuns').first()
    if (run) await ctx.db.patch(run._id, { runner: 'remote', executionEngine: undefined })
  })
  await expect(t.mutation(mutation('chat/conversations:addMessage'), {
    conversationId, userId: 'owner', workspaceId: 'workspace', serverSecret: secret,
    turnId: 'remote', role: 'user', mode: 'act', content: 'remote', contentType: 'text', parts: [],
  })).resolves.toBeDefined()
})

test('shared legacy roots are read-only while new top-level roots remain allowed', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'WS', slug: 'ws',
      status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'human', workspaceId: 'ws', type: 'human',
      userId: 'owner', displayName: 'Owner', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'm', workspaceId: 'ws', principalId: 'human',
      role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'agent-principal', workspaceId: 'ws', type: 'agent',
      agentId: 'agent', displayName: 'Agent', createdAt: now, updatedAt: now })
    const conversationId = await ctx.db.insert('conversations', { userId: 'owner', workspaceId: 'ws',
      conversationType: 'channel', title: 'Room', lastModified: now, createdAt: now, updatedAt: now,
      lastMode: 'act', askModelIds: [], actModelId: 'model' })
    await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'ws', principalId: 'human',
      principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'ws', principalId: 'agent-principal',
      principalType: 'agent', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    const rootMessageId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'owner',
      turnId: 'root', role: 'user', mode: 'act', content: 'old', contentType: 'text', createdAt: now })
    const replyId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'owner', authorKind: 'agent',
      authorPrincipalId: 'agent-principal', turnId: 'reply', role: 'assistant', mode: 'act',
      content: 'reply', contentType: 'text', status: 'completed',
      threadRootMessageId: rootMessageId, createdAt: now })
    const cleanRootId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'owner',
      turnId: 'clean-root', role: 'user', mode: 'act', content: 'new task', contentType: 'text', createdAt: now })
    const runId = await ctx.db.insert('conversationAgentRuns', { conversationId, turnId: 'root', userId: 'owner',
      userMessageId: rootMessageId, assistantMessageId: replyId, mode: 'room', runner: 'tool_loop',
      status: 'completed', createdAt: now, updatedAt: now })
    return { conversationId, rootMessageId, replyId, cleanRootId, runId }
  })
  await expect(t.query(query('chat/conversations:getNativeThreadCompatibility'), {
    conversationId: ids.conversationId, userId: 'owner', workspaceId: 'ws',
    threadRootMessageId: ids.replyId, serverSecret: secret,
  })).resolves.toMatchObject({ readOnly: true })
  await expect(t.mutation(mutation('collaboration/directMessages:addMessage'), {
    actorUserId: 'owner', conversationId: ids.conversationId, workspaceId: 'ws', serverSecret: secret,
    clientNonce: 'old', turnId: 'old-reply', content: 'blocked', threadRootMessageId: ids.replyId,
  })).rejects.toThrow('native_runner_retired')
  const admission = {
    actorUserId: 'owner', agentId: 'agent', authorPrincipalId: 'agent-principal',
    conversationId: ids.conversationId, modelId: 'model', userMessageId: ids.replyId,
    workspaceId: 'ws', serverSecret: secret, executionEngine: 'overlay_harness' as const,
  }
  await expect(t.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    ...admission, clientNonce: 'spoofed', turnId: 'spoofed', threadRootMessageId: ids.cleanRootId,
  })).rejects.toThrow('native_runner_retired')
  await expect(t.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    ...admission, clientNonce: 'omitted', turnId: 'omitted',
  })).rejects.toThrow('native_runner_retired')
  await expect(t.mutation(mutation('collaboration/directMessages:addMessage'), {
    actorUserId: 'owner', conversationId: ids.conversationId, workspaceId: 'ws', serverSecret: secret,
    clientNonce: 'clean-reply', turnId: 'clean-reply', content: 'allowed', threadRootMessageId: ids.cleanRootId,
  })).resolves.toBeDefined()
  await expect(t.mutation(mutation('collaboration/directMessages:addMessage'), {
    actorUserId: 'owner', conversationId: ids.conversationId, workspaceId: 'ws', serverSecret: secret,
    clientNonce: 'new', turnId: 'new-root', content: 'allowed',
  })).resolves.toBeDefined()
  await expect(t.query(query('chat/conversations:getNativeThreadCompatibility'), {
    conversationId: ids.conversationId, userId: 'owner', workspaceId: 'ws',
    threadRootMessageId: ids.cleanRootId, serverSecret: secret,
  })).resolves.toEqual({ readOnly: false })
})

test('recorded retired one-to-one agent DMs block sends, admission, and startup posts', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'WS', slug: 'ws',
      status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'human', workspaceId: 'ws', type: 'human',
      userId: 'owner', displayName: 'Owner', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'm', workspaceId: 'ws', principalId: 'human',
      role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'agent-principal', workspaceId: 'ws', type: 'agent',
      agentId: 'agent', displayName: 'Agent', createdAt: now, updatedAt: now })
    const conversationId = await ctx.db.insert('conversations', { userId: 'owner', workspaceId: 'ws',
      conversationType: 'dm', dmIdentityKey: 'owner:agent', agentId: 'agent',
      title: 'Agent DM', lastModified: now, createdAt: now, updatedAt: now,
      lastMode: 'act', askModelIds: [], actModelId: 'model' })
    for (const [principalId, principalType] of [['human', 'human'], ['agent-principal', 'agent']] as const) {
      await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'ws', principalId,
        principalType, role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    }
    const triggerId = await ctx.db.insert('conversationMessages', { conversationId, userId: 'owner',
      authorKind: 'agent', authorPrincipalId: 'agent-principal', turnId: 'old-turn', role: 'assistant',
      mode: 'act', content: 'old prompt', contentType: 'text', status: 'completed', createdAt: now })
    await ctx.db.insert('conversationAgentRuns', { conversationId, turnId: 'old-turn', userId: 'owner',
      userMessageId: triggerId, assistantMessageId: triggerId, mode: 'room', runner: 'workflow',
      status: 'failed', createdAt: now, updatedAt: now })
    return { conversationId, triggerId }
  })
  const initialMessages = await t.run(ctx => ctx.db.query('conversationMessages').collect())
  const initialRuns = await t.run(ctx => ctx.db.query('conversationAgentRuns').collect())
  const admission = {
    actorUserId: 'owner', agentId: 'agent', authorPrincipalId: 'agent-principal',
    conversationId: ids.conversationId, modelId: 'model', userMessageId: ids.triggerId,
    workspaceId: 'ws', serverSecret: secret, executionEngine: 'overlay_harness' as const,
  }
  await expect(t.mutation(mutation('collaboration/directMessages:addMessage'), {
    actorUserId: 'owner', conversationId: ids.conversationId, workspaceId: 'ws', serverSecret: secret,
    clientNonce: 'send', turnId: 'new-turn', content: 'blocked',
  })).rejects.toThrow('native_runner_retired')
  await expect(t.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    ...admission, clientNonce: 'admit', turnId: 'new-turn',
  })).rejects.toThrow('native_runner_retired')
  await expect(t.mutation(mutation('collaboration/directMessages:addAgentMessage'), {
    actorUserId: 'owner', authorPrincipalId: 'agent-principal', conversationId: ids.conversationId,
    workspaceId: 'ws', serverSecret: secret, clientNonce: 'prepared', turnId: 'prepared',
    content: 'prepared', messagePurpose: 'prepared_onboarding', modelId: 'model',
  })).rejects.toThrow('native_runner_retired')
  await expect(t.mutation(mutation('collaboration/directMessages:recordAgentStartFailure'), {
    actorUserId: 'owner', authorPrincipalId: 'agent-principal', conversationId: ids.conversationId,
    workspaceId: 'ws', serverSecret: secret, clientNonce: 'startup', turnId: 'startup',
    content: 'startup failed', modelId: 'model',
  })).rejects.toThrow('native_runner_retired')
  await expect(t.query(query('chat/conversations:getNativeThreadCompatibility'), {
    conversationId: ids.conversationId, userId: 'owner', workspaceId: 'ws', serverSecret: secret,
  })).resolves.toMatchObject({ readOnly: true })
  expect(await t.run(ctx => ctx.db.query('conversationMessages').collect())).toHaveLength(initialMessages.length)
  expect(await t.run(ctx => ctx.db.query('conversationAgentRuns').collect())).toHaveLength(initialRuns.length)
})
