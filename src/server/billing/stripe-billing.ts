import 'server-only'

import { stripe } from '@/server/billing/stripe'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import { decideAutoTopUp } from '@/shared/billing/auto-top-up'
import {
  PAID_PLAN_UNIT_AMOUNT_CENTS,
  TOP_UP_MAX_AMOUNT_CENTS,
  TOP_UP_MIN_AMOUNT_CENTS,
  TOP_UP_STEP_AMOUNT_CENTS,
  isValidTopUpAmount,
  planAmountCentsToQuantity,
  topUpAmountCentsToQuantity,
} from '@/shared/billing/billing-pricing'

type SubscriptionBillingState = {
  userId: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  stripePriceId?: string
  currentPeriodStart?: number
  currentPeriodEnd?: number
  autoTopUpEnabled?: boolean
  autoTopUpAmountCents?: number
  offSessionConsentAt?: number
}

const AUTO_TOP_UP_IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000

function resolveStripeEnvValue(primary: string, devKey: string): string | undefined {
  if (process.env.VERCEL_ENV === 'production') {
    return process.env[primary]
  }
  if (process.env.NODE_ENV === 'development') {
    return process.env[devKey] || process.env[primary]
  }
  return process.env[devKey] || process.env[primary]
}

export function resolvePaidUnitPriceId(): string | undefined {
  return resolveStripeEnvValue('STRIPE_PAID_UNIT_PRICE_ID', 'DEV_STRIPE_PAID_UNIT_PRICE_ID')
}

export function resolvePortalConfigurationId(): string | undefined {
  return resolveStripeEnvValue('STRIPE_PORTAL_CONFIGURATION_ID', 'DEV_STRIPE_PORTAL_CONFIGURATION_ID')
}

export function resolveTopUpUnitPriceId(): string | undefined {
  return resolveStripeEnvValue('STRIPE_TOPUP_UNIT_PRICE_ID', 'DEV_STRIPE_TOPUP_UNIT_PRICE_ID')
}

export function getDynamicTopUpConfig() {
  return {
    minAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
    maxAmountCents: TOP_UP_MAX_AMOUNT_CENTS,
    stepAmountCents: TOP_UP_STEP_AMOUNT_CENTS,
    defaultAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
  } as const
}

export function getTopUpPriceId(): string | undefined {
  return resolveTopUpUnitPriceId()
}

export function getTopUpQuantityForCheckout(amountCents: number): number {
  return topUpAmountCentsToQuantity(amountCents)
}

export function getPlanQuantityForCheckout(planAmountCents: number): number {
  return planAmountCentsToQuantity(planAmountCents)
}

async function getBillingState(
  repository: BillingRepository,
  userId: string,
): Promise<SubscriptionBillingState | null> {
  const state = await repository.getSubscriptionByUserIdByServer({ userId })
  return state ? { ...state, userId } : null
}

function normalizeStripePaymentMethodId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

export function isStripeMissingResourceError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  const message = error instanceof Error ? error.message : String(error ?? '')
  return code === 'resource_missing' || /no such (subscription|customer|payment[_ ]method)/i.test(message)
}

async function resolveDefaultPaymentMethodId(state: SubscriptionBillingState): Promise<string | null> {
  if (state.stripeSubscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(state.stripeSubscriptionId)
      const fromSubscription = normalizeStripePaymentMethodId(subscription.default_payment_method)
      if (fromSubscription) return fromSubscription
    } catch (error) {
      if (!isStripeMissingResourceError(error)) throw error
    }
  }
  if (!state.stripeCustomerId) return null
  try {
    const customer = await stripe.customers.retrieve(state.stripeCustomerId)
    if (!customer || typeof customer === 'string' || ('deleted' in customer && customer.deleted)) {
      return null
    }
    return normalizeStripePaymentMethodId(customer.invoice_settings?.default_payment_method)
  } catch (error) {
    if (isStripeMissingResourceError(error)) return null
    throw error
  }
}

export async function maybeAutoTopUpBudget(params: {
  userId: string
  minimumRequiredCents?: number
}, repository: BillingRepository) {
  const state = await getBillingState(repository, params.userId)
  if (!state) return { applied: false as const, reason: 'missing_subscription' }
  if (!state.autoTopUpEnabled) return { applied: false as const, reason: 'disabled' }
  if (!state.offSessionConsentAt) return { applied: false as const, reason: 'missing_consent' }
  if (!state.stripeCustomerId) return { applied: false as const, reason: 'missing_customer' }

  const amountCents = Math.max(0, Math.round(state.autoTopUpAmountCents ?? 0))
  const minimumRequiredCents = Math.max(1, Math.round(params.minimumRequiredCents ?? 1))
  if (amountCents < minimumRequiredCents) {
    return { applied: false as const, reason: 'amount_too_small' }
  }

  try {
    const paymentMethodId = await resolveDefaultPaymentMethodId(state)
    if (!paymentMethodId) {
      return { applied: false as const, reason: 'missing_payment_method' }
    }

    const now = Date.now()
    const triggerWindowStart = now - AUTO_TOP_UP_IDEMPOTENCY_WINDOW_MS
    const recentTopUps = await repository.listBudgetTopUpsByServer({ userId: params.userId })
    const matchingRecentTopUp = (recentTopUps ?? []).find((topUp) =>
      topUp.source === 'auto' &&
      topUp.amountCents === amountCents &&
      (topUp.status === 'pending' || topUp.status === 'succeeded') &&
      topUp.updatedAt >= triggerWindowStart
    )
    if (matchingRecentTopUp) {
      return {
        applied: matchingRecentTopUp.status === 'succeeded',
        amountCents,
        paymentIntentId: matchingRecentTopUp.stripePaymentIntentId,
        reason: matchingRecentTopUp.status === 'succeeded' ? 'already_succeeded' : 'already_pending',
      } as const
    }
    const idempotencyKey = [
      'auto-topup',
      params.userId,
      state.currentPeriodStart ?? 'no-period',
      amountCents,
      Math.floor(now / AUTO_TOP_UP_IDEMPOTENCY_WINDOW_MS),
    ].join(':')
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: state.stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        kind: 'budget_topup',
        source: 'auto',
        userId: params.userId,
        billingPeriodStart: String(state.currentPeriodStart ?? ''),
      },
    }, {
      idempotencyKey,
    })

    await repository.recordBudgetTopUp({
      userId: params.userId,
      amountCents,
      source: 'auto',
      stripeCustomerId: state.stripeCustomerId,
      stripePaymentIntentId: paymentIntent.id,
      status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
    })

    return {
      applied: paymentIntent.status === 'succeeded',
      amountCents,
      paymentIntentId: paymentIntent.id,
      reason: paymentIntent.status === 'succeeded' ? 'succeeded' : paymentIntent.status,
    } as const
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error ?? 'Auto top-up failed')
    if (/idempotent key|in-progress request/i.test(errorMessage)) {
      return {
        applied: false as const,
        reason: 'already_pending',
        errorMessage,
      }
    }
    await repository.recordBudgetTopUp({
      userId: params.userId,
      amountCents,
      source: 'auto',
      stripeCustomerId: state.stripeCustomerId,
      status: 'failed',
      errorMessage,
    })
    return {
      applied: false as const,
      reason: 'payment_failed',
      errorMessage,
    }
  }
}

