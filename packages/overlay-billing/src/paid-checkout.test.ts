import assert from 'node:assert/strict'
import test from 'node:test'
import { StripeBillingProvider, type StripeCheckoutSession, type StripeSubscription } from './adapters/stripe-billing-provider'
import type { PaidInvoice } from './paid-invoice'

function fixture() {
  const invoice: PaidInvoice = { id: 'in_paid', status: 'paid', currency: 'usd', amount_paid: 800, billing_reason: 'subscription_create',
    customer: 'cus_paid', parent: { subscription_details: { subscription: 'sub_paid' } },
    lines: { has_more: false, data: [{ quantity: 8, period: { start: 1000, end: 2000 }, pricing: { price_details: { price: 'price_paid' } },
      parent: { subscription_item_details: { proration: false } } }] } }
  const subscription: StripeSubscription = { id: 'sub_paid', status: 'active', customer: 'cus_paid', latest_invoice: invoice,
    items: { data: [{ price: { id: 'price_paid' }, quantity: 8, current_period_start: 1000, current_period_end: 2000 }] } }
  const session: StripeCheckoutSession = { id: 'cs_paid', url: null, status: 'complete', payment_status: 'paid', mode: 'subscription', customer: 'cus_paid', subscription,
    metadata: { kind: 'paid_plan', billingAccountId: 'ba_paid', workspaceId: 'ws_paid', userId: 'original_admin' } }
  const provider = new StripeBillingProvider({ stripe: {
    checkout: { sessions: { async create() { return session }, async retrieve(_id, options) {
      assert.deepEqual(options?.expand, ['subscription.latest_invoice'])
      return session
    } } }, billingPortal: { sessions: { async create() { return { id: 'portal', url: 'https://stripe.test/portal' } } } },
  }, baseUrl: 'https://overlay.test', paidPlanPriceId: 'price_paid', normalizePlanAmountCents: value => value })
  const verify = () => provider.verifyCheckoutSession({ sessionId: 'cs_paid', kind: 'paid_plan', billingAccountId: 'ba_paid', workspaceId: 'ws_paid', userId: 'another_admin' })
  return { session, subscription, invoice, verify }
}

test('checkout verification binds a complete paid invoice to this workspace subscription and period', async () => {
  const result = await fixture().verify()
  assert.equal(result.planAmountCents, 800)
  assert.equal(result.paidInvoiceId, 'in_paid')
  assert.equal(result.paidPeriodStart, 1_000_000)
  assert.equal(result.paidPeriodEnd, 2_000_000)
})

test('success URLs, trialing status and paid-looking metadata are insufficient without funded evidence', async () => {
  const pending = fixture(); pending.session.payment_status = 'unpaid'
  await assert.rejects(pending.verify(), /Payment not completed/)
  const trial = fixture(); trial.subscription.status = 'trialing'
  await assert.rejects(trial.verify(), /not active/)
  const missing = fixture(); missing.subscription.latest_invoice = 'in_unexpanded'
  await assert.rejects(missing.verify(), /invoice has not been confirmed/)
  const unpaid = fixture(); unpaid.invoice.amount_paid = 0
  await assert.rejects(unpaid.verify(), /invoice has not been confirmed/)
  const stale = fixture(); stale.subscription.items!.data![0]!.current_period_start = 2000
  await assert.rejects(stale.verify(), /period is not funded/)
})

test('a foreign workspace, customer, subscription or price cannot activate billing', async () => {
  const foreignWorkspace = fixture(); foreignWorkspace.session.metadata!.workspaceId = 'other_workspace'
  await assert.rejects(foreignWorkspace.verify(), /Session mismatch/)
  const foreignCustomer = fixture(); foreignCustomer.invoice.customer = 'other_customer'
  await assert.rejects(foreignCustomer.verify(), /invoice has not been confirmed/)
  const foreignSubscription = fixture(); foreignSubscription.invoice.parent!.subscription_details!.subscription = 'other_sub'
  await assert.rejects(foreignSubscription.verify(), /invoice has not been confirmed/)
  const foreignPrice = fixture(); foreignPrice.subscription.items!.data![0]!.price!.id = 'other_price'
  await assert.rejects(foreignPrice.verify(), /Unexpected subscription price/)
})
