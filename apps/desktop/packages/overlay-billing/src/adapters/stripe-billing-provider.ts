import { createFreeEntitlements } from '../entitlements'
import type {
  BillingProvider,
  CheckoutArgs,
  CheckoutResult,
  CheckoutSessionVerificationArgs,
  CheckoutSessionVerificationResult,
  Entitlements,
  PortalSessionArgs,
  PortalResult,
  UsageArgs,
} from '../types'

type MaybeGetter<T> = T | (() => T)

export interface StripeCheckoutSession {
  id: string
  url: string | null
  amount_total?: number | null
  created?: number | null
  currency?: string | null
  customer?: string | { id?: string } | null
  metadata?: Record<string, string> | null
  mode?: string | null
  payment_intent?: string | { id?: string } | null
  payment_status?: string | null
  status?: string | null
  subscription?: string | StripeSubscription | null
}

export interface StripePortalSession {
  id: string
  url: string
}

export interface StripeCustomer {
  id: string
  created?: number
  deleted?: boolean
}

export interface StripeSubscriptionItem {
  current_period_end?: number | null
  current_period_start?: number | null
  price?: { id?: string | null } | null
  quantity?: number | null
}

export interface StripeSubscription {
  id: string
  billing_cycle_anchor?: number | null
  customer?: string | { id?: string } | null
  items?: { data?: StripeSubscriptionItem[] } | null
  status?: string | null
}

export interface StripeBillingClient {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<StripeCheckoutSession>
      list?(params: Record<string, unknown>): Promise<{ data: StripeCheckoutSession[] }>
      retrieve?(sessionId: string, params?: Record<string, unknown>): Promise<StripeCheckoutSession>
    }
  }
  billingPortal: {
    sessions: {
      create(params: Record<string, unknown>): Promise<StripePortalSession>
    }
  }
  customers?: {
    list?(params: Record<string, unknown>): Promise<{ data: StripeCustomer[] }>
    retrieve(customerId: string): Promise<string | StripeCustomer>
  }
  subscriptions?: {
    list?(params: Record<string, unknown>): Promise<{ data: StripeSubscription[] }>
    retrieve(subscriptionId: string): Promise<StripeSubscription>
    cancel(subscriptionId: string): Promise<unknown>
  }
}

export interface StripeSubscriptionState {
  email?: string
  planAmountCents?: number
  planKind?: 'free' | 'paid'
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  tier?: 'free' | 'pro' | 'max'
}

export interface StripeBillingProviderOptions {
  stripe: StripeBillingClient
  baseUrl: MaybeGetter<string>
  paidPlanPriceId?: MaybeGetter<string | null | undefined>
  topUpPriceId?: MaybeGetter<string | null | undefined>
  portalConfigurationId?: MaybeGetter<string | null | undefined>
  getEntitlements?: (userId: string) => Promise<Entitlements | null>
  getSubscriptionState?: (userId: string) => Promise<StripeSubscriptionState | null>
  recordUsage?: (args: UsageArgs) => Promise<void>
  cancelSubscription?: (subscriptionId: string) => Promise<void>
  createFreeEntitlements?: () => Entitlements
  normalizePlanAmountCents?: (amountCents: number) => number
  normalizeTopUpAmountCents?: (amountCents: number) => number
  isRecognizedTopUpAmount?: (amountCents: number) => boolean
  planQuantityForAmountCents?: (amountCents: number) => number
  planAmountCentsForQuantity?: (quantity: number) => number
  topUpQuantityForAmountCents?: (amountCents: number) => number
  syncSubscriptionCustomer?: (args: StripeSubscriptionState & {
    userId: string
    stripeCustomerId: string
  }) => Promise<void>
}

function resolve<T>(value: MaybeGetter<T> | undefined): T | undefined {
  return typeof value === 'function' ? (value as () => T)() : value
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.ceil(value))
}

function centsToDollarsQuantity(amountCents: number): number {
  return positiveInteger(amountCents / 100)
}

function toStripeMetadata(metadata: CheckoutArgs['metadata']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (value == null) continue
    out[key] = String(value)
  }
  return out
}

function getId(value: string | { id?: string } | null | undefined): string | undefined {
  if (typeof value === 'string') return value
  return typeof value?.id === 'string' ? value.id : undefined
}

function getSubscriptionObject(
  value: string | StripeSubscription | null | undefined,
): StripeSubscription | null {
  return value && typeof value === 'object' ? value : null
}

