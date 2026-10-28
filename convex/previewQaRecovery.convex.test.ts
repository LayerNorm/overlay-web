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
