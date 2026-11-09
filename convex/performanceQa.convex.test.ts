import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { readActivePublicStreams } from './lib/publicStreamRead'

const modules = import.meta.glob('./**/*.ts')
const init = makeFunctionReference<'mutation', Record<string, never>, {
  workspaceId: string; personalA: Id<'conversations'>; personalB: Id<'conversations'>;
  stream: Id<'conversations'>; dm: Id<'conversations'>; agent: Id<'conversations'>
}>('dev/performanceQa:init')
const start = makeFunctionReference<'mutation', { conversationId: Id<'conversations'> }, {
  conversationId: Id<'conversations'>; generation: number
}>('dev/performanceQa:startStreaming')
const tick = makeFunctionReference<'mutation'>('dev/performanceQa:tick')
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

test.each(['production', 'development', 'staging', ''])('performance fixtures refuse %s', async environment => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await expect(t.mutation(init, {})).rejects.toThrow('Preview seed is unavailable')
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toHaveLength(0)
})

test('fixed histories are idempotent; public-stream replay is bounded, repeatable and provider-free', async () => {
  vi.useFakeTimers()
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_performance_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'performance@example.test')
  const t = convexTest(schema, modules)
  const fixtures = await t.mutation(init, {})
  for (const [id, count] of [[fixtures.personalA, 50], [fixtures.personalB, 50], [fixtures.agent, 1024], [fixtures.dm, 1000], [fixtures.stream, 2]] as const) {
    expect(await t.run(ctx => ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', id)).collect())).toHaveLength(count)
  }
  const before = await t.run(ctx => ctx.db.query('conversations').collect())
  expect(await t.mutation(init, {})).toEqual(fixtures)
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toEqual(before)
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0)
  await expect(t.mutation(start, { conversationId: fixtures.personalA })).rejects.toThrow('Not the configured performance stream fixture')
  const first = await t.mutation(start, { conversationId: fixtures.stream })
  await expect(t.mutation(start, { conversationId: fixtures.stream })).rejects.toThrow('already streaming')
  await t.mutation(tick, { conversationId: fixtures.stream, generation: first.generation, step: 1 })
  const stream = await t.run(ctx => ctx.db.query('harnessPublicStreams').withIndex('by_runId',
    q => q.eq('runId', `preview-performance-v1:${fixtures.stream}`)).unique())
  expect(await t.run(ctx => readActivePublicStreams(ctx, fixtures.stream, [stream!.assistantMessageId])))
    .toMatchObject([{ text: 'Synthetic stream paragraph 1. This deterministic text does not call a model.\n\n' }])
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const completed = await t.run(ctx => ctx.db.get(stream!.assistantMessageId))
  expect(completed?.status).toBe('completed')
  expect(completed?.content).toContain('Synthetic stream paragraph 80.')
  expect(await t.run(ctx => readActivePublicStreams(ctx, fixtures.stream, [stream!.assistantMessageId]))).toEqual([])
  const second = await t.mutation(start, { conversationId: fixtures.stream })
  expect(second.generation).toBe(first.generation + 1)
  await t.mutation(tick, { conversationId: fixtures.stream, generation: first.generation, step: 1 })
  expect((await t.run(ctx => ctx.db.get(stream!._id)))?.nextSequence).toBe(0)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await t.run(ctx => ctx.db.get(stream!.assistantMessageId)))?.content).toBe(completed?.content)
  for (const table of ['conversationAgentRuns', 'harnessRuns', 'harnessPublicStreams', 'harnessPublicStreamSegments'] as const) {
    expect(await t.run(ctx => ctx.db.query(table).collect())).toHaveLength(1)
  }
  expect(await t.run(ctx => ctx.db.query('conversationMessages')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', fixtures.stream)).collect())).toHaveLength(2)
})
