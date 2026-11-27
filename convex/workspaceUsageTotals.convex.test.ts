import { afterAll, beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { api, internal } from './_generated/api'
import { insertUsageOperation } from './billing/usageTotals'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const previousSecret = process.env.INTERNAL_API_SECRET
beforeAll(() => { process.env.INTERNAL_API_SECRET = 'test-secret' })
afterAll(() => {
  if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousSecret
})

test('usage totals add up this period’s settled charges per resource', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    const row = (id: string, fields: Record<string, unknown>) => ctx.db.insert('budgetReservations', {
      userId: 'user-1', billingAccountId: 'ba-1', reservationId: id, status: 'finalized', kind: 'agent',
      reservedCents: 100, createdAt: 2_000, updatedAt: 2_000, ...fields,
    } as never)
    await row('r1', { modelId: 'gpt-5.4', operationId: 'conversation.act', finalizedCents: 30, usageTokens: 1_000 })
    await row('r2', { modelId: 'gpt-5.4', operationId: 'conversation.act', finalizedCents: 20, usageTokens: 500 })
    await row('r3', { kind: 'sandbox', operationId: 'lease', finalizedCents: 40, usageSeconds: 3_600 })
    await row('r4', { kind: 'generation', operationId: 'websearch.web_search:1', finalizedCents: 5 })
    // Not counted: released, another account, before the period.
    await row('r5', { status: 'released', finalizedCents: 999 })
    await row('r6', { billingAccountId: 'ba-2', finalizedCents: 999 })
    await row('r7', { createdAt: 500, finalizedCents: 999 })
    // Machine time metered straight onto the balance records its amount on the usage operation.
    await insertUsageOperation(ctx, {
      userId: 'user-1', billingAccountId: 'ba-1', operationId: 'sandbox-meter:l1:1', recorded: 1,
      cents: 25, kind: 'sandbox', usageSeconds: 1_200, createdAt: 3_000,
    })
    // Older rows without an amount are skipped.
    await insertUsageOperation(ctx, {
      userId: 'user-1', billingAccountId: 'ba-1', operationId: 'chat.suggestions:1', recorded: 1, createdAt: 3_000,
    })
  })
  const result = await convex.query(api.billing.usageTotals.usageTotalsByServer, {
    billingAccountId: 'ba-1', periodStart: 1_000, serverSecret: 'test-secret',
  })
  expect(result.truncated).toBe(false)
  expect(result.totals.map((t) => [t.resource, t.cents, t.count])).toEqual([
    ['computers', 65, 2], ['models', 50, 2], ['web_search', 5, 1],
  ])
  expect(result.totals[1].tokens).toBe(1_500)
  expect(result.totals[0].seconds).toBe(4_800)
})

const DAY = 86_400_000

test('whole days come from the daily totals, the partial first day charge by charge, and they add up the same', async () => {
  const convex = convexTest(schema, modules)
  const periodStart = 10 * DAY + 6 * 3_600_000
  await convex.run(async (ctx) => {
    const charge = (n: number, fields: Record<string, unknown>) => insertUsageOperation(ctx, {
      userId: 'user-1', billingAccountId: 'ba-1', operationId: `op-${n}`, recorded: 1, kind: 'agent', ...fields,
    } as never)
    await charge(1, { cents: 999, modelId: 'gpt-5.4', createdAt: periodStart - 1 }) // before the period, same day
    await charge(2, { cents: 10, modelId: 'gpt-5.4', usageTokens: 100, createdAt: periodStart + 1 }) // partial day
    await charge(3, { cents: 20, modelId: 'gpt-5.4', usageTokens: 200, createdAt: 11 * DAY + 5 })
    await charge(4, { cents: 30, modelId: 'claude-opus', usageTokens: 300, createdAt: 11 * DAY + 9 })
    await charge(5, { cents: 40, modelId: 'gpt-5.4', usageTokens: 400, userId: 'user-2', createdAt: 12 * DAY })
    await charge(6, { cents: 7, kind: 'sandbox', usageSeconds: 60, createdAt: 12 * DAY + 1 })
  })
  const rows = await convex.run(async (ctx) => await ctx.db.query('usageDays').collect())
  expect(rows).toHaveLength(5) // day 10 (one model), day 11 (two models), day 12 (two people/resources)
  const result = await convex.query(api.billing.usageTotals.usageTotalsByServer, {
    billingAccountId: 'ba-1', periodStart, serverSecret: 'test-secret',
  })
  const models = result.totals.find((t) => t.resource === 'models')!
  expect([models.cents, models.count, models.tokens]).toEqual([100, 4, 1_000])
  expect(models.byModel?.map((m) => [m.modelId, m.cents, m.count])).toEqual([['gpt-5.4', 70, 3], ['claude-opus', 30, 1]])
  expect(result.totals.find((t) => t.resource === 'computers')).toMatchObject({ cents: 7, count: 1, seconds: 60 })
})

test('the backfill counts rows written before the daily totals, once', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert('usageOperations', {
        userId: 'user-1', billingAccountId: 'ba-1', operationId: `old-${i}`, recorded: 1, cents: 5, kind: 'agent',
        modelId: 'gpt-5.4', createdAt: 20 * DAY + i,
      })
    }
    await ctx.db.insert('usageOperations', { userId: 'user-1', operationId: 'free', recorded: 1, createdAt: 20 * DAY })
  })
  await convex.mutation(internal.billing.usageTotals.backfillDailyTotals, {})
  await convex.mutation(internal.billing.usageTotals.backfillDailyTotals, {})
  const rows = await convex.run(async (ctx) => await ctx.db.query('usageDays').collect())
  expect(rows.map((r) => [r.cents, r.count])).toEqual([[15, 3]])
  const result = await convex.query(api.billing.usageTotals.usageTotalsByServer, {
    billingAccountId: 'ba-1', periodStart: 20 * DAY, serverSecret: 'test-secret',
  })
  expect(result.totals[0]).toMatchObject({ resource: 'models', cents: 15, count: 3 })
})
