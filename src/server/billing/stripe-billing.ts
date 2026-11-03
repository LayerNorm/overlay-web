import 'server-only'

import { createHash } from 'node:crypto'
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

/** The Stripe references an automatic workspace top-up charges against. */
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
}, repository: BillingRepository, deps?: {
  resolvePaymentMethodId: (plan: SubscriptionBillingState) => Promise<string | null>
  createPaymentIntent: (input: {
    amount: number
    currency: 'usd'
    customer: string
    payment_method: string
    off_session: true
    confirm: true
    metadata: Record<string, string>
  }, options: { idempotencyKey: string }) => Promise<{ id: string; status: string }>
}) {
  const plan = await repository.getBillingAccountSubscriptionByServer({ billingAccountId: params.billingAccountId })
  if (!plan || plan.planKind !== 'paid') return { applied: false as const, reason: 'not_paid' }
  // Retry only the original, unrecorded claim with its immutable parameters/key.
  // A known PaymentIntent or an expired idempotency window must be reconciled,
  // never replaced with a new charge identity.
  if (plan.autoTopUpPending) {
    const pending = await repository.getPendingAutoTopUpIntentByServer?.({
      billingAccountId: params.billingAccountId,
    })
    if (!pending || pending.stripePaymentIntentId || Date.now() - pending.createdAt >= 23 * 60 * 60 * 1_000) {
      return { applied: false as const, reason: 'already_pending' }
    }
    if (!plan.autoTopUpEnabled || plan.status !== 'active'
      || plan.offSessionConsentAt !== pending.consentAt || plan.stripeCustomerId !== pending.customerId
      || plan.autoTopUpAmountCents !== pending.amountCents || plan.currentPeriodStart !== pending.currentPeriodStart
      || params.workspaceId !== pending.workspaceId) {
      return { applied: false as const, reason: 'authorization_changed' }
    }
    try {
      const paymentMethodId = await (deps?.resolvePaymentMethodId ?? resolveDefaultPaymentMethodId)({
        ...plan, userId: pending.actorUserId,
      })
      if (paymentMethodId !== pending.paymentMethodId) return { applied: false as const, reason: 'authorization_changed' }
      const createPaymentIntent = deps?.createPaymentIntent
        ?? ((input: Parameters<typeof stripe.paymentIntents.create>[0], options: Parameters<typeof stripe.paymentIntents.create>[1]) =>
          stripe.paymentIntents.create(input, options) as Promise<{ id: string; status: string }>)
      const paymentIntent = await createPaymentIntent({
        amount: pending.amountCents,
        currency: 'usd',
        customer: pending.customerId,
        payment_method: pending.paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          kind: 'budget_topup',
          source: 'auto',
          billingAccountId: params.billingAccountId,
          intentKey: pending.intentKey,
          workspaceId: pending.workspaceId,
          userId: pending.actorUserId,
        },
      }, { idempotencyKey: pending.idempotencyKey })
      await repository.recordBillingAccountTopUp({
        actorUserId: pending.actorUserId,
        billingAccountId: params.billingAccountId,
        workspaceId: pending.workspaceId,
        amountCents: pending.amountCents,
        source: 'auto',
        status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
        stripeCustomerId: pending.customerId,
        stripePaymentIntentId: paymentIntent.id,
        autoTopUpIntentKey: pending.intentKey,
      })
      return {
        applied: paymentIntent.status === 'succeeded',
        amountCents: pending.amountCents,
        reason: paymentIntent.status === 'succeeded' ? 'succeeded' : paymentIntent.status,
      } as const
    } catch (error) {
      const stripeError = error && typeof error === 'object' ? error as {
        type?: unknown; code?: unknown; payment_intent?: { id?: unknown }
      } : {}
      const paymentIntentId = typeof stripeError.payment_intent?.id === 'string'
        ? stripeError.payment_intent.id : undefined
      const definitiveDecline = stripeError.type === 'StripeCardError'
        || (typeof stripeError.code === 'string' && /^(card_|payment_intent_authentication)/.test(stripeError.code))
      if (definitiveDecline) {
        await repository.recordBillingAccountTopUp({
          actorUserId: pending.actorUserId,
          billingAccountId: params.billingAccountId,
          workspaceId: pending.workspaceId,
          amountCents: pending.amountCents,
          source: 'auto',
          status: 'failed',
          stripeCustomerId: pending.customerId,
          ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
          autoTopUpIntentKey: pending.intentKey,
        })
        return { applied: false as const, reason: 'payment_failed' }
      }
      return { applied: false as const, reason: 'pending' }
    }
  }
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
  let intentKey: string | undefined

  try {
    const paymentMethodId = await (deps?.resolvePaymentMethodId ?? resolveDefaultPaymentMethodId)(state)
    if (!paymentMethodId) return { applied: false as const, reason: 'missing_payment_method' }
    intentKey = createHash('sha256').update([
      'workspace-auto-topup:v2',
      params.billingAccountId,
      plan.currentPeriodStart ?? 'no-period',
      plan.autoTopUpSpentThisPeriodCents ?? 0,
      amountCents,
      plan.autoTopUpMonthlyLimitCents ?? 'unauthorized',
      plan.offSessionConsentAt ?? 0,
      plan.stripeCustomerId ?? '',
      paymentMethodId,
    ].join('\n')).digest('hex')
    const idempotencyKey = `workspace-auto-topup-${intentKey}`
    const claim = await repository.claimAutoTopUpIntentByServer({
      actorUserId: params.actorUserId,
      billingAccountId: params.billingAccountId,
      workspaceId: params.workspaceId,
      intentKey,
      idempotencyKey,
      amountCents,
      ...(plan.currentPeriodStart !== undefined ? { currentPeriodStart: plan.currentPeriodStart } : {}),
      consentAt: plan.offSessionConsentAt!,
      paymentMethodId,
      customerId: plan.stripeCustomerId!,
    })
    if (claim.status !== 'claimed') {
      return { applied: claim.status === 'succeeded', amountCents, reason: claim.status } as const
    }
    const createPaymentIntent = deps?.createPaymentIntent
      ?? ((input: Parameters<typeof stripe.paymentIntents.create>[0], options: Parameters<typeof stripe.paymentIntents.create>[1]) =>
        stripe.paymentIntents.create(input, options) as Promise<{ id: string; status: string }>)
    const paymentIntent = await createPaymentIntent({
      amount: claim.amountCents ?? amountCents,
      currency: 'usd',
      customer: claim.customerId ?? plan.stripeCustomerId!,
      payment_method: claim.paymentMethodId ?? paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        kind: 'budget_topup',
        source: 'auto',
        billingAccountId: params.billingAccountId,
        intentKey,
        workspaceId: claim.workspaceId ?? params.workspaceId,
        userId: claim.actorUserId ?? params.actorUserId,
      },
    }, { idempotencyKey: claim.idempotencyKey ?? idempotencyKey })
    await repository.recordBillingAccountTopUp({
      actorUserId: claim.actorUserId ?? params.actorUserId,
      billingAccountId: params.billingAccountId,
      workspaceId: claim.workspaceId ?? params.workspaceId,
      amountCents: claim.amountCents ?? amountCents,
      source: 'auto',
      status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
      stripeCustomerId: claim.customerId ?? plan.stripeCustomerId,
      stripePaymentIntentId: paymentIntent.id,
      autoTopUpIntentKey: intentKey,
    })
    return {
      applied: paymentIntent.status === 'succeeded',
      amountCents,
      reason: paymentIntent.status === 'succeeded' ? 'succeeded' : paymentIntent.status,
    } as const
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error ?? 'Auto top-up failed')
    const stripeError = error && typeof error === 'object' ? error as {
      type?: unknown
      code?: unknown
      payment_intent?: { id?: unknown }
    } : {}
    const paymentIntentId = typeof stripeError.payment_intent?.id === 'string'
      ? stripeError.payment_intent.id : undefined
    const definitiveDecline = stripeError.type === 'StripeCardError'
      || (typeof stripeError.code === 'string' && /^(card_|payment_intent_authentication)/.test(stripeError.code))
    if (!definitiveDecline || !intentKey) return { applied: false as const, reason: 'pending' }
    await repository.recordBillingAccountTopUp({
      actorUserId: params.actorUserId,
      billingAccountId: params.billingAccountId,
      workspaceId: params.workspaceId,
      amountCents,
      source: 'auto',
      status: 'failed',
      stripeCustomerId: plan.stripeCustomerId,
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      autoTopUpIntentKey: intentKey,
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
