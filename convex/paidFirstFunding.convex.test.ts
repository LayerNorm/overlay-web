import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const processEvent = makeFunctionReference<'mutation'>('billing/stripeWebhooks:processEventInternal')
const fund = makeFunctionReference<'mutation'>('billing/accountSubscriptions:fundPaidPeriodInternal')
const start = Math.floor(Date.now() / 1000) - 60
const month = 2_592_000
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  vi.stubEnv('STRIPE_PAID_UNIT_PRICE_ID', 'price_paid')
  vi.stubEnv('DEV_STRIPE_PAID_UNIT_PRICE_ID', 'price_paid')
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba-paid', scope: 'workspace', workspaceId: 'ws-paid',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
  })
  return t
}
function lifecycle(id: string, period = start, status = 'active', created = period) {
  return { id, type: status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated', created,
    data: { object: { id: 'sub-paid', customer: 'cus-paid', status, metadata: { billingAccountId: 'ba-paid' },
      items: { data: [{ price: { id: 'price_paid' }, quantity: 8, current_period_start: period, current_period_end: period + month }] } } } }
}
function paid(id: string, period = start, created = period + 1) {
  return { id, type: 'invoice.paid', created, data: { object: {
    id: `in-${period}`, status: 'paid', currency: 'usd', amount_paid: 800, billing_reason: 'subscription_cycle', customer: 'cus-paid',
    parent: { subscription_details: { subscription: 'sub-paid', metadata: { billingAccountId: 'ba-paid' } } },
    lines: { has_more: false, data: [{ quantity: 8, period: { start: period, end: period + month },
      pricing: { price_details: { price: 'price_paid' } }, parent: { subscription_item_details: { proration: false } } }] },
  } } }
}
const snapshot = (t: ReturnType<typeof convexTest>) => t.run(async ctx => ({
  subscription: await ctx.db.query('billingAccountSubscriptions').first(),
  balance: await ctx.db.query('billingAccountBalances').first(),
  events: await ctx.db.query('processedWebhookEvents').collect(),
}))

test('lifecycle metadata cannot grant credit; invoice paid activates once even when delivered before lifecycle', async () => {
  const t = await fixture()
  await t.mutation(processEvent, { event: lifecycle('evt-created') })
  let state = await snapshot(t)
  expect(state.subscription?.paidPeriodEnd).toBeUndefined()
  expect(state.balance?.includedMicros).toBe(0)
  await t.mutation(processEvent, { event: paid('evt-paid') })
  state = await snapshot(t)
  expect(state.subscription).toMatchObject({ paidInvoiceId: `in-${start}`, paidPeriodStart: start * 1000, paidPeriodEnd: (start + month) * 1000 })
  expect(state.balance?.includedMicros).toBe(8_000_000)
  await t.mutation(processEvent, { event: paid('evt-paid') })
  expect(await snapshot(t)).toEqual(state)
  await t.mutation(processEvent, { event: paid('evt-paid-again') })
  expect((await snapshot(t)).balance).toEqual(state.balance)

  const other = await fixture()
  await other.mutation(processEvent, { event: paid('evt-invoice-first') })
  await other.mutation(processEvent, { event: lifecycle('evt-lifecycle-late') })
  expect((await snapshot(other)).balance?.includedMicros).toBe(8_000_000)
  expect((await snapshot(other)).subscription?.paidPeriodEnd).toBe((start + month) * 1000)
})

test('older paid evidence still funds after newer lifecycle metadata, but checkout confirmation cannot double-credit', async () => {
  const t = await fixture()
  await t.mutation(processEvent, { event: lifecycle('evt-newer-metadata', start, 'active', start + 100) })
  await t.mutation(processEvent, { event: paid('evt-older-paid') })
  const before = await snapshot(t)
  expect(before.balance?.includedMicros).toBe(8_000_000)
  expect(await t.mutation(fund, { billingAccountId: 'ba-paid', stripeCustomerId: 'cus-paid', stripeSubscriptionId: 'sub-paid',
    paidInvoiceId: `in-${start}`, paidPeriodStart: start * 1000, paidPeriodEnd: (start + month) * 1000, amountCents: 800 })).toEqual({ applied: false })
  expect(await snapshot(t)).toEqual(before)
})

