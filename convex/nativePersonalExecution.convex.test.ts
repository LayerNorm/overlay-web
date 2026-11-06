import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'native-execution-test-secret'
const mutation = (name: string) => makeFunctionReference<'mutation'>(name)
const execution = makeFunctionReference<'query'>('chat/personal:getExecution')
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  const t = convexTest(schema, modules)
  const conversationId = await t.run(async ctx => {
    await ctx.db.insert('authorizationRoles', { roleId: 'member', name: 'Member', capabilities: ['conversations.read', 'conversations.edit'], isSystem: false, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('authorizationUserRoles', { roleId: 'member', userId: 'u', createdAt: 1 })
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: 'p', userId: 'u', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: 'p', membershipId: 'm', role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    return ctx.db.insert('conversations', { workspaceId: 'ws', userId: 'u', title: 'Native', askModelIds: [], actModelId: 'model', lastMode: 'act', createdAt: 1, lastModified: 1 })
  })
  const user = t.withIdentity({ subject: 'u' })
  const args = { workspaceId: 'ws', conversationId }
  const submitted = await user.mutation(mutation('chat/personal:submit'), {
    ...args, turnId: 'turn', mode: 'act', modelId: 'model', contentType: 'text', parts: [{ type: 'text', text: 'Work' }],
  })
  const run = await t.mutation(mutation('chat/conversations:startAgentRun'), {
    conversationId, userMessageId: submitted.messageId, turnId: 'turn', mode: 'work', modelId: 'model',
    runner: 'workflow', executionEngine: 'overlay_harness', userId: 'u', serverSecret: secret,
  })
  const runId = `personal:${run._id}`
  const admitted = await t.mutation(mutation('harness/runs:admit'), {
    runId, deliveryAgentRunId: run._id, goal: 'Reply', constraints: [], source: { conversationId },
    policy: { actorUserId: 'u', workspaceId: 'ws', allowedToolIds: [], requiresPlan: false,
      deadlineAt: Date.now() + 60_000, maxCostMicros: 1_000, maxParallelChildren: 2, maxDepth: 2, publicProgressVersion: 1 },
    serverSecret: secret,
  })
  await t.mutation(mutation('harness/runs:apply'), {
    actorUserId: 'u', runId, workflowRunId: 'workflow', executionGeneration: 0,
    operationId: 'claim', expectedRevision: admitted.revision,
    operation: { type: 'claim_execution', workflowRunId: 'workflow' }, serverSecret: secret,
  })
  await t.run(ctx => ctx.db.patch(run._id, { status: 'running', workflowRunId: 'workflow' }))
  const write = async (sequence: number, content = `Step ${sequence}`) => {
    await t.run(async ctx => {
      const receiptId = `model:${sequence}`
      const existing = await ctx.db.query('harnessReceipts')
        .withIndex('by_runId_receiptId', q => q.eq('runId', runId).eq('receiptId', receiptId)).unique()
      if (!existing) await ctx.db.insert('harnessReceipts', {
        runId, receiptId, receiptJson: JSON.stringify({ id: receiptId }), createdAt: sequence + 1,
      })
    })
    return t.mutation(mutation('harness/runs:writeTranscriptStep'), {
      actorUserId: 'u', runId, workflowRunId: 'workflow', receiptId: `model:${sequence}`, stepNumber: sequence,
      persistence: { content, parts: [{ type: 'text', text: content },
        { type: 'tool-invocation', toolInvocation: { toolCallId: `call-${sequence}`, toolName: 'lookup', state: 'result', toolOutput: { ok: true } } }] },
      serverSecret: secret,
    })
  }
  const message = () => t.run(ctx => ctx.db.get(run.assistantMessageId))
  return { t, user, args, run, runId, write, message }
}

test('native execution projects public run controls and terminal state behind live scope guards', async () => {
  const { t, user, args, run } = await fixture()
  await t.run(ctx => ctx.db.patch(run._id, { status: 'waiting_for_input',
    inputRequest: { token: 'input-token', question: 'Which file?', requestedAt: 2 } }))
  const value = await user.query(execution, args)
  expect(value).toMatchObject({ ...args, userId: 'u', compatibility: { readOnly: false },
    run: { id: run._id, turnId: 'turn', userMessageId: run.userMessageId,
      assistantMessageId: run.assistantMessageId, status: 'waiting_for_input', inputRequest: { token: 'input-token' } } })
  expect(value.run).not.toHaveProperty('harnessRunId')
  expect(value.run).not.toHaveProperty('workflowRunId')
  await t.run(ctx => ctx.db.patch(run._id, { status: 'completed', updatedAt: 5 }))
  expect((await user.query(execution, args)).run.status).toBe('completed')
  await expect(t.query(execution, args)).rejects.toThrow('UNAUTHENTICATED')
  await expect(t.withIdentity({ subject: 'other' }).query(execution, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(user.query(execution, { ...args, workspaceId: 'other' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(user.query(execution, { ...args, userId: 'u' })).rejects.toThrow()
  await t.run(async ctx => {
    const membership = (await ctx.db.query('workspaceMemberships').first())!
    await ctx.db.patch(membership._id, { status: 'suspended' })
  })
  await expect(user.query(execution, args)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('settled native checkpoints preserve rich identities, reject regression and never reopen terminal rows', async () => {
  const { t, run, runId, write, message } = await fixture()
  await t.run(ctx => ctx.db.patch(run.assistantMessageId, {
    parts: [{
      type: 'data-native-agent-input',
      data: {
        runId: run._id,
        conversationId: run.conversationId,
        userId: run.userId,
        token: 'pause',
        requestedAt: 3,
        question: 'Continue?',
      },
    }],
  }))
  expect((await message()).nativeRunId).toBe(run._id)
  expect(await write(1)).toEqual({ persisted: true })
  const first = await message()
  expect(first).toMatchObject({ nativeProgressSequence: 1, content: 'Step 1', status: 'generating' })
  const identity = JSON.stringify([runId, 'model:1', 0])
  expect(first.parts[0].id).toBe(identity)
  await write(0)
  expect(await message()).toEqual(first)
  await write(2)
  const second = await message()
  expect(second.content).toBe('Step 0\n\nStep 1\n\nStep 2')
  expect(second.parts.some((part: { id: string }) => part.id === identity)).toBe(true)
  expect(second.parts.filter((part: { type: string }) => part.type === 'tool-invocation')).toHaveLength(3)
  expect(second.parts.find((part: { type: string }) => part.type === 'data-native-agent-input')).toMatchObject({ data: { token: 'pause' } })
  expect(await write(2)).toEqual({ persisted: false })
  await t.mutation(mutation('chat/conversations:recordAgentRunProgress'), {
    runId: run._id, userId: 'u', serverSecret: secret, content: 'Flattened legacy progress',
  })
  expect(await message()).toEqual(second)
  await t.run(async ctx => {
    await ctx.db.patch(run._id, { status: 'completed' })
    await ctx.db.patch(run.assistantMessageId, { status: 'completed', content: 'Final' })
  })
  await write(3)
  expect(await message()).toMatchObject({ content: 'Final', status: 'completed', nativeProgressSequence: 2 })
})

test('native projection requires the original user turn and workflow delivery binding', async () => {
  const { t, run, write, message } = await fixture()
  await t.run(ctx => ctx.db.patch(run._id, { workflowRunId: 'replacement-workflow' }))
  await write(0)
  expect((await message()).nativeProgressSequence).toBeUndefined()
  await t.run(async ctx => {
    await ctx.db.patch(run._id, { workflowRunId: 'workflow' })
    await ctx.db.patch(run.assistantMessageId, { turnId: 'different-turn' })
  })
  await write(1)
  expect((await message()).content).toBe('')
  await t.run(async ctx => {
    await ctx.db.patch(run.assistantMessageId, { turnId: 'turn' })
    await ctx.db.patch(run.userMessageId, { nativeSubmittedAt: undefined })
  })
  await write(2)
  expect((await message()).nativeProgressSequence).toBeUndefined()
  await t.mutation(mutation('chat/conversations:recordAgentRunProgress'), {
    runId: run._id, userId: 'u', serverSecret: secret, content: 'Legacy still works',
  })
  expect((await message()).content).toBe('Legacy still works')
})
