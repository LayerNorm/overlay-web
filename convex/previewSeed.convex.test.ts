import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const seed = makeFunctionReference<'mutation'>('dev/seed:init')
afterEach(() => vi.unstubAllEnvs())

test('preview deployments register no crons and outbound delivery ticks are inert', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.resetModules()
  const { default: crons } = await import('./crons')
  expect(JSON.parse(crons.export())).toEqual({})
  const t = convexTest(schema, modules)
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Preview must not send outbound requests')
  })
  try {
    expect(await t.action(makeFunctionReference<'action'>('email/deliveryRunner:runMinuteTick'), {})).toBeNull()
    expect(await t.action(makeFunctionReference<'action'>('webhooks/deliveryRunner:runMinuteTick'), {})).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally { fetchSpy.mockRestore() }
})

test('preview seed refuses every non-preview deployment before writing', async () => {
  const t = convexTest(schema, modules)
  for (const environment of ['production', 'staging', 'development', '']) {
    vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
    await expect(t.mutation(seed, {})).rejects.toThrow('Preview seed is unavailable')
  }
  expect(await t.run((ctx) => ctx.db.query('subscriptions').take(1))).toHaveLength(0)
})

test('preview seed requires sandbox identity and creates fixtures idempotently', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', '')
  const t = convexTest(schema, modules)
  await expect(t.mutation(seed, {})).rejects.toThrow('sandbox preview login identity')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_preview_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'preview@example.test')
  const first = await t.mutation(seed, {})
  expect(await t.mutation(seed, {})).toEqual(first)
  const counts = await t.run(async (ctx) => ({
    users: (await ctx.db.query('subscriptions').take(5)).length,
    workspaces: (await ctx.db.query('workspaces').take(5)).length,
    members: (await ctx.db.query('workspaceMemberships').take(5)).length,
    conversations: (await ctx.db.query('conversations').take(5)).length,
    files: (await ctx.db.query('files').take(5)).length,
    automations: await ctx.db.query('automations').take(5),
  }))
  expect(counts).toMatchObject({ users: 1, workspaces: 1, members: 1, conversations: 1, files: 2 })
  expect(counts.automations).toHaveLength(1)
  expect(counts.automations[0]).toMatchObject({ enabled: false, status: 'paused' })
})
