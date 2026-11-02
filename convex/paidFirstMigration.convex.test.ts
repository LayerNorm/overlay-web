import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const { retrieve } = vi.hoisted(() => ({ retrieve: vi.fn() }))
vi.mock('stripe', () => ({ default: class { subscriptions = { retrieve } } }))
const modules = import.meta.glob('./**/*.ts')
const migrate = makeFunctionReference<'action'>('billing/paidFirstMigrationNode:backfill')
const event = makeFunctionReference<'mutation'>('billing/stripeWebhooks:processEventInternal')
const deployment = 'https://isolated.example.convex.cloud'
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

async function fixture() {
  vi.stubEnv('CONVEX_CLOUD_URL', deployment)
  vi.stubEnv('DEV_STRIPE_SECRET_KEY', 'test-fixture-not-a-secret')
  vi.stubEnv('STRIPE_SECRET_KEY', 'test-fixture-not-a-secret')
  vi.stubEnv('STRIPE_PAID_UNIT_PRICE_ID', 'price_paid')
  vi.stubEnv('DEV_STRIPE_PAID_UNIT_PRICE_ID', 'price_paid')
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  const start = Math.floor(Date.now() / 1000) - 60
  const end = start + 2_592_000
  const subscription = { id: 'sub_paid', customer: 'cus_paid', status: 'active', livemode: false, metadata: { billingAccountId: 'ba_paid' },
    items: { data: [{ price: { id: 'price_paid' }, quantity: 8, current_period_start: start, current_period_end: end }] },
    latest_invoice: { id: 'in_paid', status: 'paid', currency: 'usd', amount_paid: 800, billing_reason: 'subscription_cycle', customer: 'cus_paid',
      parent: { subscription_details: { subscription: 'sub_paid' } }, lines: { has_more: false, data: [{ quantity: 8,
        period: { start, end }, pricing: { price_details: { price: 'price_paid' } }, parent: { subscription_item_details: { proration: false } } }] } } }
  retrieve.mockResolvedValue(subscription)
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba_paid', scope: 'workspace', workspaceId: 'ws_paid',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
  })
  await t.mutation(event, { event: { id: 'evt_existing', type: 'customer.subscription.updated', created: start, data: { object: subscription } } })
  await t.run(async ctx => {
    const balance = (await ctx.db.query('billingAccountBalances').first())!
    await ctx.db.patch(balance._id, { includedMicros: 8_000_000, usedMicros: 2_000_000, reservedMicros: 1_000_000,
      allowanceUsedMicros: 2_000_000, topUpPurchasedMicros: 3_000_000, topUpBalanceMicros: 3_000_000 })
  })
  const snapshot = () => t.run(async ctx => ({ subscription: await ctx.db.query('billingAccountSubscriptions').first(), balance: await ctx.db.query('billingAccountBalances').first() }))
  return { t, snapshot, subscription }
}

test('migration defaults to read-only and rejects an unconfirmed deployment', async () => {
  const { t, snapshot } = await fixture()
  const before = await snapshot()
  await expect(t.action(migrate, { expectedDeploymentUrl: 'wrong' })).rejects.toThrow('deployment_confirmation_required')
  expect(retrieve).not.toHaveBeenCalled()
  const report = await t.action(migrate, { expectedDeploymentUrl: deployment })
  expect(report).toMatchObject({ dryRun: true, isDone: true, outcomes: [{ billingAccountId: 'ba_paid', status: 'eligible' }] })
  expect(await snapshot()).toEqual(before)
})

test('verified backfill preserves existing usage, holds and top-ups without granting credit twice', async () => {
  const { t, snapshot } = await fixture()
  const before = await snapshot()
  const report = await t.action(migrate, { expectedDeploymentUrl: deployment, apply: true })
  expect(report.outcomes).toEqual([{ billingAccountId: 'ba_paid', status: 'applied' }])
  const after = await snapshot()
  expect(after.subscription?.paidInvoiceId).toBe('in_paid')
  for (const key of ['includedMicros', 'usedMicros', 'reservedMicros', 'allowanceUsedMicros', 'topUpPurchasedMicros', 'topUpBalanceMicros'] as const) {
    expect(after.balance?.[key]).toBe(before.balance?.[key])
  }
  expect((await t.action(migrate, { expectedDeploymentUrl: deployment, apply: true })).outcomes).toEqual([])
  expect(await snapshot()).toEqual(after)
})

test('unfunded, foreign or live-preview evidence never changes a wallet', async () => {
  const { t, snapshot, subscription } = await fixture()
  const before = await snapshot()
  subscription.latest_invoice.amount_paid = 0
  expect((await t.action(migrate, { expectedDeploymentUrl: deployment, apply: true })).outcomes[0].status).toBe('needs_review')
  subscription.latest_invoice.amount_paid = 800
  subscription.customer = 'foreign'
  expect((await t.action(migrate, { expectedDeploymentUrl: deployment, apply: true })).outcomes[0].status).toBe('needs_review')
  subscription.customer = 'cus_paid'; subscription.livemode = true
  expect((await t.action(migrate, { expectedDeploymentUrl: deployment, apply: true })).outcomes[0].reason).toBe('live_subscription_in_preview')
  expect(await snapshot()).toEqual(before)
})

test('an empty candidate page still advances to paid workspaces on the next page', async () => {
  const { t } = await fixture()
  await t.run(async ctx => {
    const row = (await ctx.db.query('billingAccountSubscriptions').first())!
    const { _id, _creationTime: creationTime, ...subscription } = row
    void creationTime
    await ctx.db.delete(_id)
    for (let index = 0; index < 25; index++) {
      await ctx.db.insert('billingAccountSubscriptions', {
        ...subscription, billingAccountId: `ba_free_${index}`, planKind: 'free', planAmountCents: 0,
      })
    }
    await ctx.db.insert('billingAccountSubscriptions', subscription)
  })
  const first = await t.action(migrate, { expectedDeploymentUrl: deployment, cursor: null })
  expect(first).toMatchObject({ dryRun: true, isDone: false, outcomes: [] })
  expect(retrieve).not.toHaveBeenCalled()
  const last = await t.action(migrate, { expectedDeploymentUrl: deployment, cursor: first.continueCursor })
  expect(last).toMatchObject({ dryRun: true, isDone: true, outcomes: [{ billingAccountId: 'ba_paid', status: 'eligible' }] })
})
