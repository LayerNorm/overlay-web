import Stripe from 'stripe'
import {
  callConvex,
  getInternalApiSecret,
  loadLocalEnv,
  readArg,
} from '../lib/convex-admin-utils.ts'
import {
  DEFAULT_MARKUP_BASIS_POINTS,
  derivePlanAmountCents,
  derivePlanKind,
  legacyTierPlanAmountCents,
  planAmountCentsToQuantity,
} from '../../src/shared/billing/billing-pricing.ts'

loadLocalEnv()

type SubscriptionRow = {
  _id: string
  userId: string
  email?: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  stripePriceId?: string
  stripeQuantity?: number
  tier?: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  planVersion?: 'fixed_v1' | 'variable_v2'
  planAmountCents?: number
  markupBasisPoints?: number
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  currentPeriodStart?: number
  currentPeriodEnd?: number
}

function resolveStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY || process.env.DEV_STRIPE_SECRET_KEY
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY or DEV_STRIPE_SECRET_KEY')
  if (!key.startsWith('sk_test_')) throw new Error('Refusing to run against a non-test Stripe key.')
  return key
}

async function listSandboxSubscriptions(stripe: Stripe) {
  const rows: Stripe.Subscription[] = []
  let startingAfter: string | undefined
  while (true) {
    const page = await stripe.subscriptions.list({
      limit: 100,
      status: 'all',
      expand: ['data.customer'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    rows.push(...page.data)
    if (!page.has_more || page.data.length === 0) break
    startingAfter = page.data[page.data.length - 1]?.id
  }
  return rows
}

async function main() {
  const apply = readArg('apply') === 'true'
  const serverSecret = getInternalApiSecret()
  const convexRows = await callConvex<SubscriptionRow[]>('dev', 'query', 'billing/subscriptions:listAllByServer', {
    serverSecret,
  })

  let stripeSubscriptions: Stripe.Subscription[] = []
  try {
    const stripe = new Stripe(resolveStripeSecretKey())
    stripeSubscriptions = await listSandboxSubscriptions(stripe)
  } catch (error) {
    console.warn('[variable-pricing-migration] Stripe inspection skipped:', error instanceof Error ? error.message : String(error))
  }

  const legacyProPriceId = process.env.STRIPE_PRO_PRICE_ID || process.env.DEV_STRIPE_PRO_PRICE_ID
  const legacyMaxPriceId = process.env.STRIPE_MAX_PRICE_ID || process.env.DEV_STRIPE_MAX_PRICE_ID
  const paidUnitPriceId = process.env.STRIPE_PAID_UNIT_PRICE_ID || process.env.DEV_STRIPE_PAID_UNIT_PRICE_ID

  console.log(`\nConvex dev subscriptions: ${convexRows.length}`)
  console.log(`Stripe sandbox subscriptions: ${stripeSubscriptions.length}\n`)

  for (const row of convexRows) {
    const derivedPlanKind = derivePlanKind(row)
    const derivedPlanAmountCents = derivePlanAmountCents(row)
    const targetQuantity = derivedPlanKind === 'paid' ? planAmountCentsToQuantity(derivedPlanAmountCents) : 0

    console.log(
      [
        row.userId,
        row.email || 'no-email',
        `tier=${row.tier ?? 'unknown'}`,
        `planVersion=${row.planVersion ?? 'missing'}`,
        `planKind=${row.planKind ?? derivedPlanKind}`,
        `planAmount=${derivedPlanAmountCents}`,
        `targetQuantity=${targetQuantity}`,
      ].join(' | '),
    )

    if (!apply) continue

    await callConvex<string>('dev', 'mutation', 'billing/subscriptions:upsertSubscription', {
      serverSecret,
      userId: row.userId,
      email: row.email,
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      stripePriceId: row.stripePriceId,
      stripeQuantity: derivedPlanKind === 'paid' ? targetQuantity : undefined,
      tier: row.tier ?? (derivedPlanKind === 'free' ? 'free' : 'pro'),
      planKind: derivedPlanKind,
      planVersion:
        row.stripePriceId && paidUnitPriceId && row.stripePriceId === paidUnitPriceId
          ? 'variable_v2'
          : derivedPlanKind === 'free'
            ? 'variable_v2'
            : (row.planVersion ?? 'fixed_v1'),
      planAmountCents: derivedPlanAmountCents,
      markupBasisPoints: row.markupBasisPoints ?? DEFAULT_MARKUP_BASIS_POINTS,
      status: row.status ?? 'active',
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
      autoTopUpEnabled: false,
    })
  }

  console.log('\nLegacy Stripe migration preview:\n')
  for (const subscription of stripeSubscriptions) {
    const firstItem = subscription.items.data[0]
    const priceId = firstItem?.price?.id
    const quantity = firstItem?.quantity ?? 1
    const customer =
      subscription.customer && typeof subscription.customer !== 'string' && !('deleted' in subscription.customer)
        ? subscription.customer
        : null

    let legacyAmountCents = 0
    if (priceId === legacyProPriceId) legacyAmountCents = legacyTierPlanAmountCents('pro')
    if (priceId === legacyMaxPriceId) legacyAmountCents = legacyTierPlanAmountCents('max')

    if (!legacyAmountCents) continue

    console.log(
      [
        subscription.id,
        customer?.email || 'no-email',
        `legacyPrice=${priceId}`,
        `legacyAmount=${legacyAmountCents}`,
        `renewalQuantity=${planAmountCentsToQuantity(legacyAmountCents)}`,
        `targetPaidPrice=${paidUnitPriceId ?? 'missing'}`,
        `currentQuantity=${quantity}`,
      ].join(' | '),
    )
  }
}

void main().catch((error) => {
  console.error('[variable-pricing-migration] Failed:', error)
  process.exitCode = 1
})
