export type BillingBalanceSnapshot = {
  allowanceUsedMicros: number
  billingAccountId: string
  includedMicros: number
  institutionalGrantMicros: number
  mode: 'unlimited' | 'budgeted'
  reservedMicros: number
  topUpBalanceMicros: number
  topUpPurchasedMicros: number
  usedMicros: number
}

export type BillingBalanceParityReport = {
  billingAccountId: string
  differences: string[]
  legacy: BillingBalanceSnapshot
  canonical: BillingBalanceSnapshot
  matches: boolean
  userId: string
}

export type BillingSubscriptionVerificationRow = {
  billingAccountId?: string
  planAmountCents: number
  providerCustomerId?: string
  providerPriceId?: string
  providerQuantity?: number
  providerSubscriptionId?: string
  status: 'active' | 'canceled' | 'past_due' | 'trialing'
  userId: string
}

export type StripeSubscriptionVerificationRow = {
  planAmountCents?: number
  providerCustomerId: string
  providerPriceId?: string
  providerQuantity?: number
  providerSubscriptionId: string
  status: string
}

export type StripeSubscriptionVerificationReport = {
  expectedActiveSubscriptions: number
  issues: string[]
  localActiveSubscriptions: number
  matchedSubscriptions: number
  ok: boolean
  stripeActiveSubscriptions: number
}

const BALANCE_FIELDS = [
  'allowanceUsedMicros',
  'includedMicros',
  'institutionalGrantMicros',
  'reservedMicros',
  'topUpBalanceMicros',
  'topUpPurchasedMicros',
  'usedMicros',
] as const

export function compareBillingBalanceSnapshots(args: {
  canonical: BillingBalanceSnapshot
  legacy: BillingBalanceSnapshot
  userId: string
}): BillingBalanceParityReport {
  const differences: string[] = []
  if (args.canonical.billingAccountId !== args.legacy.billingAccountId) {
    differences.push('billingAccountId')
  }
  if (args.canonical.mode !== args.legacy.mode) differences.push('mode')
  for (const field of BALANCE_FIELDS) {
    if (args.canonical[field] !== args.legacy[field]) differences.push(field)
  }
  return {
    billingAccountId: args.legacy.billingAccountId,
    canonical: args.canonical,
    differences,
    legacy: args.legacy,
    matches: differences.length === 0,
    userId: args.userId,
  }
}

export function verifyStripeSubscriptionsExactly(args: {
  expectedActiveSubscriptions: number
  local: BillingSubscriptionVerificationRow[]
  stripe: StripeSubscriptionVerificationRow[]
}): StripeSubscriptionVerificationReport {
  const activeStatuses = new Set(['active', 'past_due', 'trialing'])
  const local = args.local.filter((row) => activeStatuses.has(row.status))
  const stripe = args.stripe.filter((row) => activeStatuses.has(row.status))
  const issues: string[] = []
  if (local.length !== args.expectedActiveSubscriptions) {
    issues.push(`local_active_count:${local.length}`)
  }
  if (stripe.length !== args.expectedActiveSubscriptions) {
    issues.push(`stripe_active_count:${stripe.length}`)
  }

  const localBySubscription = new Map<string, BillingSubscriptionVerificationRow>()
  for (const row of local) {
    if (!row.billingAccountId) issues.push(`missing_billing_account:${row.userId}`)
    if (!row.providerSubscriptionId) {
      issues.push(`missing_provider_subscription:${row.userId}`)
      continue
    }
    if (localBySubscription.has(row.providerSubscriptionId)) {
      issues.push(`duplicate_provider_subscription:${row.providerSubscriptionId}`)
    }
    localBySubscription.set(row.providerSubscriptionId, row)
  }

  let matchedSubscriptions = 0
  for (const stripeRow of stripe) {
    const localRow = localBySubscription.get(stripeRow.providerSubscriptionId)
    if (!localRow) {
      issues.push(`stripe_subscription_missing_locally:${stripeRow.providerSubscriptionId}`)
      continue
    }
    const mismatches: string[] = []
    if (localRow.providerCustomerId !== stripeRow.providerCustomerId) mismatches.push('customer')
    if (localRow.providerPriceId !== stripeRow.providerPriceId) mismatches.push('price')
    if (localRow.providerQuantity !== stripeRow.providerQuantity) mismatches.push('quantity')
    if (
      stripeRow.planAmountCents !== undefined &&
      localRow.planAmountCents !== stripeRow.planAmountCents
    ) mismatches.push('amount')
    if (localRow.status !== stripeRow.status) mismatches.push('status')
    if (mismatches.length > 0) {
      issues.push(`subscription_mismatch:${stripeRow.providerSubscriptionId}:${mismatches.join(',')}`)
    } else {
      matchedSubscriptions += 1
    }
  }

  const stripeIds = new Set(stripe.map((row) => row.providerSubscriptionId))
  for (const row of local) {
    if (row.providerSubscriptionId && !stripeIds.has(row.providerSubscriptionId)) {
      issues.push(`local_subscription_missing_in_stripe:${row.providerSubscriptionId}`)
    }
  }

  return {
    expectedActiveSubscriptions: args.expectedActiveSubscriptions,
    issues,
    localActiveSubscriptions: local.length,
    matchedSubscriptions,
    ok: issues.length === 0 && matchedSubscriptions === args.expectedActiveSubscriptions,
    stripeActiveSubscriptions: stripe.length,
  }
}
