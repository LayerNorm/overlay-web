import { afterAll, beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const previous = {
  secret: process.env.INTERNAL_API_SECRET,
}
beforeAll(() => {
  process.env.INTERNAL_API_SECRET = 'test-secret'
})
afterAll(() => {
  for (const [key, value] of [
    ['INTERNAL_API_SECRET', previous.secret],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('usage recorded without a reservation is charged to the paid workspace, never the person', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws-1', kind: 'personal', name: 'W', slug: 'ws-1', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceUserPreferences', { userId: 'user-1', activeWorkspaceId: 'ws-1', updatedAt: 1 })
    await ctx.db.insert('billingAccounts', {
      billingAccountId: 'ba-1', scope: 'workspace', workspaceId: 'ws-1', status: 'active', pricingVersion: 'markup_25_v1',
      markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
    })
  })
  await convex.mutation(api.billing.accountSubscriptions.upsertByServer, {
    billingAccountId: 'ba-1', serverSecret: 'test-secret', planKind: 'paid', planAmountCents: 800, status: 'active',
  })
  await convex.mutation(api.platform.usage.recordBatch, {
    serverSecret: 'test-secret', userId: 'user-1', operationId: 'chat.suggestions:1',
    events: [{ type: 'generation', modelId: 'openrouter/free', cost: 3, inputTokens: 100, outputTokens: 50, timestamp: 5 }],
  })
  const state = await convex.run(async (ctx) => ({
    balance: (await ctx.db.query('billingAccountBalances').collect()).find((row) => row.billingAccountId === 'ba-1'),
    operation: await ctx.db.query('usageOperations').withIndex('by_operationId', (q) => q.eq('operationId', 'chat.suggestions:1')).first(),
    personal: await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', 'user-1')).first(),
  }))
  expect(state.balance?.usedMicros).toBe(3 * 10_000)
  expect(state.operation?.billingAccountId).toBe('ba-1')
  expect(state.operation?.cents).toBe(3)
  expect(state.operation?.usageTokens).toBe(150)
  // The person's own account is untouched.
  expect(state.personal?.creditsUsed ?? 0).toBe(0)
})