/**
 * When a workspace on a paid plan runs out of credit: charge the workspace's saved card for one automatic top-up, if
 * an owner turned top-ups on and this period's total stays within their monthly limit. Otherwise nothing is charged
 * and paid resources stop until next period or a manual top-up (hard stop).
 */
export async function maybeAutoTopUpWorkspaceBudget(params: {
  actorUserId: string
  billingAccountId: string
  minimumRequiredCents?: number
  workspaceId: string
}, repository: BillingRepository) {
  const plan = await repository.getBillingAccountSubscriptionByServer({ billingAccountId: params.billingAccountId })
  if (!plan || plan.planKind !== 'paid') return { applied: false as const, reason: 'not_paid' }
  // One in flight at a time: a pending top-up is settled by the webhook or the reconcile job when Stripe finishes.
  if (plan.autoTopUpPending) return { applied: false as const, reason: 'already_pending' }
  const decision = decideAutoTopUp({
    enabled: Boolean(plan.autoTopUpEnabled),
    amountCents: plan.autoTopUpAmountCents ?? 0,
    monthlyLimitCents: plan.autoTopUpMonthlyLimitCents,
    spentThisPeriodCents: plan.autoTopUpSpentThisPeriodCents ?? 0,
    offSessionConsentAt: plan.offSessionConsentAt,
    stripeCustomerId: plan.stripeCustomerId,
  }, params.minimumRequiredCents)
  if (!decision.charge) return { applied: false as const, reason: decision.reason }
  const amountCents = decision.amountCents
  const state: SubscriptionBillingState = { ...plan, userId: params.actorUserId }

  try {
    const paymentMethodId = await resolveDefaultPaymentMethodId(state)
    if (!paymentMethodId) return { applied: false as const, reason: 'missing_payment_method' }
    const now = Date.now()
    // One charge per account per window, whoever triggers it: concurrent runs share the same Stripe idempotency key.
    const idempotencyKey = [
      'workspace-auto-topup',
      params.billingAccountId,
      plan.currentPeriodStart ?? 'no-period',
      plan.autoTopUpSpentThisPeriodCents ?? 0,
      amountCents,
      Math.floor(now / AUTO_TOP_UP_IDEMPOTENCY_WINDOW_MS),
    ].join(':')
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: plan.stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        kind: 'budget_topup',
        source: 'auto',
        billingAccountId: params.billingAccountId,
        workspaceId: params.workspaceId,
        userId: params.actorUserId,
      },
    }, { idempotencyKey })
    await repository.recordBillingAccountTopUp({
      actorUserId: params.actorUserId,
      billingAccountId: params.billingAccountId,
      amountCents,
      source: 'auto',
      status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
      stripeCustomerId: plan.stripeCustomerId,
      stripePaymentIntentId: paymentIntent.id,
    })
    return {
      applied: paymentIntent.status === 'succeeded',
      amountCents,
      reason: paymentIntent.status === 'succeeded' ? 'succeeded' : paymentIntent.status,
    } as const
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error ?? 'Auto top-up failed')
    if (/idempotent key|in-progress request/i.test(errorMessage)) {
      return { applied: false as const, reason: 'already_pending' }
    }
    // A declined card: record it and fall back to the hard stop for this attempt.
    await repository.recordBillingAccountTopUp({
      actorUserId: params.actorUserId,
      billingAccountId: params.billingAccountId,
      amountCents,
      source: 'auto',
      status: 'failed',
      stripeCustomerId: plan.stripeCustomerId,
      errorMessage: errorMessage.slice(0, 500),
    }).catch((_error) => undefined)
    return { applied: false as const, reason: 'payment_failed' }
  }
}

export function isRecognizedTopUpAmount(amountCents: number): boolean {
  if (!Number.isFinite(amountCents)) return false
  return isValidTopUpAmount(Math.round(amountCents))
}

export function getMinimumPaidPlanAmountCents(): number {
  return PAID_PLAN_UNIT_AMOUNT_CENTS * 8
}
