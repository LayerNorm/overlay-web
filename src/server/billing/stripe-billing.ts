import 'server-only'

import { stripe } from '@/server/billing/stripe'
import type { BillingRepository } from '@/server/billing/BillingRepository'
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
  return await repository.getSubscriptionByUserIdByServer({ userId })
}

function normalizeStripePaymentMethodId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

async function resolveDefaultPaymentMethodId(state: SubscriptionBillingState): Promise<string | null> {
  if (state.stripeSubscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(state.stripeSubscriptionId)
    const fromSubscription = normalizeStripePaymentMethodId(subscription.default_payment_method)
    if (fromSubscription) return fromSubscription
  }
  if (!state.stripeCustomerId) return null
  const customer = await stripe.customers.retrieve(state.stripeCustomerId)
  if (!customer || typeof customer === 'string' || ('deleted' in customer && customer.deleted)) {
    return null
  }
  return normalizeStripePaymentMethodId(customer.invoice_settings?.default_payment_method)
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

  try {
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

export function isRecognizedTopUpAmount(amountCents: number): boolean {
  if (!Number.isFinite(amountCents)) return false
  return isValidTopUpAmount(Math.round(amountCents))
}

export function getMinimumPaidPlanAmountCents(): number {
  return PAID_PLAN_UNIT_AMOUNT_CENTS * 8
}
