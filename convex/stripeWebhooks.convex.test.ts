import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const processEvent = makeFunctionReference<'mutation'>('billing/stripeWebhooks:processEventInternal')
afterEach(() => vi.unstubAllEnvs())

test('Preview ignores another backend test event without billing writes and refuses live events', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  const t = convexTest(schema, modules)
  const event = { id: 'evt_foreign', type: 'customer.subscription.created', livemode: false,
    data: { object: { metadata: { billingAccountId: 'another-backend-account' } } } }
  expect(await t.mutation(processEvent, { event })).toBeNull()
  expect(await snapshot(t)).toEqual({ events: [], subscriptions: [], topUps: [], balance: null })
  await expect(t.mutation(processEvent, { event: { ...event, livemode: true } })).rejects.toThrow('live Stripe')
})

async function provisionAccount(t: ReturnType<typeof convexTest>) {
  await t.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba-retry', scope: 'workspace', workspaceId: 'ws-retry',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('billingAccountBalances', { billingAccountId: 'ba-retry', mode: 'budgeted', includedMicros: 5_000_000,
      institutionalGrantMicros: 100, allowanceUsedMicros: 2_955_000, topUpPurchasedMicros: 200, topUpBalanceMicros: 200,
      usedMicros: 2_955_000, reservedMicros: 933_000, version: 1, createdAt: 1, updatedAt: 1 })
  })
}

const snapshot = (t: ReturnType<typeof convexTest>) => t.run(async ctx => ({
  events: await ctx.db.query('processedWebhookEvents').collect(),
  subscriptions: await ctx.db.query('billingAccountSubscriptions').collect(),
  topUps: await ctx.db.query('budgetTopUps').collect(),
  balance: await ctx.db.query('billingAccountBalances').first(),
}))

test('failed subscription persistence rolls back deduplication and the same event can retry once', async () => {
  vi.stubEnv('STRIPE_PAID_UNIT_PRICE_ID', 'price_retry')
  vi.stubEnv('DEV_STRIPE_PAID_UNIT_PRICE_ID', 'price_retry')
  const t = convexTest(schema, modules)
  const created = Math.floor(Date.now() / 1000)
  const event = { id: 'evt_retry_subscription', type: 'customer.subscription.created', created,
    data: { object: { id: 'sub_retry', customer: 'cus_retry', status: 'active',
      metadata: { billingAccountId: 'ba-retry' },
      items: { data: [{ price: { id: 'price_retry' }, quantity: 8,
        current_period_start: created, current_period_end: created + 2_592_000 }] } } } }
  await expect(t.mutation(processEvent, { event })).rejects.toThrow()
  expect(await snapshot(t)).toEqual({ events: [], subscriptions: [], topUps: [], balance: null })

  await provisionAccount(t)
  await t.mutation(processEvent, { event })
  const persisted = await snapshot(t)
  expect(persisted.events).toHaveLength(1)
  expect(persisted.events[0]).toMatchObject({ eventId: event.id, status: 'processed' })
  expect(persisted.subscriptions).toHaveLength(1)
  expect(persisted.subscriptions[0]).toMatchObject({ providerSubscriptionId: 'sub_retry', planAmountCents: 800 })
  expect(persisted.balance).toMatchObject({ includedMicros: 8_000_000, usedMicros: 2_955_000,
    allowanceUsedMicros: 2_955_000, reservedMicros: 933_000, institutionalGrantMicros: 100,
    topUpPurchasedMicros: 200, topUpBalanceMicros: 200 })
  await t.mutation(processEvent, { event })
  expect(await snapshot(t)).toEqual(persisted)
})

test('failed top-up can retry without losing or doubling its authoritative paid amount', async () => {
  const t = convexTest(schema, modules)
  const event = { id: 'evt_retry_topup', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'cs_retry', customer: 'cus_retry', payment_intent: 'pi_retry', mode: 'payment',
      payment_status: 'paid', amount_total: 500,
      metadata: { kind: 'budget_topup', userId: 'user-retry', billingAccountId: 'ba-retry', amountCents: '900' } } } }
  await t.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba-retry', scope: 'personal', userId: 'user-retry',
      primaryBillingContactUserId: 'user-retry', status: 'active', pricingVersion: 'markup_25_v1',
      markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
  })
  await expect(t.mutation(processEvent, { event })).rejects.toThrow('billing_account_balance_is_legacy_synced')
  expect((await snapshot(t)).events).toHaveLength(0)
  await t.run(async ctx => {
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', q => q.eq('billingAccountId', 'ba-retry')).unique()
    if (account) await ctx.db.delete(account._id)
  })
  await provisionAccount(t)
  await t.mutation(processEvent, { event })
  const persisted = await snapshot(t)
  expect(persisted.events).toHaveLength(1)
  expect(persisted.topUps).toHaveLength(1)
  expect(persisted.topUps[0]).toMatchObject({ amountCents: 500, status: 'succeeded' })
  expect(persisted.balance).toMatchObject({ topUpPurchasedMicros: 5_000_200, topUpBalanceMicros: 5_000_200,
    usedMicros: 2_955_000, reservedMicros: 933_000 })
  await t.mutation(processEvent, { event })
  expect(await snapshot(t)).toEqual(persisted)
})