test('renewal preserves live holds and retries atomically after settlement', async () => {
  const t = await fixture()
  await t.mutation(processEvent, { event: paid('evt-initial') })
  await t.run(async ctx => {
    const balance = (await ctx.db.query('billingAccountBalances').first())!
    await ctx.db.patch(balance._id, { reservedMicros: 10_000, usedMicros: 20_000 })
  })
  const before = await snapshot(t)
  await expect(t.mutation(processEvent, { event: paid('evt-renewal', start + month) })).rejects.toThrow('billing_period_rollover_has_active_reservations')
  expect(await snapshot(t)).toEqual(before)
  await t.run(async ctx => {
    const balance = (await ctx.db.query('billingAccountBalances').first())!
    await ctx.db.patch(balance._id, { reservedMicros: 0, usedMicros: 30_000 })
  })
  await t.mutation(processEvent, { event: paid('evt-renewal', start + month) })
  const after = await snapshot(t)
  expect(after.balance).toMatchObject({ includedMicros: 8_000_000, usedMicros: 0, reservedMicros: 0 })
  expect(after.subscription?.paidPeriodStart).toBe((start + month) * 1000)
  await t.mutation(processEvent, { event: paid('evt-old-period', start, start + month + 100) })
  expect((await snapshot(t)).balance).toEqual(after.balance)
  expect((await snapshot(t)).subscription).toEqual(after.subscription)
})

test('late payment cannot resurrect a canceled subscription or restore unused credit', async () => {
  const t = await fixture()
  await t.mutation(processEvent, { event: paid('evt-funded') })
  await t.mutation(processEvent, { event: lifecycle('evt-canceled', start, 'canceled', start + 20) })
  const canceled = await snapshot(t)
  expect(canceled.balance?.includedMicros).toBe(0)
  await t.mutation(processEvent, { event: paid('evt-late-paid', start, start + 40) })
  const after = await snapshot(t)
  expect(after.subscription?.status).toBe('canceled')
  expect(after.balance).toEqual(canceled.balance)
})

test('unpaid and foreign-product invoices never grant funding', async () => {
  const t = await fixture()
  const unpaid = paid('evt-unpaid'); unpaid.data.object.amount_paid = 0
  await t.mutation(processEvent, { event: unpaid })
  const foreign = paid('evt-foreign'); foreign.data.object.lines.data[0]!.pricing.price_details.price = 'wrong-price'
  await t.mutation(processEvent, { event: foreign })
  expect((await snapshot(t)).balance).toBeNull()
})

test('payment evidence must match the current subscription amount', async () => {
  const t = await fixture()
  await t.mutation(processEvent, { event: lifecycle('evt-created') })
  const before = await snapshot(t)
  expect(await t.mutation(fund, {
    billingAccountId: 'ba-paid', stripeCustomerId: 'cus-paid', stripeSubscriptionId: 'sub-paid',
    paidInvoiceId: 'in-wrong-quantity', paidPeriodStart: start * 1000,
    paidPeriodEnd: (start + month) * 1000, amountCents: 900,
  })).toEqual({ applied: false })
  expect(await snapshot(t)).toEqual(before)
})

test('first payment proof cannot overwrite a different existing credit allocation', async () => {
  const t = await fixture()
  await t.mutation(processEvent, { event: lifecycle('evt-created') })
  await t.run(async ctx => {
    const balance = (await ctx.db.query('billingAccountBalances').first())!
    await ctx.db.patch(balance._id, { includedMicros: 10_000_000 })
  })
  const before = await snapshot(t)
  await expect(t.mutation(processEvent, { event: paid('evt-proof') })).rejects.toThrow('paid_period_requires_balance_reconciliation')
  expect(await snapshot(t)).toEqual(before)
})
