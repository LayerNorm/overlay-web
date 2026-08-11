import Stripe from 'stripe'
import {
  callConvex,
  getInternalApiSecret,
  loadLocalEnv,
  readArg,
  type DeploymentTarget,
} from './convex-admin-utils.ts'
import {
  verifyStripeSubscriptionsExactly,
  type BillingSubscriptionVerificationRow,
  type StripeSubscriptionVerificationRow,
} from '../src/shared/billing/billing-account-migration.ts'

loadLocalEnv()

function targetFromArgs(): DeploymentTarget {
  const target = readArg('target', 'dev')?.toLowerCase()
  if (target !== 'dev' && target !== 'prod') throw new Error('target must be dev or prod')
  if (target === 'prod' && readArg('allow-prod') !== 'true') {
    throw new Error('Production Stripe verification requires --allow-prod=true')
  }
  return target
}

function stripeKey(target: DeploymentTarget): string {
  const key = target === 'dev'
    ? process.env.DEV_STRIPE_SECRET_KEY?.trim()
    : process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) throw new Error(target === 'dev' ? 'Missing DEV_STRIPE_SECRET_KEY' : 'Missing STRIPE_SECRET_KEY')
  if (target === 'dev' && !key.startsWith('sk_test_')) throw new Error('Dev verification requires an sk_test_ key')
  if (target === 'prod' && !key.startsWith('sk_live_')) throw new Error('Prod verification requires an sk_live_ key')
  return key
}

async function listStripeSubscriptions(stripe: Stripe): Promise<StripeSubscriptionVerificationRow[]> {
  const rows: StripeSubscriptionVerificationRow[] = []
  let startingAfter: string | undefined
  do {
    const page = await stripe.subscriptions.list({
      limit: 100,
      status: 'all',
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const subscription of page.data) {
      const item = subscription.items.data[0]
      const quantity = item?.quantity ?? undefined
      const unitAmount = item?.price.unit_amount ?? undefined
      rows.push({
        ...(unitAmount === undefined || quantity === undefined
          ? {}
          : { planAmountCents: unitAmount * quantity }),
        providerCustomerId: typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id,
        ...(item?.price.id ? { providerPriceId: item.price.id } : {}),
        ...(quantity === undefined ? {} : { providerQuantity: quantity }),
        providerSubscriptionId: subscription.id,
        status: subscription.status,
      })
    }
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined
  } while (startingAfter)
  return rows
}

async function main(): Promise<void> {
  const target = targetFromArgs()
  const expectedActiveSubscriptions = Number(readArg('expected-active', '6'))
  if (!Number.isInteger(expectedActiveSubscriptions) || expectedActiveSubscriptions < 0) {
    throw new Error('expected-active must be a non-negative integer')
  }
  const local = await callConvex<BillingSubscriptionVerificationRow[]>(
    target,
    'query',
    'billing/accountMigration:listSubscriptionVerificationRowsByServer',
    { limit: 500, serverSecret: getInternalApiSecret() },
  )
  const stripe = await listStripeSubscriptions(new Stripe(stripeKey(target)))
  const report = verifyStripeSubscriptionsExactly({ expectedActiveSubscriptions, local, stripe })
  console.log(JSON.stringify({ ...report, target }, null, 2))
  if (!report.ok) throw new Error('Stripe subscription verification failed')
}

void main().catch((error) => {
  console.error('[stripe-personal-account-verification] Failed:', error)
  process.exitCode = 1
})
