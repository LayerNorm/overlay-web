import type Stripe from 'stripe'
import { quantityToPlanAmountCents } from '../../../src/shared/billing/billing-pricing'

function resolveStripeEnvValue(primary: string, devKey: string): string | undefined {
  if (process.env.VERCEL_ENV === 'production') {
    return process.env[primary]
  }
  if (process.env.NODE_ENV === 'development') {
    return process.env[devKey] || process.env[primary]
  }
  return process.env[devKey] || process.env[primary]
}

export function getSubscriptionPeriodMs(subscription: Stripe.Subscription): {
  currentPeriodStart: number
  currentPeriodEnd: number
} {
  const now = Date.now()
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const firstItem = subscription.items.data[0]

  const itemPeriodStart = firstItem?.current_period_start
  const itemPeriodEnd = firstItem?.current_period_end

  return {
    currentPeriodStart:
      typeof itemPeriodStart === 'number' && itemPeriodStart > 0
        ? itemPeriodStart * 1000
        : subscription.billing_cycle_anchor * 1000 || now,
    currentPeriodEnd:
      typeof itemPeriodEnd === 'number' && itemPeriodEnd > 0
        ? itemPeriodEnd * 1000
        : now + thirtyDays,
  }
}

export function mapPriceToTier(priceId?: string): 'free' | 'pro' | 'max' {
  const proPriceId = resolveStripeEnvValue('STRIPE_PRO_PRICE_ID', 'DEV_STRIPE_PRO_PRICE_ID')
  const maxPriceId = resolveStripeEnvValue('STRIPE_MAX_PRICE_ID', 'DEV_STRIPE_MAX_PRICE_ID')
  const paidUnitPriceId = resolveStripeEnvValue('STRIPE_PAID_UNIT_PRICE_ID', 'DEV_STRIPE_PAID_UNIT_PRICE_ID')

  console.log(`[Stripe] mapPriceToTier: priceId=${priceId}, proPriceId=${proPriceId}, maxPriceId=${maxPriceId}, paidUnitPriceId=${paidUnitPriceId}`)

  if (priceId === paidUnitPriceId) return 'pro'
  if (priceId === proPriceId) return 'pro'
  if (priceId === maxPriceId) return 'max'

  throw new Error(`[Stripe] Unknown price ID: ${priceId ?? '(undefined)'}. Add it to STRIPE_*_PRICE_ID env vars or audit the webhook.`)
}

export function extractCustomerInfo(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): { email?: string; name?: string } {
  if (!customer || typeof customer === 'string') {
    return {}
  }

  if ('deleted' in customer && customer.deleted) {
    return {}
  }

  return {
    email: customer.email || undefined,
    name: customer.name || undefined,
  }
}

export function extractPlanFromSubscription(subscription: Stripe.Subscription): {
  tier: 'free' | 'pro' | 'max'
  planKind: 'free' | 'paid'
  planVersion: 'fixed_v1' | 'variable_v2'
  planAmountCents: number
  stripePriceId?: string
  stripeQuantity?: number
} {
  const firstItem = subscription.items.data[0]
  const priceId = firstItem?.price?.id
  const quantity = firstItem?.quantity ?? 1
  const paidUnitPriceId = resolveStripeEnvValue('STRIPE_PAID_UNIT_PRICE_ID', 'DEV_STRIPE_PAID_UNIT_PRICE_ID')

  if (priceId && paidUnitPriceId && priceId === paidUnitPriceId) {
    return {
      tier: 'pro',
      planKind: 'paid',
      planVersion: 'variable_v2',
      planAmountCents: quantityToPlanAmountCents(quantity),
      stripePriceId: priceId,
      stripeQuantity: quantity,
    }
  }

  const tier = mapPriceToTier(priceId)
  return {
    tier,
    planKind: tier === 'free' ? 'free' : 'paid',
    planVersion: tier === 'free' ? 'variable_v2' : 'fixed_v1',
    planAmountCents: tier === 'max' ? 10_000 : tier === 'pro' ? 2_000 : 0,
    stripePriceId: priceId,
    stripeQuantity: quantity,
  }
}

export function mapSubscriptionStatus(
  status: string
): 'active' | 'canceled' | 'past_due' | 'trialing' {
  switch (status) {
    case 'active':
      return 'active'
    case 'canceled':
    case 'unpaid':
      return 'canceled'
    case 'past_due':
      return 'past_due'
    case 'trialing':
      return 'trialing'
    default:
      return 'active'
  }
}
