import assert from 'node:assert/strict'
import test from 'node:test'
import { paidInvoiceFunding, type PaidInvoice } from './paid-invoice'

const expected = { customerId: 'cus_paid', subscriptionId: 'sub_paid', priceId: 'price_unit' }
function invoice(): PaidInvoice {
  return {
    id: 'in_paid', status: 'paid', currency: 'usd', amount_paid: 800, billing_reason: 'subscription_cycle',
    customer: expected.customerId, parent: { subscription_details: { subscription: expected.subscriptionId } },
    lines: { has_more: false, data: [{ quantity: 8, period: { start: 1000, end: 2000 },
      pricing: { price_details: { price: expected.priceId } }, parent: { subscription_item_details: { proration: false } } }] },
  }
}

test('only a fully paid recurring invoice yields funding evidence', () => {
  assert.deepEqual(paidInvoiceFunding(invoice(), expected), {
    paidInvoiceId: 'in_paid', paidPeriodStart: 1_000_000, paidPeriodEnd: 2_000_000, amountCents: 800, quantity: 8,
  })
  for (const change of [{ status: 'open' }, { amount_paid: 0 }, { amount_paid: 799 }, { currency: 'eur' }, { billing_reason: 'subscription_update' }]) {
    assert.equal(paidInvoiceFunding({ ...invoice(), ...change }, expected), null)
  }
})

test('foreign customer, subscription or product cannot fund the workspace', () => {
  for (const change of [{ customerId: 'foreign' }, { subscriptionId: 'foreign' }, { priceId: 'foreign' }]) {
    assert.equal(paidInvoiceFunding(invoice(), { ...expected, ...change }), null)
  }
})

test('partial, prorated and out-of-range invoices fail closed', () => {
  const partial = invoice(); partial.lines!.has_more = true
  assert.equal(paidInvoiceFunding(partial, expected), null)
  for (const quantity of [0, 1, 7.5, 501]) {
    const bad = invoice(); bad.lines!.data![0]!.quantity = quantity
    assert.equal(paidInvoiceFunding(bad, expected), null)
  }
  const prorated = invoice(); prorated.lines!.data![0]!.parent!.subscription_item_details!.proration = true
  assert.equal(paidInvoiceFunding(prorated, expected), null)
})

test('a configured historical fixed-price subscription can prove its existing paid allowance', () => {
  const legacy = invoice()
  legacy.amount_paid = 2000
  legacy.lines!.data![0]!.quantity = 1
  assert.equal(paidInvoiceFunding(legacy, { ...expected, unitAmountCents: 2000 })?.amountCents, 2000)
  assert.equal(paidInvoiceFunding(legacy, expected), null)
  assert.equal(paidInvoiceFunding(legacy, { ...expected, unitAmountCents: -2000 }), null)
})
