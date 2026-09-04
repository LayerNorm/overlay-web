import 'server-only'

import { logger } from '@/server/observability/logger'
import type { LifecycleEventPublisher } from '@/server/lifecycle-events'
import {
  clampTopUpAmountCents,
  formatDollarAmount,
  getPersonalPlanById,
  getPersonalPlanFromAmountCents,
  isValidTopUpAmount,
  quantityToPlanAmountCents,
  type PersonalPlanDefinition,
  type PersonalPlanId,
} from '@/shared/billing/billing-pricing'
import { sameOriginPathUrl } from '@/shared/security/safe-url'
import type { BillingProvider } from '@overlay/app-core'
import { BillingServiceError } from './BillingCustomerService'
import type { BillingRepository } from './BillingRepository'
import {
  legalAcceptanceMetadata,
  requireCurrentLegalAcceptance,
} from '@/server/legal/legal-acceptance'

type BillingCheckoutServiceDeps = {
  baseUrl?: () => string
  billingProvider: BillingProvider | (() => BillingProvider)
  clock?: { now(): number }
  lifecycleEvents?: () => LifecycleEventPublisher
  repository: BillingRepository
}

function serviceError(payload: Record<string, unknown>, statusCode: number): never {
  throw new BillingServiceError(payload, statusCode)
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function resolveReturnUrl(baseUrl: string, returnPath: unknown, state: 'success' | 'canceled') {
  const url = new URL(sameOriginPathUrl(baseUrl, returnPath, '/account'))
  if (state === 'success') {
    const checkoutSessionPlaceholder = 'CHECKOUT_SESSION_ID_PLACEHOLDER'
    url.searchParams.set('topup_success', 'true')
    url.searchParams.set('topup_session_id', checkoutSessionPlaceholder)
    return url.toString().replace(checkoutSessionPlaceholder, '{CHECKOUT_SESSION_ID}')
  }
  url.searchParams.set('topup_canceled', 'true')
  return url.toString()
}

export class BillingCheckoutService {
  private readonly baseUrl: () => string
  private readonly clock: { now(): number }

  constructor(private readonly deps: BillingCheckoutServiceDeps) {
    this.baseUrl = deps.baseUrl ?? (() => '')
    this.clock = deps.clock ?? { now: () => Date.now() }
  }

  async createSubscriptionCheckout(args: {
    body: unknown
    user: { id: string; email: string }
  }): Promise<{ url: string | null }> {
    const body = objectBody(args.body)
    const legalMetadata = legalAcceptanceMetadata(requireCurrentLegalAcceptance(body))
    const requestedTopUpAmountCents = Number(body.topUpAmountCents)
    const autoTopUpEnabled = Boolean(body.autoTopUpEnabled)

    if (!isValidTopUpAmount(requestedTopUpAmountCents)) {
      serviceError({ error: 'Unsupported top-up amount.' }, 400)
    }
    const topUpAmountCents = clampTopUpAmountCents(requestedTopUpAmountCents)
    const plan = resolveRequestedPaidPlan(body)
    const existingSubscription = await this.deps.repository.getSubscriptionByUserIdByServer({
      userId: args.user.id,
    })
    if (
      existingSubscription &&
      existingSubscription.status !== 'canceled' &&
      (existingSubscription.planKind === 'paid' || Boolean(existingSubscription.stripeSubscriptionId))
    ) {
      serviceError({
        error: 'An existing subscription must be managed instead of creating another checkout.',
        code: 'subscription_exists',
        action: existingSubscription.status === 'past_due' ? 'update_payment' : 'change_plan',
      }, 409)
    }

    const offSessionConsentAt = autoTopUpEnabled ? this.clock.now() : undefined
    const checkoutSession = await this.callProvider(
      () => this.billingProvider().createCheckoutSession({
        userId: args.user.id,
        email: args.user.email,
        kind: 'paid_plan',
        planId: plan.id,
        planAmountCents: plan.amountCents,
        topUpAmountCents,
        autoTopUpEnabled,
        metadata: {
          ...legalMetadata,
          ...(offSessionConsentAt ? { offSessionConsentAt } : {}),
        },
      }),
      {
        'Stripe paid plan price ID is not configured': () => {
          logger.error('Missing paid unit Stripe price ID')
          const hint =
            process.env.VERCEL_ENV === 'production'
              ? 'Set STRIPE_PAID_UNIT_PRICE_ID for Production in Vercel.'
              : 'Set DEV_STRIPE_PAID_UNIT_PRICE_ID and/or STRIPE_PAID_UNIT_PRICE_ID for Preview / local.'
          serviceError({ error: `Price ID not configured for the paid plan. ${hint}` }, 500)
        },
      },
    )

    logger.info(
      `[Checkout] Created named paid plan session — plan=${plan.id} topUp=${formatDollarAmount(topUpAmountCents)} autoTopUp=${autoTopUpEnabled}`,
    )
    return { url: checkoutSession.url }
  }

  async verifySubscriptionCheckout(args: {
    sessionId?: string
    userId: string
  }) {
    if (!args.sessionId) {
      serviceError({ error: 'Session ID required' }, 400)
    }
    const sessionId = args.sessionId

    const verification = await this.callProvider(
      async () => {
        const provider = this.billingProvider()
        if (!provider.verifyCheckoutSession) {
          throw new Error('Billing provider does not support checkout verification')
        }
        return await provider.verifyCheckoutSession({
          sessionId,
          userId: args.userId,
          kind: 'paid_plan',
        })
      },
      {
        'Session mismatch': () => serviceError({ error: 'Session mismatch' }, 403),
        'Payment not completed': () => serviceError({ error: 'Payment not completed' }, 400),
        'Subscription not found': () => serviceError({ error: 'Subscription not found' }, 400),
        'Subscription is not active': () => serviceError({ error: 'Subscription is not active' }, 400),
        'Unexpected subscription price': () => serviceError({ error: 'Unexpected subscription price' }, 400),
      },
    )

    if (!verification.providerSubscriptionId) {
      serviceError({ error: 'Subscription not found' }, 400)
    }
    if (!verification.providerPriceId) {
      serviceError({ error: 'Unexpected subscription price' }, 400)
    }

    const quantity = verification.providerQuantity ?? 1
    const planAmountCents = verification.planAmountCents ?? quantityToPlanAmountCents(quantity)
    const requestedPlanId = verification.metadata?.planId
    if (requestedPlanId) {
      const requestedPlan = getPersonalPlanById(requestedPlanId)
      if (
        !requestedPlan ||
        requestedPlan.id === 'free' ||
        requestedPlan.stripeQuantity !== quantity ||
        requestedPlan.amountCents !== planAmountCents
      ) {
        serviceError({ error: 'Checkout plan does not match the subscription.' }, 400)
      }
    }
    const topUpAmountCents = verification.topUpAmountCents
    const autoTopUpEnabled = Boolean(verification.autoTopUpEnabled)

    await this.deps.repository.upsertSubscription({
      userId: args.userId,
      stripeCustomerId: verification.providerCustomerId,
      stripeSubscriptionId: verification.providerSubscriptionId,
      stripePriceId: verification.providerPriceId,
      stripeQuantity: quantity,
      tier: 'pro',
      planKind: 'paid',
      planVersion: 'variable_v2',
      planAmountCents,
      autoTopUpEnabled,
      autoTopUpAmountCents: topUpAmountCents,
      offSessionConsentAt: verification.offSessionConsentAt,
      status: verification.status,
      currentPeriodStart: verification.currentPeriodStart,
      currentPeriodEnd: verification.currentPeriodEnd,
    })
    await this.publishLifecycleEvent({
      attributes: {
        changeSource: 'checkout_verification',
        planKind: 'paid',
        provider: 'stripe',
        status: lifecycleSubscriptionStatus(verification.status),
      },
      idempotencyKey: `subscription.changed:checkout:${sessionId}:${verification.providerSubscriptionId}`,
      name: 'subscription.changed',
      resource: { id: verification.providerSubscriptionId, type: 'subscription' },
      userId: args.userId,
    })

    logger.info('[Checkout Verify] Subscription verified and updated')

    return {
      success: true,
      planKind: 'paid' as const,
      planAmountCents,
      message: 'Subscription activated successfully',
    }
  }

  async changeSubscriptionPlan(args: {
    body: unknown
    userId: string
  }) {
    const body = objectBody(args.body)
    const plan = resolveRequestedPaidPlan(body)
    const subscription = await this.deps.repository.getSubscriptionByUserIdByServer({
      userId: args.userId,
    })
    if (
      subscription?.planKind !== 'paid' ||
      !subscription.stripeSubscriptionId ||
      !['active', 'trialing'].includes(subscription.status ?? '')
    ) {
      serviceError({
        error: subscription?.status === 'past_due'
          ? 'Update your payment method before changing plans.'
          : 'An active paid subscription is required to change plans.',
        code: subscription?.status === 'past_due' ? 'payment_required' : 'active_subscription_required',
      }, 409)
    }

    const providerArgs = {
      userId: args.userId,
      providerCustomerId: subscription.stripeCustomerId,
      providerSubscriptionId: subscription.stripeSubscriptionId,
      planId: plan.id,
      targetAmountCents: plan.amountCents,
      targetQuantity: plan.stripeQuantity,
      idempotencyKey: [
        'payment_revision',
        subscription.stripeSubscriptionId,
        plan.id,
        subscription.currentPeriodEnd ?? 'current',
      ].join(':'),
    }
    const provider = this.billingProvider()

    if (body.confirmation == null) {
      if (!provider.previewSubscriptionPlanChange) {
        serviceError({ error: 'Plan changes are not supported by the billing provider.' }, 501)
      }
      const preview = await this.callProvider(
        () => provider.previewSubscriptionPlanChange!(providerArgs),
        planChangeErrorMappers,
      )
      return { mode: 'preview' as const, ...preview }
    }

    if (body.confirmation !== 'CHANGE_PLAN') {
      serviceError({ error: 'Plan change confirmation required.' }, 403)
    }
    if (!provider.changeSubscriptionPlan) {
      serviceError({ error: 'Plan changes are not supported by the billing provider.' }, 501)
    }
    const result = await this.callProvider(
      () => provider.changeSubscriptionPlan!(providerArgs),
      planChangeErrorMappers,
    )

    if (result.applied) {
      await this.deps.repository.upsertSubscription({
        userId: args.userId,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        stripePriceId: subscription.stripePriceId,
        stripeQuantity: plan.stripeQuantity,
        tier: 'pro',
        planKind: 'paid',
        planVersion: 'named_v1',
        planAmountCents: plan.amountCents,
        autoTopUpEnabled: subscription.autoTopUpEnabled,
        autoTopUpAmountCents: subscription.autoTopUpAmountCents,
        offSessionConsentAt: subscription.offSessionConsentAt,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      })
    }

    logger.info(
      `[Billing] Personal plan change confirmed — plan=${plan.id} direction=${result.direction} scheduled=${result.scheduled}`,
    )
    return { mode: 'confirmed' as const, ...result }
  }

  async createPortalSession(args: {
    accessToken?: string
    body: unknown
    userEmail?: string
    userId: string
  }): Promise<{ url: string | null }> {
    const body = objectBody(args.body)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined

    const baseUrl = this.baseUrl()
    const provider = this.billingProvider()
    const portalSession = await this.callProvider(
      () => provider.createCustomerPortalSession
        ? provider.createCustomerPortalSession({
            userId: args.userId,
            email: args.userEmail,
            sessionId,
            returnUrl: baseUrl ? `${baseUrl}/account` : undefined,
          })
        : provider.createPortalSession(args.userId),
      {
        'Checkout session does not belong to the authenticated user.': () =>
          serviceError({ error: 'Checkout session does not belong to the authenticated user.' }, 403),
        'No Stripe customer found for user': () =>
          serviceError({ error: 'No customer found. Please subscribe first.' }, 400),
        'Stripe portal configuration ID is not configured': () =>
          serviceError({ error: 'Billing management is temporarily unavailable.' }, 503),
        'Stripe portal subscription updates must be disabled': () =>
          serviceError({ error: 'Billing management is temporarily unavailable.' }, 503),
      },
    )

    return { url: portalSession.url }
  }

  async createTopUpCheckout(args: {
    body: unknown
    userEmail?: string
    userId: string
  }): Promise<{ url: string | null }> {
    const body = objectBody(args.body)
    const legalMetadata = legalAcceptanceMetadata(requireCurrentLegalAcceptance(body))
    const entitlements = await this.deps.repository.getEntitlementsByServer({
      userId: args.userId,
    })
    if (entitlements?.planKind !== 'paid') {
      serviceError({ error: 'Top-ups require an active paid plan.' }, 403)
    }

    const requestedAmountCents = Number(body.amountCents)
    const autoTopUpEnabled = Boolean(body.autoTopUpEnabled)
    if (!isValidTopUpAmount(requestedAmountCents)) {
      serviceError({ error: 'Unsupported top-up amount' }, 400)
    }
    const amountCents = clampTopUpAmountCents(requestedAmountCents)

    const baseUrl = this.baseUrl()
    const checkoutSession = await this.callProvider(
      () => this.billingProvider().createCheckoutSession({
        userId: args.userId,
        email: args.userEmail,
        kind: 'budget_topup',
        topUpAmountCents: amountCents,
        autoTopUpEnabled,
        metadata: legalMetadata,
        successUrl: resolveReturnUrl(baseUrl, body.returnPath, 'success'),
        cancelUrl: resolveReturnUrl(baseUrl, body.returnPath, 'canceled'),
      }),
      {
        'Stripe top-up price ID is not configured': () =>
          serviceError({ error: 'Top-up price not configured' }, 500),
      },
    )

    logger.info(`[TopUp Checkout] Created manual top-up checkout — amount=${formatDollarAmount(amountCents)}`)
    return { url: checkoutSession.url }
  }

  async verifyTopUp(args: {
    body: unknown
    userId: string
  }): Promise<{ success: true; amountCents: number }> {
    const body = objectBody(args.body)
    const sessionId = String(body.sessionId ?? '').trim()
    if (!sessionId) {
      serviceError({ error: 'Session ID required' }, 400)
    }
    if (
      sessionId !== '{CHECKOUT_SESSION_ID}' &&
      !sessionId.includes('CHECKOUT_SESSION_ID') &&
      !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)
    ) {
      serviceError({ error: 'Invalid session ID' }, 400)
    }

    const verification = await this.callProvider(
      async () => {
        const provider = this.billingProvider()
        if (!provider.verifyCheckoutSession) {
          throw new Error('Billing provider does not support checkout verification')
        }
        return await provider.verifyCheckoutSession({
          sessionId,
          userId: args.userId,
          kind: 'budget_topup',
          allowLatestCompletedFallback: true,
        })
      },
      {
        'Session mismatch': () => serviceError({ error: 'Session mismatch' }, 403),
        'Invalid top-up session': () => serviceError({ error: 'Invalid top-up session' }, 400),
        'Payment not completed': () => serviceError({ error: 'Payment not completed' }, 400),
        'Invalid completed top-up session': () =>
          serviceError({ error: 'Invalid completed top-up session' }, 400),
      },
    )

    const amountCents = verification.amountTotalCents ?? verification.topUpAmountCents
    if (!amountCents) {
      serviceError({ error: 'Invalid completed top-up session' }, 400)
    }
    const autoTopUpEnabled = Boolean(verification.autoTopUpEnabled)
    await this.deps.repository.recordBudgetTopUp({
      userId: args.userId,
      amountCents,
      source: 'manual',
      stripeCustomerId: verification.providerCustomerId,
      stripeCheckoutSessionId: verification.providerSessionId,
      stripePaymentIntentId: verification.paymentIntentId,
      status: 'succeeded',
    })
    await this.deps.repository.updateBillingPreferences({
      userId: args.userId,
      autoTopUpEnabled,
      topUpAmountCents: amountCents,
      grantOffSessionConsent: autoTopUpEnabled,
    })
    await this.publishLifecycleEvent({
      attributes: { provider: 'stripe', source: 'manual' },
      idempotencyKey: `topup.succeeded:checkout:${verification.providerSessionId}`,
      name: 'topup.succeeded',
      resource: { id: verification.providerSessionId, type: 'billing_topup' },
      userId: args.userId,
    })

    return { success: true, amountCents }
  }

  private async publishLifecycleEvent(
    event: Parameters<LifecycleEventPublisher['publish']>[0],
  ): Promise<void> {
    await this.deps.lifecycleEvents?.().publish(event)
  }

  private billingProvider(): BillingProvider {
    return typeof this.deps.billingProvider === 'function'
      ? this.deps.billingProvider()
      : this.deps.billingProvider
  }

  private async callProvider<T>(
    operation: () => Promise<T>,
    errorMappers: Record<string, () => never> = {},
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      const mapper = errorMappers[message]
      if (mapper) return mapper()
      throw error
    }
  }
}

