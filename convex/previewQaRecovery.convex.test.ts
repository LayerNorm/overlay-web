import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const recover = makeFunctionReference<'mutation'>('dev/qa:recover')
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_recovery')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'qa@example.test')
  const t = convexTest(schema, modules)
  await t.mutation(makeFunctionReference<'mutation'>('dev/seed:initQa'), {})
  return t
}

test('refill preserves consumed credit and live holds, is idempotent, and rejects real billing', async () => {
  const t = await fixture()
  const id = await t.run(async ctx => {
    const balance = (await ctx.db.query('billingAccountBalances').collect())[0]
    await ctx.db.patch(balance._id, { usedMicros: 900_000, allowanceUsedMicros: 900_000, reservedMicros: 100_000 })
    return balance._id
  })
  const args = { fixture: 'paid-workspace', requestId: 'test-recovery', availableCents: 500 }
  expect(await t.mutation(recover, args)).toMatchObject({ applied: true })
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({
    includedMicros: 6_000_000, usedMicros: 900_000, allowanceUsedMicros: 900_000, reservedMicros: 100_000,
  })
  expect(await t.mutation(recover, args)).toMatchObject({ applied: false })
  await expect(t.mutation(recover, { ...args, availableCents: 1_000 })).rejects.toThrow('reused')
  await t.run(async ctx => {
    const subscription = (await ctx.db.query('billingAccountSubscriptions').collect())[0]
    await ctx.db.patch(subscription._id, { provider: 'stripe', providerCustomerId: 'cus_test' })
  })
  await expect(t.mutation(recover, { ...args, requestId: 'another' })).rejects.toThrow('synthetic active paid')
})

test('free recovery affects only configured QA usage and preserves unrelated counters', async () => {
  const t = await fixture()
  const date = new Date().toISOString().slice(0, 10)
  const ids = await t.run(async ctx => Promise.all(['workspace:preview-personal-user_recovery', 'user_other'].map(userId =>
    ctx.db.insert('dailyUsage', { userId, date, askCount: 15, writeCount: 15, agentCount: 15, browserSearchCount: 4 }))))
  await t.mutation(recover, { fixture: 'personal', requestId: 'free-reset' })
  expect(await t.run(ctx => ctx.db.get(ids[0]))).toMatchObject({ agentCount: 0, askCount: 0, browserSearchCount: 4 })
  expect(await t.run(ctx => ctx.db.get(ids[1]))).toMatchObject({ agentCount: 15 })
})

test.each(['production', 'development', 'staging', ''])('recovery refuses %s before touching records', async environment => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await expect(t.mutation(recover, { fixture: 'personal', requestId: 'denied' })).rejects.toThrow('Preview seed is unavailable')
})

test('exhausted fixture recovery affects only its counters and rebuilds preserve the result', async () => {
  const t = await fixture()
  const seed = makeFunctionReference<'mutation'>('dev/seed:initExhaustedQa')
  const created = await t.mutation(seed, {})
  const rows = () => t.run(ctx => ctx.db.query('dailyUsage').collect())
  expect((await rows())[0]).toMatchObject({ userId: `workspace:${created.workspaceId}`, agentCount: 15, askCount: 15, transcriptionSeconds: 600 })
  await t.mutation(recover, { fixture: 'exhausted-workspace', requestId: 'exhausted-reset' })
  expect((await rows())[0]).toMatchObject({ agentCount: 0, askCount: 0, transcriptionSeconds: 0 })
  await t.mutation(seed, {})
  expect(await rows()).toHaveLength(1)
  expect((await rows())[0].agentCount).toBe(0)
  expect(await t.run(ctx => ctx.db.query('billingAccountSubscriptions').collect())).toHaveLength(1)
})

test.each(['production', 'development', 'staging'])('exhausted fixture refuses %s', async environment => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await expect(t.mutation(makeFunctionReference<'mutation'>('dev/seed:initExhaustedQa'), {})).rejects.toThrow('Preview seed is unavailable')
})

const recoverRoute = makeFunctionReference<'mutation'>('dev/qa:recoverRoute')

test('route recovery is audited and replay-safe, preserves receipts and requires fresh verification', async () => {
  const t = await fixture()
  const routeKey = 'gateway:model:provider'
  const id = await t.run(ctx => ctx.db.insert('overlayFreeRoutes', {
    routeKey, transport: 'gateway', modelId: 'model', provider: 'provider', capabilitiesJson: '{}',
    pricingJson: '{"prompt":"0","completion":"0"}', catalogVerifiedAt: 1, catalogExpiresAt: Date.now() + 60_000,
    generation: 1, canaryVerifiedAt: 1, canaryExpiresAt: Date.now() + 60_000,
    quarantineReason: 'missing receipt', quarantineAt: 1, latestReceiptJson: '{"diagnostic":"retained"}', updatedAt: 1,
  }))
  const args = { routeKey, expectedReason: 'missing receipt', requestId: 'route-recovery' }
  await expect(t.mutation(recoverRoute, { ...args, expectedReason: 'different reason' })).rejects.toThrow('reason changed')
  expect(await t.mutation(recoverRoute, args)).toEqual({ applied: true })
  const recovered = await t.run(ctx => ctx.db.get(id))
  expect(recovered).toMatchObject({ catalogExpiresAt: 0, latestReceiptJson: '{"diagnostic":"retained"}' })
  expect(recovered?.quarantineReason).toBeUndefined()
  expect(recovered?.canaryExpiresAt).toBeUndefined()
  await t.run(ctx => ctx.db.patch(id, { quarantineReason: 'new failure' }))
  expect(await t.mutation(recoverRoute, args)).toEqual({ applied: false })
  expect((await t.run(ctx => ctx.db.get(id)))?.quarantineReason).toBe('new failure')
  await expect(t.mutation(recoverRoute, { ...args, expectedReason: 'new failure' })).rejects.toThrow('reused')
  expect(await t.run(ctx => ctx.db.query('auditEvents').collect())).toEqual([
    expect.objectContaining({ action: 'preview.qa.route.recover', resourceId: routeKey }),
  ])
})

test('route recovery refuses active leases, nonzero pricing and non-Preview deployments', async () => {
  const t = await fixture()
  const args = { routeKey: 'openrouter:free:openrouter', expectedReason: 'missing receipt', requestId: 'route-denials' }
  const id = await t.run(ctx => ctx.db.insert('overlayFreeRoutes', {
    routeKey: args.routeKey, transport: 'openrouter', modelId: 'free', provider: 'openrouter', capabilitiesJson: '{}',
    pricingJson: '{"prompt":"0","completion":"0"}', catalogVerifiedAt: 1, catalogExpiresAt: 2, generation: 1,
    quarantineReason: args.expectedReason, activeLeaseToken: 'lease', activeLeaseExpiresAt: 0, updatedAt: 1,
  }))
  await expect(t.mutation(recoverRoute, args)).rejects.toThrow('Settle the route lease')
  await t.run(ctx => ctx.db.patch(id, { activeLeaseToken: undefined, activeLeaseExpiresAt: undefined,
    pricingJson: '{"prompt":"0","completion":"1e-999"}' }))
  await expect(t.mutation(recoverRoute, args)).rejects.toThrow('explicitly zero')
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'production')
  await expect(t.mutation(recoverRoute, args)).rejects.toThrow('Preview seed is unavailable')
})
