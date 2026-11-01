import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'surface-harness-test-secret'
const mutation = (name: string) => makeFunctionReference<'mutation'>(name)
const query = (name: string) => makeFunctionReference<'query'>(name)
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function applyHarness(convex: ReturnType<typeof convexTest>, runId: string, operation: unknown) {
  const current = await convex.query(query('harness/runs:get'), { actorUserId: 'user', runId, serverSecret: secret })
  return await convex.mutation(mutation('harness/runs:apply'), {
    actorUserId: 'user',
    runId,
    expectedRevision: current.revision,
    operationId: `${operation && typeof operation === 'object' && 'type' in operation ? operation.type : 'operation'}:${current.revision}`,
    operation,
    serverSecret: secret,
  })
}

test('surface admission claims an authentic native room delivery and projects/resumes typed waits', async () => {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  const fixture = await convex.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'Workspace', slug: 'ws',
      status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'human', workspaceId: 'ws', type: 'human',
      userId: 'user', displayName: 'Human', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'member', workspaceId: 'ws', principalId: 'human',
      role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'agent-principal', workspaceId: 'ws', type: 'agent',
      agentId: 'agent', displayName: 'Agent', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'agent', workspaceId: 'ws', principalId: 'agent-principal',
      name: 'Agent', instructions: '', harness: 'overlay', modelId: 'openrouter/free', allowedToolIds: [],
      invocationPolicy: 'mention', createdByPrincipalId: 'human', createdAt: now, updatedAt: now })
    await ctx.db.insert('surfaceConnections', { id: 'connection', workspaceId: 'ws', platform: 'slack',
      externalTeamId: 'team', status: 'active', installedByUserId: 'user', createdAt: now, updatedAt: now })
    await ctx.db.insert('surfaceBindings', { id: 'binding', connectionId: 'connection', agentId: 'agent',
      channelId: 'channel', status: 'active', createdByUserId: 'user', createdAt: now, updatedAt: now })
    const conversationId = await ctx.db.insert('conversations', { userId: 'user', workspaceId: 'ws',
      conversationType: 'channel', createdByPrincipalId: 'human', externalPlatform: 'slack',
      externalChannelId: 'channel', externalThreadId: 'thread', surfaceBindingId: 'binding',
      title: 'Slack room', lastModified: now, createdAt: now, updatedAt: now, lastMode: 'act',
      askModelIds: [], actModelId: 'openrouter/free' })
    for (const [principalId, principalType] of [['human', 'human'], ['agent-principal', 'agent']] as const) {
      await ctx.db.insert('conversationParticipants', { conversationId, workspaceId: 'ws', principalId, principalType,
        role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    }
    return { conversationId }
  })
  const begin = {
    serverSecret: secret, turnId: 'surface:slack:binding:message', workflowRunId: 'workflow',
    actorUserId: 'user', workspaceId: 'ws', creatorPrincipalId: 'human', agentId: 'agent',
    agentPrincipalId: 'agent-principal', platform: 'slack' as const, teamId: 'team', channelId: 'channel',
    threadId: 'thread', messageId: 'message', bindingId: 'binding', connectionId: 'connection',
    conversationId: fixture.conversationId, userContent: 'Help me.', importedAuthorName: 'External User',
    modelId: 'openrouter/free', placeholderTs: '123.45',
  }
  const first = await convex.mutation(mutation('surfaces/surfaceExecutions:beginSurfaceTurn'), begin)
  expect(first.owner).toBe('same')
  const execution = first.execution as {
    agentRunId: string
    harnessRunId: string
    assistantMessageId: string
    userMessageId: string
  }
  expect(execution.harnessRunId).toBe(`workspace:${execution.agentRunId}`)
  await convex.run(async ctx => {
    const run = await ctx.db.get(execution.agentRunId as never)
    expect(run?.workflowRunId).toBeUndefined()
  })
  const duplicate = await convex.mutation(mutation('surfaces/surfaceExecutions:beginSurfaceTurn'), {
    ...begin, workflowRunId: 'foreign-workflow',
  })
  expect(duplicate.owner).toBe('foreign')
  expect((await convex.mutation(mutation('surfaces/surfaceExecutions:beginSurfaceTurn'), begin)).owner).toBe('same')
  const unowned = await convex.mutation(mutation('collaboration/directMessages:startAgentTurn'), {
    actorUserId: 'user', agentId: 'agent', authorPrincipalId: 'agent-principal',
    initiatorPrincipalId: 'human', clientNonce: 'unowned-assistant',
    conversationId: fixture.conversationId, modelId: 'openrouter/free', executionEngine: 'overlay_harness',
    turnId: 'unowned-turn', userMessageId: execution.userMessageId, workspaceId: 'ws', serverSecret: secret,
  })
  await convex.run(async ctx => {
    await ctx.db.patch(unowned.runId as never, { harnessRunId: `workspace:${unowned.runId}` })
  })
  await expect(convex.mutation(mutation('harness/runs:admit'), {
    runId: `workspace:${unowned.runId}`, deliveryAgentRunId: unowned.runId,
    source: { conversationId: fixture.conversationId }, goal: 'Help me.', constraints: [],
    policy: {
      actorUserId: 'user', workspaceId: 'ws', allowedToolIds: [], requiresPlan: false,
      deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxDepth: 2, maxParallelChildren: 2,
    },
    serverSecret: secret,
  })).rejects.toThrow('HARNESS_DELIVERY_TARGET_DENIED')
  const admission = await convex.mutation(mutation('harness/runs:admit'), {
    runId: execution.harnessRunId,
    deliveryAgentRunId: execution.agentRunId,
    source: { conversationId: fixture.conversationId },
    goal: 'Help me.',
    constraints: [],
    policy: {
      actorUserId: 'user', workspaceId: 'ws', allowedToolIds: [], requiresPlan: false,
      deadlineAt: Date.now() + 60_000, maxCostMicros: 0, maxDepth: 2, maxParallelChildren: 2,
    },
    serverSecret: secret,
  })
  expect(admission.runId).toBe(execution.harnessRunId)
  const failure = { code: 'SURFACE_AUTHORIZATION_CHANGED', message: 'Surface workspace authority changed.', retryable: false }
  const failedBegin = await convex.mutation(mutation('surfaces/surfaceExecutions:beginSurfaceTurn'), {
    ...begin, turnId: 'surface:slack:binding:failed-message', messageId: 'failed-message',
  })
  const failedExecution = failedBegin.execution
  await convex.mutation(mutation('harness/runs:admit'), {
    runId: failedExecution.harnessRunId, deliveryAgentRunId: failedExecution.agentRunId,
    source: { conversationId: fixture.conversationId }, goal: 'Help me.', constraints: [],
    policy: admission.policy, serverSecret: secret,
  })
  const failArgs = {
    serverSecret: secret, turnId: failedExecution.turnId, workflowRunId: 'workflow',
    agentRunId: failedExecution.agentRunId, assistantMessageId: failedExecution.assistantMessageId, failure,
  }
  expect(await convex.mutation(mutation('surfaces/surfaceExecutions:failOwnedSurfaceTurn'), {
    ...failArgs, workflowRunId: 'foreign',
  })).toEqual({ persisted: false })
  expect(await convex.mutation(mutation('surfaces/surfaceExecutions:failOwnedSurfaceTurn'), failArgs))
    .toEqual({ persisted: true })
  expect(await convex.mutation(mutation('surfaces/surfaceExecutions:failOwnedSurfaceTurn'), failArgs))
    .toEqual({ persisted: false })
  await convex.run(async ctx => {
    const run = await ctx.db.get(failedExecution.agentRunId)
    const message = await ctx.db.get(failedExecution.assistantMessageId)
    const harness = await ctx.db.query('harnessRuns')
      .withIndex('by_runId', q => q.eq('runId', failedExecution.harnessRunId)).unique()
    expect(run?.status).toBe('failed')
    expect(run?.terminalError).toEqual(failure)
    expect(message?.content).toBe(failure.message)
    expect(JSON.parse(harness!.metadataJson)).toMatchObject({ status: 'failed', terminalReason: failure.message })
  })
  await applyHarness(convex, execution.harnessRunId, { type: 'claim_execution', workflowRunId: 'workflow' })
  await convex.mutation(mutation('chat/conversations:attachAgentRunWorkflow'), {
    runId: execution.agentRunId, serverSecret: secret, userId: 'user', workflowRunId: 'workflow',
  })
  expect(await convex.mutation(mutation('surfaces/surfaceExecutions:failOwnedSurfaceTurn'), {
    ...failArgs, turnId: begin.turnId, agentRunId: execution.agentRunId, assistantMessageId: execution.assistantMessageId,
  })).toEqual({ persisted: false })

  await applyHarness(convex, execution.harnessRunId, {
    type: 'block', blocker: { kind: 'input', question: 'Which document?' },
  })
  const inputWait = await convex.mutation(mutation('harness/runs:publishWait'), {
    actorUserId: 'user', runId: execution.harnessRunId, workflowRunId: 'workflow',
    request: { kind: 'input', token: 'input-secret' }, serverSecret: secret,
  })
  await convex.mutation(mutation('chat/conversations:transitionAgentRun'), {
    runId: execution.agentRunId, userId: 'user', expectedWorkflowRunId: 'workflow',
    status: 'waiting_for_input', inputRequest: {
      token: inputWait.token, requestedAt: inputWait.createdAt, question: inputWait.question,
    }, serverSecret: secret,
  })
  await convex.run(async ctx => {
    const assistant = await ctx.db.get(execution.assistantMessageId as never)
    expect(assistant?.parts).toContainEqual({
      type: 'data-native-agent-input',
      data: {
        runId: execution.agentRunId, conversationId: fixture.conversationId, userId: 'user',
        token: 'input-secret', requestedAt: inputWait.createdAt, question: 'Which document?',
      },
    })
  })
  await convex.mutation(mutation('harness/runs:resolveWait'), {
    actorUserId: 'user', runId: execution.harnessRunId, workflowRunId: 'workflow',
    token: inputWait.token, serverSecret: secret,
  })
  await applyHarness(convex, execution.harnessRunId, { type: 'resume' })
  await convex.mutation(mutation('chat/conversations:transitionAgentRun'), {
    runId: execution.agentRunId, userId: 'user', expectedWorkflowRunId: 'workflow', status: 'running', serverSecret: secret,
  })
  await convex.run(async ctx => {
    const assistant = await ctx.db.get(execution.assistantMessageId as never)
    expect(assistant?.parts?.some(part => part.type === 'data-native-agent-input')).toBe(false)
  })

  await applyHarness(convex, execution.harnessRunId, {
    type: 'block', blocker: { kind: 'approval', question: 'Approve this action?' },
  })
  const approvalWait = await convex.mutation(mutation('harness/runs:publishWait'), {
    actorUserId: 'user', runId: execution.harnessRunId, workflowRunId: 'workflow',
    request: {
      kind: 'approval', token: 'approval-secret',
      requests: [{ approvalId: 'approval', toolCallId: 'call', toolName: 'write_file', input: { path: 'note.txt' } }],
    },
    serverSecret: secret,
  })
  await convex.mutation(mutation('chat/conversations:transitionAgentRun'), {
    runId: execution.agentRunId, userId: 'user', expectedWorkflowRunId: 'workflow',
    status: 'waiting_for_approval', approval: {
      token: approvalWait.token, title: approvalWait.question, requestedAt: approvalWait.createdAt,
      requests: approvalWait.requests,
    }, serverSecret: secret,
  })
  await convex.run(async ctx => {
    const assistant = await ctx.db.get(execution.assistantMessageId as never)
    expect(assistant?.parts).toContainEqual({
      type: 'data-native-agent-approval',
      data: {
        runId: execution.agentRunId, conversationId: fixture.conversationId, userId: 'user',
        token: 'approval-secret', requestedAt: approvalWait.createdAt, requests: approvalWait.requests,
      },
    })
    expect(assistant?.parts?.some(part => part.type === 'data-native-agent-input')).toBe(false)
  })
  await convex.mutation(mutation('harness/runs:resolveWait'), {
    actorUserId: 'user', runId: execution.harnessRunId, workflowRunId: 'workflow',
    token: approvalWait.token, serverSecret: secret,
  })
  await applyHarness(convex, execution.harnessRunId, { type: 'resume' })
  await convex.mutation(mutation('chat/conversations:transitionAgentRun'), {
    runId: execution.agentRunId, userId: 'user', expectedWorkflowRunId: 'workflow', status: 'running', serverSecret: secret,
  })
  await convex.run(async ctx => {
    const assistant = await ctx.db.get(execution.assistantMessageId as never)
    expect(assistant?.parts?.some(part =>
      part.type === 'data-native-agent-input' || part.type === 'data-native-agent-approval')).toBe(false)
  })

  await convex.run(async ctx => {
    const binding = await ctx.db.query('surfaceBindings').withIndex('by_entityId', q => q.eq('id', 'binding')).unique()
    await ctx.db.patch(binding!._id, { status: 'removed', updatedAt: Date.now() })
  })
  await expect(convex.mutation(mutation('surfaces/surfaceExecutions:beginSurfaceTurn'), begin)).rejects.toThrow()

  await convex.run(async ctx => {
    const run = await ctx.db.get(execution.agentRunId as never)
    const assistant = await ctx.db.get(execution.assistantMessageId as never)
    expect(run?.mode).toBe('room')
    expect(run?.executionEngine).toBe('overlay_harness')
    expect(run?.workflowRunId).toBe('workflow')
    expect(assistant?.authorKind).toBe('agent')
    expect(assistant?.authorPrincipalId).toBe('agent-principal')
    const user = await ctx.db.get(run!.userMessageId)
    expect(user?.importedAuthorName).toBe('External User')
  })

  await convex.run(async ctx => {
    const binding = await ctx.db.query('surfaceBindings').withIndex('by_entityId', q => q.eq('id', 'binding')).unique()
    await ctx.db.patch(binding!._id, { status: 'active', updatedAt: Date.now() })
    await ctx.db.patch(execution.agentRunId as never, { runner: 'tool_loop', executionEngine: undefined })
  })
  await expect(convex.mutation(mutation('surfaces/surfaceExecutions:beginSurfaceTurn'), {
    ...begin, turnId: 'surface:slack:binding:retired-message', messageId: 'retired-message',
  })).rejects.toThrow('native_runner_retired')
  await convex.run(async ctx => {
    const messages = await ctx.db.query('conversationMessages').collect()
    expect(messages.some(message => message.turnId === 'surface:slack:binding:retired-message')).toBe(false)
  })
})
