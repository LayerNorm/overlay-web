import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const seed = makeFunctionReference<'mutation'>('dev/nativeThreadQa:init')
const compatibility = makeFunctionReference<'query'>('chat/conversations:getNativeThreadCompatibility')
afterEach(() => vi.unstubAllEnvs())

test.each(['production', 'staging', 'development', ''])('retirement fixtures refuse %s', async environment => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await expect(t.mutation(seed, {})).rejects.toThrow('Preview seed is unavailable')
  expect(await t.run(ctx => ctx.db.query('workspaces').collect())).toHaveLength(0)
})

test('retirement fixtures require the configured synthetic identity', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', '')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', '')
  const t = convexTest(schema, modules)
  await expect(t.mutation(seed, {})).rejects.toThrow('Configure the sandbox preview login identity')
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toHaveLength(0)
})

test('retirement fixtures create real read-only scopes and preserve writable room roots without workers', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_retirement_qa')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'retirement@example.test')
  vi.stubEnv('INTERNAL_API_SECRET', 'retirement-qa-test')
  const t = convexTest(schema, modules)
  const result = await t.mutation(seed, {})
  const authorization = { userId: result.userId, workspaceId: result.workspaceId, serverSecret: 'retirement-qa-test' }
  for (const fixture of [result.personal, result.agent]) {
    await expect(t.query(compatibility, { ...authorization, conversationId: fixture.conversationId }))
      .resolves.toMatchObject({ readOnly: true, code: 'native_runner_retired' })
  }
  await expect(t.query(compatibility, { ...authorization, conversationId: result.room.conversationId }))
    .resolves.toEqual({ readOnly: false })
  await expect(t.query(compatibility, { ...authorization, conversationId: result.room.conversationId,
    threadRootMessageId: result.room.assistantMessageId }))
    .resolves.toMatchObject({ readOnly: true, code: 'native_runner_retired' })
  const rowsBefore = await t.run(async ctx => ({
    conversations: await ctx.db.query('conversations').collect(),
    messages: await ctx.db.query('conversationMessages').collect(),
    runs: await ctx.db.query('conversationAgentRuns').collect(),
  }))
  expect(rowsBefore.runs).toHaveLength(3)
  for (const run of rowsBefore.runs) {
    expect(run.status).toBe('failed')
    expect(run.workflowRunId).toBeUndefined()
    expect(run.harnessRunId).toBeUndefined()
  }
  await t.run(async ctx => {
    const balance = (await ctx.db.query('billingAccountBalances').collect())[0]
    await ctx.db.patch(balance._id, { usedMicros: 100_000 })
  })
  expect(await t.mutation(seed, {})).toEqual(result)
  await t.run(async ctx => {
    expect(await ctx.db.query('conversations').collect()).toEqual(rowsBefore.conversations)
    expect(await ctx.db.query('conversationMessages').collect()).toEqual(rowsBefore.messages)
    expect(await ctx.db.query('conversationAgentRuns').collect()).toEqual(rowsBefore.runs)
    expect((await ctx.db.query('billingAccountBalances').collect())[0].usedMicros).toBe(100_000)
    expect(await ctx.db.system.query('_scheduled_functions').collect()).toHaveLength(0)
  })
})