type PaidPersonalPlanDefinition = Omit<PersonalPlanDefinition, 'id'> & {
  id: Exclude<PersonalPlanId, 'free'>
}

function resolveRequestedPaidPlan(body: Record<string, unknown>): PaidPersonalPlanDefinition {
  const requestedById = getPersonalPlanById(body.planId)
  const requestedByLegacyAmount = getPersonalPlanFromAmountCents(body.planAmountCents)
  const plan = body.planId == null ? requestedByLegacyAmount : requestedById
  if (!plan || plan.id === 'free') {
    serviceError({
      error: 'Choose Starter, Pro, or Max.',
      code: 'unsupported_personal_plan',
    }, 400)
  }
  return plan as PaidPersonalPlanDefinition
}

const planChangeErrorMappers: Record<string, () => never> = {
  'Subscription is not eligible for a plan change': () =>
    serviceError({ error: 'This subscription cannot change plans in its current state.' }, 409),
  'Subscription customer mismatch': () =>
    serviceError({ error: 'Subscription ownership could not be verified.' }, 403),
  'Subscription must have exactly one plan item': () =>
    serviceError({ error: 'This subscription requires billing support to change plans.' }, 409),
  'Unexpected subscription price': () =>
    serviceError({ error: 'This subscription requires billing support to change plans.' }, 409),
  'Subscription billing period is unavailable': () =>
    serviceError({ error: 'The current billing period is unavailable. Try again later.' }, 409),
  'Trialing subscriptions cannot schedule a downgrade': () =>
    serviceError({ error: 'Trial plans cannot schedule a downgrade yet.' }, 409),
  'Canceling subscriptions cannot schedule a plan change': () =>
    serviceError({ error: 'Restore the subscription before scheduling a plan change.' }, 409),
  'Subscription already has a scheduled change': () =>
    serviceError({ error: 'A plan change is already scheduled for this subscription.' }, 409),
}

function lifecycleSubscriptionStatus(
  status: string | undefined,
): 'active' | 'canceled' | 'past_due' | 'trialing' | 'unknown' {
  if (status === 'active' || status === 'canceled' || status === 'past_due' || status === 'trialing') {
    return status
  }
  return 'unknown'
}