function getSubscriptionPeriodMs(subscription: StripeSubscription): {
  currentPeriodEnd: number
  currentPeriodStart: number
} {
  const now = Date.now()
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const firstItem = subscription.items?.data?.[0]
  const billingCycleAnchor = subscription.billing_cycle_anchor

  return {
    currentPeriodStart:
      typeof firstItem?.current_period_start === 'number' && firstItem.current_period_start > 0
        ? firstItem.current_period_start * 1000
        : typeof billingCycleAnchor === 'number' && billingCycleAnchor > 0
          ? billingCycleAnchor * 1000
          : now,
    currentPeriodEnd:
      typeof firstItem?.current_period_end === 'number' && firstItem.current_period_end > 0
        ? firstItem.current_period_end * 1000
        : now + thirtyDays,
  }
}

export class StripeBillingProvider implements BillingProvider {
  constructor(private readonly options: StripeBillingProviderOptions) {}

  async getEntitlements(userId: string): Promise<Entitlements> {
    return (await this.options.getEntitlements?.(userId)) ?? this.freeEntitlements()
  }

  async createCheckoutSession(args: CheckoutArgs): Promise<CheckoutResult> {
    return args.kind === 'budget_topup'
      ? this.createTopUpCheckoutSession(args)
      : this.createPaidPlanCheckoutSession(args)
  }

  async createPortalSession(userId: string): Promise<PortalResult> {
    return await this.createCustomerPortalSession({ userId })
  }

  async createCustomerPortalSession(args: PortalSessionArgs): Promise<PortalResult> {
    const customerId = await this.resolvePortalCustomerId(args)
    if (!customerId) {
      throw new Error('No Stripe customer found for user')
    }

    const session = await this.createStripePortalSession({
      customerId,
      returnUrl: args.returnUrl ?? `${this.baseUrl()}/account`,
    })
    return { url: session.url, providerSessionId: session.id }
  }

  async verifyCheckoutSession(
    args: CheckoutSessionVerificationArgs,
  ): Promise<CheckoutSessionVerificationResult> {
    return args.kind === 'budget_topup'
      ? this.verifyTopUpCheckoutSession(args)
      : this.verifyPaidPlanCheckoutSession(args)
  }

  async recordUsage(args: UsageArgs): Promise<void> {
    if (!this.options.recordUsage) {
      throw new Error('StripeBillingProvider.recordUsage requires a recordUsage callback')
    }
    await this.options.recordUsage(args)
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (this.options.cancelSubscription) {
      await this.options.cancelSubscription(subscriptionId)
      return
    }
    if (!this.options.stripe.subscriptions) {
      throw new Error('StripeBillingProvider.cancelSubscription requires Stripe subscriptions support')
    }
    await this.options.stripe.subscriptions.cancel(subscriptionId)
  }

