import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

test('stripping a person’s row removes the old plan fields and keeps their profile and storage', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('subscriptions', {
      userId: 'user-1', email: 'a@example.test', firstName: 'A', billingAccountId: 'ba-1', overlayStorageBytesUsed: 42,
      hasSeenOnboarding: true, tier: 'pro', planKind: 'paid', status: 'canceled', planAmountCents: 2_000, creditsUsed: 3,
      stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', autoTopUpEnabled: false, currentPeriodStart: 1,
    })
    await ctx.db.insert('subscriptions', { userId: 'user-2', overlayStorageBytesUsed: 0 })
  })
  const result = await convex.mutation(internal.billing.personalPlanCleanup.stripPersonalPlanFieldsInternal, { cursor: null })
  expect({ stripped: result.stripped, isDone: result.isDone }).toEqual({ stripped: 1, isDone: true })
  const row = await convex.run(async (ctx) => await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', 'user-1')).unique())
  const { _id, _creationTime, ...fields } = row!
  void _id
  void _creationTime
  expect(fields).toEqual({
    userId: 'user-1', email: 'a@example.test', firstName: 'A', billingAccountId: 'ba-1', overlayStorageBytesUsed: 42, hasSeenOnboarding: true,
  })
})
