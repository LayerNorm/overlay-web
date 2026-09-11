import Stripe from 'stripe'
import {
  callConvex,
  getInternalApiSecret,
  loadLocalEnv,
  readArg,
  type DeploymentTarget,
} from '../lib/convex-admin-utils.ts'
import {
  legacyTierPlanAmountCents,
  planAmountCentsToQuantity,
} from '../../src/shared/billing/billing-pricing.ts'

loadLocalEnv()

type SubscriptionRow = {
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
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  currentPeriodStart?: number
  currentPeriodEnd?: number
  autoTopUpEnabled?: boolean
  autoTopUpAmountCents?: number
}

type AuditSource = 'dynamic' | 'legacy_pro' | 'legacy_max' | 'unknown'

type AuditRow = {
  subscriptionId: string
  customerId?: string
  email?: string
  userId?: string
  status: string
  currentPriceId?: string
  currentQuantity?: number
  targetAmountCents?: number
  targetQuantity?: number
  targetPriceId?: string
  currentPeriodStart?: number
  currentPeriodEnd?: number
  source: AuditSource
  convex?: SubscriptionRow | null
}

function resolveTarget(): DeploymentTarget {
  const raw = (readArg('target', 'prod') || 'prod').toLowerCase()
  return raw === 'dev' ? 'dev' : 'prod'
}

function resolveStripeSecretKey(target: DeploymentTarget): string {
  const value =
    target === 'prod'
      ? process.env.STRIPE_SECRET_KEY
      : process.env.DEV_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
  if (!value) {
    throw new Error(
      target === 'prod'
        ? 'Missing STRIPE_SECRET_KEY for prod audit.'
        : 'Missing DEV_STRIPE_SECRET_KEY or STRIPE_SECRET_KEY for dev audit.',
    )
  }
  return value
}

function resolveEnvValue(target: DeploymentTarget, primary: string, devKey: string): string | undefined {
  return target === 'prod' ? process.env[primary] : process.env[devKey] || process.env[primary]
}

function formatDate(value?: number): string {
  if (!value || !Number.isFinite(value)) return '-'
  return new Date(value).toISOString()
}

function formatAmount(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return `$${(value / 100).toFixed(2)}`
}

function classifyPriceId(params: {
  priceId?: string
  legacyProPriceId?: string
  legacyMaxPriceId?: string
  paidUnitPriceId?: string
}): AuditSource {
  if (params.priceId && params.paidUnitPriceId && params.priceId === params.paidUnitPriceId) return 'dynamic'
  if (params.priceId && params.legacyProPriceId && params.priceId === params.legacyProPriceId) return 'legacy_pro'
  if (params.priceId && params.legacyMaxPriceId && params.priceId === params.legacyMaxPriceId) return 'legacy_max'
  return 'unknown'
}