  private async createPaidPlanCheckoutSession(args: CheckoutArgs): Promise<CheckoutResult> {
    const priceId = resolve(this.options.paidPlanPriceId)
    if (!priceId) {
      throw new Error('Stripe paid plan price ID is not configured')
    }

    const planAmountCents = this.normalizePlanAmount(Number(args.planAmountCents))
    const topUpAmountCents = this.normalizeTopUpAmount(Number(args.topUpAmountCents))
    const quantity = this.options.planQuantityForAmountCents?.(planAmountCents) ?? centsToDollarsQuantity(planAmountCents)
    const autoTopUpEnabled = Boolean(args.autoTopUpEnabled)
    const baseMetadata = toStripeMetadata(args.metadata)
    const metadataOffSessionConsentAt = Number.parseInt(baseMetadata.offSessionConsentAt ?? '', 10)
    const offSessionConsentAt = autoTopUpEnabled
      ? Number.isFinite(metadataOffSessionConsentAt) && metadataOffSessionConsentAt > 0
        ? metadataOffSessionConsentAt
        : Date.now()
      : undefined
    const metadata = {
      ...baseMetadata,
      userId: args.userId,
      kind: 'paid_plan',
      planKind: 'paid',
      planVersion: 'variable_v2',
      planAmountCents: String(planAmountCents),
      stripeQuantity: String(quantity),
      topUpAmountCents: String(topUpAmountCents),
      autoTopUpEnabled: String(autoTopUpEnabled),
      ...(offSessionConsentAt ? { offSessionConsentAt: String(offSessionConsentAt) } : {}),
      ...(args.email ? { email: args.email } : {}),
    }

    const session = await this.options.stripe.checkout.sessions.create({
      billing_address_collection: 'auto',
      line_items: [{ price: priceId, quantity }],
      mode: 'subscription',
      success_url:
        args.successUrl ??
        `${this.baseUrl()}/account?success=true&session_id={CHECKOUT_SESSION_ID}&open_app=true`,
      cancel_url: args.cancelUrl ?? `${this.baseUrl()}/pricing?canceled=true`,
      metadata,
      subscription_data: { metadata },
      ...(args.email ? { customer_email: args.email } : {}),
      allow_promotion_codes: true,
    })

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL')
    }
    return { url: session.url, providerSessionId: session.id }
  }

  private async createTopUpCheckoutSession(args: CheckoutArgs): Promise<CheckoutResult> {
    const requestedAmountCents = Number(args.topUpAmountCents)
    if (this.options.isRecognizedTopUpAmount && !this.options.isRecognizedTopUpAmount(requestedAmountCents)) {
      throw new Error('Unsupported top-up amount')
    }

    const entitlements = await this.getEntitlements(args.userId)
    if (entitlements.planKind !== 'paid') {
      throw new Error('Top-ups require an active paid plan')
    }

    const priceId = resolve(this.options.topUpPriceId)
    if (!priceId) {
      throw new Error('Stripe top-up price ID is not configured')
    }

    const amountCents = this.normalizeTopUpAmount(requestedAmountCents)
    const quantity = this.options.topUpQuantityForAmountCents?.(amountCents) ?? centsToDollarsQuantity(amountCents)
    const metadata = {
      ...toStripeMetadata(args.metadata),
      kind: 'budget_topup',
      userId: args.userId,
      amountCents: String(amountCents),
      stripeQuantity: String(quantity),
      autoTopUpEnabled: String(Boolean(args.autoTopUpEnabled)),
    }

    const session = await this.options.stripe.checkout.sessions.create({
      mode: 'payment',
      billing_address_collection: 'auto',
      line_items: [{ price: priceId, quantity }],
      success_url:
        args.successUrl ??
        `${this.baseUrl()}/account?topup_success=true&topup_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: args.cancelUrl ?? `${this.baseUrl()}/account?topup_canceled=true`,
      ...(args.email ? { customer_email: args.email } : {}),
      metadata,
      payment_intent_data: { metadata },
      allow_promotion_codes: false,
    })

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL')
    }
    return { url: session.url, providerSessionId: session.id }
  }

  private async resolvePortalCustomerId(args: PortalSessionArgs): Promise<string | undefined> {
    if (args.sessionId) {
      const customerId = await this.resolveVerifiedCustomerIdFromCheckoutSession(args.sessionId, args.userId)
      if (!customerId) {
        throw new Error('Checkout session does not belong to the authenticated user.')
      }
      return customerId
    }

    const subscription = await this.options.getSubscriptionState?.(args.userId)
    let customerId = await this.resolveExistingCustomerId(subscription?.stripeCustomerId)
    const subscriptionId = subscription?.stripeSubscriptionId

    if (!customerId && subscriptionId && this.options.stripe.subscriptions) {
      const stripeSubscription = await this.options.stripe.subscriptions.retrieve(subscriptionId)
      customerId = await this.resolveExistingCustomerId(
        typeof stripeSubscription.customer === 'string'
          ? stripeSubscription.customer
          : stripeSubscription.customer?.id,
      )
    }

    if (!customerId) {
      customerId = await this.findCustomerIdByEmail(args.email || subscription?.email)
    }

    if (customerId && !subscription?.stripeCustomerId) {
      await this.options.syncSubscriptionCustomer?.({
        userId: args.userId,
        email: args.email || subscription?.email,
        planAmountCents: subscription?.planAmountCents,
        planKind: subscription?.planKind,
        status: subscription?.status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        tier: subscription?.tier,
      })
    }

    return customerId
  }

  private async createStripePortalSession(args: {
    customerId: string
    returnUrl: string
  }): Promise<StripePortalSession> {
    const portalConfigurationId = resolve(this.options.portalConfigurationId)

    try {
      return await this.options.stripe.billingPortal.sessions.create({
        customer: args.customerId,
        return_url: args.returnUrl,
        ...(portalConfigurationId ? { configuration: portalConfigurationId } : {}),
      })
    } catch (error) {
      const stripeError = error as { code?: string; message?: string; type?: string }
      const invalidConfiguration =
        stripeError?.code === 'resource_missing' ||
        (stripeError?.type === 'StripeInvalidRequestError' &&
          stripeError?.message?.toLowerCase().includes('configuration'))

      if (!portalConfigurationId || !invalidConfiguration) {
        throw error
      }

      return await this.options.stripe.billingPortal.sessions.create({
        customer: args.customerId,
        return_url: args.returnUrl,
      })
    }
  }

  private async verifyPaidPlanCheckoutSession(
    args: CheckoutSessionVerificationArgs,
  ): Promise<CheckoutSessionVerificationResult> {
    const checkoutSession = await this.retrieveCheckoutSession(args.sessionId, {
      expand: ['subscription'],
    })

    if (checkoutSession.metadata?.userId !== args.userId) {
      throw new Error('Session mismatch')
    }
    if (
      checkoutSession.status !== 'complete' ||
      checkoutSession.mode !== 'subscription' ||
      checkoutSession.metadata?.kind !== 'paid_plan' ||
      checkoutSession.payment_status !== 'paid'
    ) {
      throw new Error('Payment not completed')
    }

    const subscription = getSubscriptionObject(checkoutSession.subscription)
    if (!subscription) {
      throw new Error('Subscription not found')
    }
    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      throw new Error('Subscription is not active')
    }

    const firstItem = subscription.items?.data?.[0]
    const priceId = firstItem?.price?.id ?? undefined
    const expectedPriceId = resolve(this.options.paidPlanPriceId)
    if (!priceId || (expectedPriceId && priceId !== expectedPriceId)) {
      throw new Error('Unexpected subscription price')
    }

    const metadataQuantity = Number.parseInt(checkoutSession.metadata?.stripeQuantity ?? '0', 10)
    const quantity = firstItem?.quantity ?? (Number.isFinite(metadataQuantity) && metadataQuantity > 0 ? metadataQuantity : 1)
    const metadataPlanAmountCents = Number.parseInt(checkoutSession.metadata?.planAmountCents ?? '0', 10)
    const planAmountCents =
      this.options.planAmountCentsForQuantity?.(quantity) ??
      (Number.isFinite(metadataPlanAmountCents) && metadataPlanAmountCents > 0
        ? this.normalizePlanAmount(metadataPlanAmountCents)
        : this.normalizePlanAmount(quantity * 100))
    const topUpAmountCents = Number.parseInt(checkoutSession.metadata?.topUpAmountCents ?? '0', 10) || undefined
    const autoTopUpEnabled = checkoutSession.metadata?.autoTopUpEnabled === 'true'
    const offSessionConsentAt = Number.parseInt(checkoutSession.metadata?.offSessionConsentAt ?? '0', 10) || undefined
    const period = getSubscriptionPeriodMs(subscription)

    return {
      providerSessionId: checkoutSession.id,
      providerCustomerId: getId(checkoutSession.customer),
      providerSubscriptionId: subscription.id,
      providerPriceId: priceId,
      providerQuantity: quantity,
      status: subscription.status ?? undefined,
      mode: checkoutSession.mode ?? undefined,
      paymentStatus: checkoutSession.payment_status ?? undefined,
      planAmountCents,
      topUpAmountCents,
      autoTopUpEnabled,
      offSessionConsentAt,
      currentPeriodStart: period.currentPeriodStart,
      currentPeriodEnd: period.currentPeriodEnd,
      metadata: checkoutSession.metadata ?? undefined,
    }
  }

  private async verifyTopUpCheckoutSession(
    args: CheckoutSessionVerificationArgs,
  ): Promise<CheckoutSessionVerificationResult> {
    const checkoutSession = await this.resolveCheckoutSession(args)
    if (checkoutSession.metadata?.userId !== args.userId) {
      throw new Error('Session mismatch')
    }
    if (checkoutSession.metadata?.kind !== 'budget_topup') {
      throw new Error('Invalid top-up session')
    }
    if (checkoutSession.payment_status !== 'paid') {
      throw new Error('Payment not completed')
    }
    if (checkoutSession.status !== 'complete' || checkoutSession.currency !== 'usd' || !checkoutSession.amount_total) {
      throw new Error('Invalid completed top-up session')
    }

    return {
      providerSessionId: checkoutSession.id,
      providerCustomerId: getId(checkoutSession.customer),
      status: checkoutSession.status ?? undefined,
      mode: checkoutSession.mode ?? undefined,
      paymentStatus: checkoutSession.payment_status ?? undefined,
      amountTotalCents: checkoutSession.amount_total,
      currency: checkoutSession.currency ?? undefined,
      paymentIntentId: getId(checkoutSession.payment_intent),
      autoTopUpEnabled: checkoutSession.metadata?.autoTopUpEnabled === 'true',
      topUpAmountCents: checkoutSession.amount_total,
      metadata: checkoutSession.metadata ?? undefined,
    }
  }

  private async resolveCheckoutSession(
    args: CheckoutSessionVerificationArgs,
  ): Promise<StripeCheckoutSession> {
    const normalizedSessionId = args.sessionId.trim()
    const looksLikePlaceholder =
      !normalizedSessionId ||
      normalizedSessionId === '{CHECKOUT_SESSION_ID}' ||
      normalizedSessionId.includes('CHECKOUT_SESSION_ID')

    if (!looksLikePlaceholder) {
      try {
        return await this.retrieveCheckoutSession(normalizedSessionId)
      } catch (error) {
        const stripeError = error as { code?: string }
        if (stripeError?.code !== 'resource_missing' || !args.allowLatestCompletedFallback) {
          throw error
        }
      }
    }

    if (!args.allowLatestCompletedFallback) {
      throw new Error('Invalid session ID')
    }

    const fallbackSession = await this.findLatestPaidTopUpSession(args.userId)
    if (!fallbackSession) {
      throw new Error('No completed top-up checkout session found for this user')
    }
    return fallbackSession
  }

  private async findLatestPaidTopUpSession(userId: string): Promise<StripeCheckoutSession | null> {
    if (!this.options.stripe.checkout.sessions.list) {
      throw new Error('Stripe checkout session listing is not available')
    }

    const page = await this.options.stripe.checkout.sessions.list({ limit: 50 })
    return (
      page.data
        .filter((session) =>
          session.metadata?.kind === 'budget_topup' &&
          session.metadata?.userId === userId &&
          session.payment_status === 'paid' &&
          session.status === 'complete',
        )
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0] ?? null
    )
  }

  private async retrieveCheckoutSession(
    sessionId: string,
    params?: Record<string, unknown>,
  ): Promise<StripeCheckoutSession> {
    if (!this.options.stripe.checkout.sessions.retrieve) {
      throw new Error('Stripe checkout session retrieval is not available')
    }
    return await this.options.stripe.checkout.sessions.retrieve(sessionId, params)
  }

  private async resolveVerifiedCustomerIdFromCheckoutSession(
    sessionId: string,
    userId: string,
  ): Promise<string | undefined> {
    const checkoutSession = await this.retrieveCheckoutSession(sessionId)
    if (checkoutSession.metadata?.userId !== userId) {
      return undefined
    }
    return await this.resolveExistingCustomerId(getId(checkoutSession.customer))
  }

  private async findCustomerIdByEmail(email?: string): Promise<string | undefined> {
    if (!email || !this.options.stripe.customers?.list) return undefined

    const customers = await this.options.stripe.customers.list({
      email,
      limit: 10,
    })
    if (customers.data.length === 0) return undefined

    if (!this.options.stripe.subscriptions?.list) {
      return customers.data.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0]?.id
    }

    const customersWithActiveSubscriptions = await Promise.all(
      customers.data.map(async (customer) => {
        const subscriptions = await this.options.stripe.subscriptions?.list?.({
          customer: customer.id,
          status: 'all',
          limit: 10,
        })
        const activeSubscription = subscriptions?.data.find((subscription) =>
          ['active', 'trialing', 'past_due'].includes(subscription.status ?? ''),
        )

        return {
          customerId: customer.id,
          activeSubscription,
          created: customer.created ?? 0,
        }
      }),
    )

    return (
      customersWithActiveSubscriptions.find((candidate) => candidate.activeSubscription)?.customerId ??
      customersWithActiveSubscriptions.sort((a, b) => b.created - a.created)[0]?.customerId
    )
  }

  private async resolveExistingCustomerId(customerId?: string): Promise<string | undefined> {
    if (!customerId) return undefined
    if (!this.options.stripe.customers) return customerId

    try {
      const customer = await this.options.stripe.customers.retrieve(customerId)
      if (typeof customer === 'string') return customer
      if (customer.deleted) return undefined
      return customer.id
    } catch {
      return undefined
    }
  }

  private baseUrl(): string {
    return resolve(this.options.baseUrl) ?? ''
  }

  private freeEntitlements(): Entitlements {
    return (this.options.createFreeEntitlements ?? createFreeEntitlements)()
  }

  private normalizePlanAmount(amountCents: number): number {
    return this.options.normalizePlanAmountCents?.(amountCents) ?? amountCents
  }

  private normalizeTopUpAmount(amountCents: number): number {
    return this.options.normalizeTopUpAmountCents?.(amountCents) ?? amountCents
  }
}
