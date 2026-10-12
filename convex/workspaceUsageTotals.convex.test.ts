import { afterAll, beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
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
    await ctx.db.insert('usageOperations', {
      userId: 'user-1', billingAccountId: 'ba-1', operationId: 'sandbox-meter:l1:1', recorded: 1,
      cents: 25, kind: 'sandbox', usageSeconds: 1_200, createdAt: 3_000,
    })
    // Older rows without an amount are skipped.
    await ctx.db.insert('usageOperations', {
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
