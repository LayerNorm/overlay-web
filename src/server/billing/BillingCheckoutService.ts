import 'server-only'

import { logger } from '@/server/observability/logger'
import type { LifecycleEventPublisher } from '@/server/lifecycle-events'
import {
  clampPaidPlanAmountCents,
  clampTopUpAmountCents,
  formatDollarAmount,
  isValidTopUpAmount,
  quantityToPlanAmountCents,
} from '@/shared/billing/billing-pricing'
import { sameOriginPathUrl } from '@/shared/security/safe-url'
import type { BillingProvider } from '@overlay/app-core'
import { BillingServiceError } from './BillingCustomerService'
import type { BillingRepository } from './BillingRepository'

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
    const planAmountCents = clampPaidPlanAmountCents(Number(body.planAmountCents))
    const requestedTopUpAmountCents = Number(body.topUpAmountCents)
    const autoTopUpEnabled = Boolean(body.autoTopUpEnabled)

    if (!isValidTopUpAmount(requestedTopUpAmountCents)) {
      serviceError({ error: 'Unsupported top-up amount.' }, 400)
    }
    const topUpAmountCents = clampTopUpAmountCents(requestedTopUpAmountCents)

    const offSessionConsentAt = autoTopUpEnabled ? this.clock.now() : undefined
    const checkoutSession = await this.callProvider(
      () => this.billingProvider().createCheckoutSession({
        userId: args.user.id,
        email: args.user.email,
        kind: 'paid_plan',
        planAmountCents,
        topUpAmountCents,
        autoTopUpEnabled,
        ...(offSessionConsentAt ? { metadata: { offSessionConsentAt } } : {}),
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
      `[Checkout] Created paid plan session for user ${args.user.id} (${args.user.email}) — plan=${formatDollarAmount(planAmountCents)} topUp=${formatDollarAmount(topUpAmountCents)} autoTopUp=${autoTopUpEnabled}`,
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
        successUrl: resolveReturnUrl(baseUrl, body.returnPath, 'success'),
        cancelUrl: resolveReturnUrl(baseUrl, body.returnPath, 'canceled'),
      }),
      {
        'Stripe top-up price ID is not configured': () =>
          serviceError({ error: 'Top-up price not configured' }, 500),
      },
    )

    logger.info(`[TopUp Checkout] Created manual top-up checkout for ${args.userId}: ${formatDollarAmount(amountCents)}`)
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

function lifecycleSubscriptionStatus(
  status: string | undefined,
): 'active' | 'canceled' | 'past_due' | 'trialing' | 'unknown' {
  if (status === 'active' || status === 'canceled' || status === 'past_due' || status === 'trialing') {
    return status
  }
  return 'unknown'
}