async function listSubscriptions(stripe: Stripe): Promise<Stripe.Subscription[]> {
  const out: Stripe.Subscription[] = []
  let startingAfter: string | undefined
  while (true) {
    const page = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      expand: ['data.customer'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    out.push(...page.data)
    if (!page.has_more || page.data.length === 0) break
    startingAfter = page.data[page.data.length - 1]?.id
  }
  return out
}

async function getConvexSubscription(target: DeploymentTarget, userId?: string): Promise<SubscriptionRow | null> {
  if (!userId) return null
  try {
    const serverSecret = getInternalApiSecret()
    return await callConvex<SubscriptionRow | null>(target, 'query', 'billing/subscriptions:getByUserIdByServer', {
      serverSecret,
      userId,
    })
  } catch (error) {
    console.warn(
      `[audit] Convex lookup skipped for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

function getCustomerEmail(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | undefined {
  if (!customer || typeof customer === 'string') return undefined
  if ('deleted' in customer && customer.deleted) return undefined
  return customer.email || undefined
}

async function main() {
  const target = resolveTarget()
  const stripe = new Stripe(resolveStripeSecretKey(target))

  const legacyProPriceId = resolveEnvValue(target, 'STRIPE_PRO_PRICE_ID', 'DEV_STRIPE_PRO_PRICE_ID')
  const legacyMaxPriceId = resolveEnvValue(target, 'STRIPE_MAX_PRICE_ID', 'DEV_STRIPE_MAX_PRICE_ID')
  const paidUnitPriceId = resolveEnvValue(target, 'STRIPE_PAID_UNIT_PRICE_ID', 'DEV_STRIPE_PAID_UNIT_PRICE_ID')

  console.log(`\nStripe dynamic pricing audit (${target})`)
  console.log(`paid unit price: ${paidUnitPriceId ?? 'missing'}`)
  console.log(`legacy pro price: ${legacyProPriceId ?? 'missing'}`)
  console.log(`legacy max price: ${legacyMaxPriceId ?? 'missing'}\n`)

  const subscriptions = await listSubscriptions(stripe)
  const relevant = subscriptions.filter((subscription) =>
    ['active', 'trialing', 'past_due'].includes(subscription.status),
  )

  const rows: AuditRow[] = []
  for (const subscription of relevant) {
    const item = subscription.items.data[0]
    const priceId = item?.price?.id
    const quantity = item?.quantity ?? undefined
    const source = classifyPriceId({ priceId, legacyProPriceId, legacyMaxPriceId, paidUnitPriceId })
    const targetAmountCents =
      source === 'legacy_pro'
        ? legacyTierPlanAmountCents('pro')
        : source === 'legacy_max'
          ? legacyTierPlanAmountCents('max')
          : source === 'dynamic' && quantity
            ? quantity * 100
            : undefined

    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id

    const currentPeriodStart =
      typeof item?.current_period_start === 'number'
        ? item.current_period_start * 1000
        : subscription.billing_cycle_anchor * 1000
    const currentPeriodEnd =
      typeof item?.current_period_end === 'number'
        ? item.current_period_end * 1000
        : undefined

    const row: AuditRow = {
      subscriptionId: subscription.id,
      customerId,
      email: getCustomerEmail(subscription.customer),
      userId: subscription.metadata?.userId?.trim() || undefined,
      status: subscription.status,
      currentPriceId: priceId,
      currentQuantity: quantity,
      targetAmountCents,
      targetQuantity: typeof targetAmountCents === 'number' ? planAmountCentsToQuantity(targetAmountCents) : undefined,
      targetPriceId: paidUnitPriceId,
      currentPeriodStart,
      currentPeriodEnd,
      source,
    }

    row.convex = await getConvexSubscription(target, row.userId)
    rows.push(row)
  }

  if (rows.length === 0) {
    console.log('No active, trialing, or past_due subscriptions found.')
    return
  }

  const legacyRows = rows.filter((row) => row.source === 'legacy_pro' || row.source === 'legacy_max')
  const dynamicRows = rows.filter((row) => row.source === 'dynamic')
  const unknownRows = rows.filter((row) => row.source === 'unknown')

  for (const row of rows) {
    console.log([
      `subscription=${row.subscriptionId}`,
      `status=${row.status}`,
      `source=${row.source}`,
      `userId=${row.userId ?? 'missing'}`,
      `email=${row.email ?? row.convex?.email ?? 'missing'}`,
      `price=${row.currentPriceId ?? 'missing'}`,
      `quantity=${row.currentQuantity ?? 'missing'}`,
      `targetPrice=${row.targetPriceId ?? 'missing'}`,
      `targetQuantity=${row.targetQuantity ?? 'n/a'}`,
      `periodStart=${formatDate(row.currentPeriodStart)}`,
      `periodEnd=${formatDate(row.currentPeriodEnd)}`,
      `convexPlan=${row.convex ? `${row.convex.planVersion ?? 'missing'}:${formatAmount(row.convex.planAmountCents)}` : 'unavailable'}`,
      `convexQuantity=${row.convex?.stripeQuantity ?? 'unavailable'}`,
      `autoTopUp=${row.convex?.autoTopUpEnabled ?? 'unavailable'}`,
    ].join(' | '))
  }

  console.log('\nSummary')
  console.log(`active-ish subscriptions: ${rows.length}`)
  console.log(`legacy subscriptions to cut over: ${legacyRows.length}`)
  console.log(`already dynamic: ${dynamicRows.length}`)
  console.log(`unknown price ids: ${unknownRows.length}`)

  if (legacyRows.length > 0) {
    console.log('\nLegacy subscriptions requiring manual cutover:')
    for (const row of legacyRows) {
      console.log(
        `- ${row.subscriptionId} userId=${row.userId ?? 'missing'} email=${row.email ?? row.convex?.email ?? 'missing'} currentPrice=${row.currentPriceId ?? 'missing'} targetPrice=${row.targetPriceId ?? 'missing'} targetQuantity=${row.targetQuantity ?? 'missing'}`,
      )
    }
  }

  if (unknownRows.length > 0) {
    console.log('\nUnknown price ids:')
    for (const row of unknownRows) {
      console.log(`- ${row.subscriptionId} price=${row.currentPriceId ?? 'missing'} userId=${row.userId ?? 'missing'}`)
    }
  }
}

void main().catch((error) => {
  console.error('[stripe-dynamic-pricing-audit] Failed:', error)
  process.exitCode = 1
})
