import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import {
  StripeBillingProvider,
  type StripeBillingClient,
} from '../packages/overlay-billing/src/index.ts'
import {
  PERSONAL_PLAN_CATALOG,
  planAmountCentsToQuantity,
} from '../src/shared/billing/billing-pricing.ts'
import { readArg } from './convex-admin-utils.ts'

function requiredTestValue(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function testStripeKey(): string {
  const key = requiredTestValue('DEV_STRIPE_SECRET_KEY')
  if (!key.startsWith('sk_test_')) {
    throw new Error('Stripe payment-revision QA refuses every non-test secret key')
  }
  return key
}

function portalIsSafe(configuration: Stripe.BillingPortal.Configuration): boolean {
  return configuration.features.payment_method_update.enabled
    && configuration.features.subscription_cancel.enabled
    && configuration.features.subscription_cancel.mode === 'at_period_end'
    && !configuration.features.subscription_update.enabled
}

async function ensureSafePortalConfiguration(
  stripe: Stripe,
  configurationId: string,
): Promise<Stripe.BillingPortal.Configuration> {
  let configuration = await stripe.billingPortal.configurations.retrieve(configurationId)
  if (portalIsSafe(configuration)) return configuration
  if (readArg('configure-portal', 'false') !== 'true') {
    throw new Error(
      'Test portal must enable payment recovery and at-period-end cancellation while disabling subscription updates. Rerun with --configure-portal=true to repair it.',
    )
  }
  configuration = await stripe.billingPortal.configurations.update(configurationId, {
    features: {
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none',
      },
      subscription_update: { enabled: false },
    },
  })
  assert.equal(portalIsSafe(configuration), true)
  return configuration
}

