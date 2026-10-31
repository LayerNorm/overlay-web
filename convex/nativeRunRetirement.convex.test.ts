import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'native-retirement-test'
const mutation = (path: string) => makeFunctionReference<'mutation'>(path)
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const now = Date.now()
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'owner', title: 'Historical task', lastMode: 'act', actModelId: 'model', askModelIds: [],
      lastModified: now, createdAt: now, updatedAt: now,
    })
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'turn', role: 'user', mode: 'act',
      content: 'Continue the task', contentType: 'text', createdAt: now,
    })
    return { conversationId, userMessageId }
  })
  const args = { ...ids, userId: 'owner', turnId: 'turn', mode: 'chat', modelId: 'model',
    runner: 'workflow', executionEngine: 'overlay_harness', serverSecret: secret }
  return { t, args }
}

test('unmarked or capped personal admission cannot create a run or assistant row', async () => {
  const { t, args } = await fixture()
  for (const identity of [
    { runner: 'workflow', executionEngine: undefined },
    { runner: 'tool_loop', executionEngine: undefined },
    { runner: 'tool_loop', executionEngine: 'overlay_harness' },
    { runner: 'remote', executionEngine: undefined },
  ]) {
    await expect(t.mutation(mutation('chat/conversations:startAgentRun'), { ...args, ...identity }))
      .rejects.toThrow('native_runner_retired')
  }
  await t.run(async ctx => {
    expect(await ctx.db.query('conversationAgentRuns').collect()).toHaveLength(0)
    expect(await ctx.db.query('conversationMessages').collect()).toHaveLength(1)
  })
})

test('native replay is idempotent but cannot adopt a historical legacy run', async () => {
  const { t, args } = await fixture()
  const run = await t.mutation(mutation('chat/conversations:startAgentRun'), args)
  expect((await t.mutation(mutation('chat/conversations:startAgentRun'), args))._id).toBe(run._id)
  await t.run(async ctx => { await ctx.db.patch(run._id, { executionEngine: undefined }) })
  await expect(t.mutation(mutation('chat/conversations:startAgentRun'), args)).rejects.toThrow('native_runner_retired')
  await t.run(async ctx => {
    expect(await ctx.db.query('conversationAgentRuns').collect()).toHaveLength(1)
    expect((await ctx.db.get(run._id))?.executionEngine).toBeUndefined()
  })
})

test('legacy workflow attachment, wait projection and resume reject without altering history', async () => {
  const { t, args } = await fixture()
  const run = await t.mutation(mutation('chat/conversations:startAgentRun'), args)
  await t.run(async ctx => { await ctx.db.patch(run._id, { executionEngine: undefined }) })
  const owner = { runId: run._id, userId: 'owner', serverSecret: secret }
  await expect(t.mutation(mutation('chat/conversations:attachAgentRunWorkflow'), { ...owner, workflowRunId: 'legacy' }))
    .rejects.toThrow('native_runner_retired')
  for (const status of ['running', 'waiting_for_approval', 'waiting_for_input']) {
    await expect(t.mutation(mutation('chat/conversations:transitionAgentRun'), { ...owner, status }))
      .rejects.toThrow('native_runner_retired')
  }
  await t.run(async ctx => {
    expect((await ctx.db.get(run._id))?.status).toBe('queued')
    expect((await ctx.db.get(run.assistantMessageId))?.content).toBe('')
  })
})

test('supported native attachment and connected-agent transitions remain available', async () => {
  const { t, args } = await fixture()
  const run = await t.mutation(mutation('chat/conversations:startAgentRun'), args)
  const owner = { runId: run._id, userId: 'owner', serverSecret: secret }
  expect((await t.mutation(mutation('chat/conversations:attachAgentRunWorkflow'), { ...owner, workflowRunId: 'native' })).status)
    .toBe('running')
  await t.run(async ctx => { await ctx.db.patch(run._id, { runner: 'remote', executionEngine: undefined }) })
  expect((await t.mutation(mutation('chat/conversations:transitionAgentRun'), { ...owner, status: 'waiting_for_approval' })).status)
    .toBe('waiting_for_approval')
})

test('legacy progress and terminal callbacks cannot overwrite persisted work, while metrics remain recordable', async () => {
  const { t, args } = await fixture()
  const run = await t.mutation(mutation('chat/conversations:startAgentRun'), args)
  await t.run(async ctx => {
    await ctx.db.patch(run._id, { executionEngine: undefined })
    await ctx.db.patch(run.assistantMessageId, { content: 'Preserved work' })
  })
  const owner = { runId: run._id, userId: 'owner', serverSecret: secret }
  for (const [name, input] of [
    ['recordAgentRunProgress', { content: 'late progress' }],
    ['completeAgentRun', { content: 'false completion', parts: [], tokens: { input: 1, output: 1 } }],
    ['failAgentRun', { errorText: 'old error', error: { code: 'old_error', message: 'old error', retryable: false } }],
  ] as const) {
    await expect(t.mutation(mutation(`chat/conversations:${name}`), { ...owner, ...input }))
      .rejects.toThrow('native_runner_retired')
  }
  await t.mutation(mutation('chat/conversations:recordAgentRunMetrics'), { ...owner, metrics: { outputTokens: 3 } })
  await t.run(async ctx => {
    expect((await ctx.db.get(run.assistantMessageId))?.content).toBe('Preserved work')
    expect((await ctx.db.get(run._id))?.status).toBe('queued')
    expect((await ctx.db.get(run._id))?.metrics?.outputTokens).toBe(3)
  })
})