async function main(): Promise<void> {
  const stripe = new Stripe(testStripeKey())
  const priceId = requiredTestValue('DEV_STRIPE_PAID_UNIT_PRICE_ID')
  const portalConfigurationId = requiredTestValue('DEV_STRIPE_PORTAL_CONFIGURATION_ID')
  const qaRunId = `payment_revision_${randomUUID()}`
  const price = await stripe.prices.retrieve(priceId)
  const productId = typeof price.product === 'string' ? price.product : price.product.id
  const product = await stripe.products.retrieve(productId)

  assert.equal(price.livemode, false)
  assert.equal(price.active, true)
  assert.equal(price.currency, 'usd')
  assert.equal(price.unit_amount, 100)
  assert.equal(price.recurring?.interval, 'month')
  assert.equal(price.recurring?.interval_count, 1)
  assert.equal(product.livemode, false)
  assert.equal(product.active, true)

  const portalConfiguration = await ensureSafePortalConfiguration(stripe, portalConfigurationId)
  const checkoutSessionIds: string[] = []
  let customerId: string | undefined
  let subscriptionId: string | undefined
  let report: Record<string, unknown> | undefined

  const provider = new StripeBillingProvider({
    stripe: stripe as unknown as StripeBillingClient,
    baseUrl: 'https://qa.getoverlay.io',
    paidPlanPriceId: priceId,
    integrationIdentifier: () => `payment_revision_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
    normalizePlanAmountCents: (value) => value,
    normalizeTopUpAmountCents: (value) => value,
    planQuantityForAmountCents: planAmountCentsToQuantity,
  })

  try {
    const checkoutResults: Array<{ planId: string; quantity: number; sessionId: string }> = []
    for (const plan of PERSONAL_PLAN_CATALOG.filter((candidate) => candidate.id !== 'free')) {
      const checkout = await provider.createCheckoutSession({
        userId: `qa_${qaRunId}`,
        kind: 'paid_plan',
        planId: plan.id,
        planAmountCents: plan.amountCents,
        topUpAmountCents: 800,
        metadata: { qaRunId },
      })
      assert.ok(checkout.providerSessionId)
      checkoutSessionIds.push(checkout.providerSessionId)
      const session = await stripe.checkout.sessions.retrieve(checkout.providerSessionId, {
        expand: ['line_items'],
      })
      const lineItem = session.line_items?.data[0]
      assert.equal(lineItem?.price?.id, priceId)
      assert.equal(lineItem?.quantity, plan.stripeQuantity)
      assert.equal(session.metadata?.planId, plan.id)
      assert.equal(session.metadata?.stripeQuantity, String(plan.stripeQuantity))
      checkoutResults.push({
        planId: plan.id,
        quantity: plan.stripeQuantity,
        sessionId: session.id,
      })
    }

    const customer = await stripe.customers.create({ metadata: { qaRunId } })
    customerId = customer.id
    const portalSession = await stripe.billingPortal.sessions.create({
      configuration: portalConfiguration.id,
      customer: customer.id,
      return_url: 'https://qa.getoverlay.io/account',
    })
    assert.match(portalSession.url, /^https:\/\/billing\.stripe\.com\//)

    const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', {
      customer: customer.id,
    })
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    })
    const legacySubscription = await stripe.subscriptions.create({
      customer: customer.id,
      default_payment_method: paymentMethod.id,
      items: [{ price: priceId, quantity: 15 }],
      metadata: { planAmountCents: '1500', planVersion: 'variable_v2', qaRunId },
      payment_behavior: 'error_if_incomplete',
    })
    subscriptionId = legacySubscription.id
    const item = legacySubscription.items.data[0]
    assert.equal(legacySubscription.status, 'active')
    assert.equal(item?.quantity, 15)
    assert.ok(item)

    const prorationDate = Math.floor(Date.now() / 1000)
    const upgradePreview = await stripe.invoices.createPreview({
      customer: customer.id,
      subscription: legacySubscription.id,
      subscription_details: {
        items: [{ id: item.id, quantity: 24 }],
        proration_behavior: 'always_invoice',
        proration_date: prorationDate,
      },
    })
    const upgradeProrationCents = upgradePreview.lines.data
      .filter((line) => line.parent?.subscription_item_details?.proration === true)
      .reduce((total, line) => total + line.amount, 0)
    assert.ok(upgradeProrationCents > 0)

    const declinedPaymentMethod = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', {
      customer: customer.id,
    })
    await stripe.subscriptions.update(legacySubscription.id, {
      default_payment_method: declinedPaymentMethod.id,
    })
    let failedPaymentOutcome: 'declined' | 'pending_update'
    try {
      const failedUpgrade = await stripe.subscriptions.update(legacySubscription.id, {
        items: [{ id: item.id, quantity: 96 }],
        metadata: { planAmountCents: '9600', planVersion: 'named_v1', qaRunId },
        payment_behavior: 'pending_if_incomplete',
        proration_behavior: 'always_invoice',
      })
      assert.ok(failedUpgrade.pending_update)
      failedPaymentOutcome = 'pending_update'
    } catch (error) {
      const stripeError = error as { code?: string; decline_code?: string }
      assert.ok(stripeError.code === 'card_declined' || stripeError.decline_code)
      failedPaymentOutcome = 'declined'
    }
    const afterFailedUpgrade = await stripe.subscriptions.retrieve(legacySubscription.id)
    assert.equal(afterFailedUpgrade.items.data[0]?.quantity, 15)

    report = {
      checkout: checkoutResults,
      cleanup: 'completed',
      failedPayment: {
        entitlementQuantityAfterFailure: afterFailedUpgrade.items.data[0]?.quantity,
        outcome: failedPaymentOutcome,
        requestedQuantity: 96,
      },
      legacy: { amountCents: 1500, display: 'Legacy $15', quantity: 15 },
      portal: {
        cancellation: portalConfiguration.features.subscription_cancel.mode,
        paymentRecovery: portalConfiguration.features.payment_method_update.enabled,
        subscriptionUpdates: portalConfiguration.features.subscription_update.enabled,
      },
      price: {
        currency: price.currency,
        id: price.id,
        interval: price.recurring?.interval,
        livemode: price.livemode,
        productId,
        unitAmountCents: price.unit_amount,
      },
      previews: {
        downgrade: { effective: 'period_end', fromQuantity: 15, prorationCents: 0, toQuantity: 8 },
        upgrade: { effective: 'immediate_after_payment', fromQuantity: 15, prorationCents: upgradeProrationCents, toQuantity: 24 },
      },
      qaRunId,
    }
  } finally {
    for (const sessionId of checkoutSessionIds) {
      await stripe.checkout.sessions.expire(sessionId)
    }
    if (subscriptionId) {
      await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false })
    }
    if (customerId) {
      const deleted = await stripe.customers.del(customerId)
      assert.equal(deleted.deleted, true)
    }
  }
  assert.ok(report)
  console.log(JSON.stringify(report, null, 2))
}

void main().catch((error) => {
  console.error('[stripe-payment-revision-qa] Failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
