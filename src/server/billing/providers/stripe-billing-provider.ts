import 'server-only'

import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { stripe, getBaseUrl } from '@/server/billing/stripe'
import {
  getPlanQuantityForCheckout,
  getTopUpPriceId,
  getTopUpQuantityForCheckout,
  isRecognizedTopUpAmount,
  resolvePaidUnitPriceId,
  resolvePortalConfigurationId,
} from '@/server/billing/stripe-billing'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import type { UsageRepository } from '@/server/usage'
import {
  clampPaidPlanAmountCents,
  clampTopUpAmountCents,
  getPersonalPlanFromQuantity,
  quantityToPlanAmountCents,
} from '@/shared/billing/billing-pricing'
import {
  createFreeEntitlements,
  StripeBillingProvider as CoreStripeBillingProvider,
  type Entitlements,
  type PortalResult,
  type PortalSessionArgs,
  type SubscriptionPlanChangeArgs,
  type SubscriptionPlanChangePreview,
  type SubscriptionPlanChangeResult,
  type StripeBillingClient,
  type UsageArgs,
} from '@overlay/billing'

export interface StripeBillingProviderConfig {
  mode?: 'test' | 'live' | 'unknown'
  secretKey?: string
  paidUnitPriceId?: string
  topupUnitPriceId?: string
  portalConfigurationId?: string
  baseUrl?: string
  repository?: BillingRepository
  usageRepository?: UsageRepository
  stripeClient?: Stripe
}

type SubscriptionBillingState = {
  email?: string
  planAmountCents?: number
  planKind?: 'free' | 'paid'
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  tier?: 'free' | 'pro' | 'max'
}

export class StripeBillingProvider extends CoreStripeBillingProvider {
  private readonly stripeClient: Stripe
  private readonly configuredPaidUnitPriceId?: string
  private readonly configuredPortalConfigurationId?: string
  readonly providerConfigSummary: {
    provider: 'stripe'
    mode: 'test' | 'live' | 'unknown'
    hasSecretKey: boolean
    hasPaidUnitPriceId: boolean
    hasTopupUnitPriceId: boolean
    hasPortalConfigurationId: boolean
  }

  constructor(config: StripeBillingProviderConfig = {}) {
    const configuredStripe = config.stripeClient ?? (
      config.secretKey ? new Stripe(config.secretKey) : stripe
    )

    const repository = config.repository
    const usageRepository = config.usageRepository
    super({
      stripe: configuredStripe as unknown as StripeBillingClient,
      baseUrl: () => config.baseUrl ?? getBaseUrl(),
      paidPlanPriceId: () => config.paidUnitPriceId ?? resolvePaidUnitPriceId(),
      topUpPriceId: () => config.topupUnitPriceId ?? getTopUpPriceId(),
      portalConfigurationId: () => config.portalConfigurationId ?? resolvePortalConfigurationId(),
      getEntitlements: repository
        ? async (userId) => {
            const entitlements = await repository.getEntitlementsByServer({ userId })
            return entitlements ? toCoreEntitlements(entitlements) : null
          }
        : undefined,
      getSubscriptionState: repository
        ? (userId) => repository.getSubscriptionByUserIdByServer({ userId }) as Promise<SubscriptionBillingState | null>
        : undefined,
      getBillingAccountEntitlements: repository
        ? async (billingAccountId) => {
            const entitlements = await repository.getBillingAccountEntitlementsByServer({ billingAccountId })
            return entitlements ? toCoreEntitlements(entitlements) : null
          }
        : undefined,
      getBillingAccountSubscriptionState: repository
        ? (billingAccountId) => repository.getBillingAccountSubscriptionByServer({ billingAccountId }) as Promise<SubscriptionBillingState | null>
        : undefined,
      recordUsage: usageRepository
        ? (args: UsageArgs) => usageRepository.recordBatch({
            events: [{
              cachedTokens: args.cachedTokens,
              costCents: Math.max(0, args.cost),
              inputTokens: args.inputTokens,
              kind: args.type,
              modelId: args.modelId,
              occurredAt: args.timestamp ?? Date.now(),
              outputTokens: args.outputTokens,
            }],
            operationId: `billing_provider_${randomUUID()}`,
            userId: args.userId,
          }).then(() => undefined)
        : undefined,
      createFreeEntitlements,
      normalizePlanAmountCents: clampPaidPlanAmountCents,
      normalizeTopUpAmountCents: clampTopUpAmountCents,
      isRecognizedTopUpAmount,
      planQuantityForAmountCents: getPlanQuantityForCheckout,
      planAmountCentsForQuantity: quantityToPlanAmountCents,
      topUpQuantityForAmountCents: getTopUpQuantityForCheckout,
      syncSubscriptionCustomer: repository
        ? (args) => repository.upsertSubscription({ ...args }).then(() => undefined)
        : undefined,
      syncBillingAccountCustomer: repository
        ? (args) => repository.upsertBillingAccountSubscription({
            ...args,
            planKind: args.planKind ?? 'free',
            planAmountCents: args.planAmountCents ?? 0,
            status: args.status ?? 'active',
          }).then(() => undefined)
        : undefined,
      integrationIdentifier: () => `payment_revision_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    })

    this.stripeClient = config.stripeClient ?? configuredStripe
    this.configuredPaidUnitPriceId = config.paidUnitPriceId
    this.configuredPortalConfigurationId = config.portalConfigurationId ?? resolvePortalConfigurationId()

    this.providerConfigSummary = {
      provider: 'stripe',
      mode: config.mode ?? 'unknown',
      hasSecretKey: Boolean(config.secretKey),
      hasPaidUnitPriceId: Boolean(config.paidUnitPriceId),
      hasTopupUnitPriceId: Boolean(config.topupUnitPriceId),
      hasPortalConfigurationId: Boolean(config.portalConfigurationId),
    }
  }

  override async createCustomerPortalSession(args: PortalSessionArgs): Promise<PortalResult> {
    const configurationId = this.configuredPortalConfigurationId
    if (!configurationId) {
      throw new Error('Stripe portal configuration ID is not configured')
    }
    const configuration = await this.stripeClient.billingPortal.configurations.retrieve(configurationId)
    if (configuration.features.subscription_update.enabled) {
      throw new Error('Stripe portal subscription updates must be disabled')
    }
    if (!configuration.features.payment_method_update.enabled) {
      throw new Error('Stripe portal payment method updates must be enabled')
    }
    if (!configuration.features.subscription_cancel.enabled) {
      throw new Error('Stripe portal subscription cancellation must be enabled')
    }
    if (configuration.features.subscription_cancel.mode !== 'at_period_end') {
      throw new Error('Stripe portal subscription cancellation must occur at period end')
    }
    return await super.createCustomerPortalSession(args)
  }

  async previewSubscriptionPlanChange(
    args: SubscriptionPlanChangeArgs,
  ): Promise<SubscriptionPlanChangePreview> {
    const state = await this.loadPlanChangeState(args)
    return await this.buildPlanChangePreview(args, state)
  }

  private async buildPlanChangePreview(
    args: SubscriptionPlanChangeArgs,
    state: Awaited<ReturnType<StripeBillingProvider['loadPlanChangeState']>>,
  ): Promise<SubscriptionPlanChangePreview> {
    const direction = planChangeDirection(state.currentQuantity, args.targetQuantity)
    let prorationAmountCents = 0

    if (direction === 'upgrade') {
      const invoice = await this.stripeClient.invoices.createPreview({
        customer: state.customerId,
        subscription: state.subscription.id,
        subscription_details: {
          items: [{ id: state.item.id, quantity: args.targetQuantity }],
          proration_behavior: 'always_invoice',
          proration_date: state.prorationDate,
        },
      })
      prorationAmountCents = invoice.lines.data
        .filter((line) => line.parent?.subscription_item_details?.proration === true)
        .reduce((total, line) => total + line.amount, 0)
    }

    return planChangePreview({
      args,
      currentQuantity: state.currentQuantity,
      currency: state.currency,
      direction,
      effectiveAt: direction === 'downgrade' ? state.currentPeriodEnd * 1000 : Date.now(),
      prorationAmountCents,
    })
  }

  async changeSubscriptionPlan(
    args: SubscriptionPlanChangeArgs,
  ): Promise<SubscriptionPlanChangeResult> {
    const state = await this.loadPlanChangeState(args)
    const direction = planChangeDirection(state.currentQuantity, args.targetQuantity)
    const preview = await this.buildPlanChangePreview(args, state)

    if (direction === 'same') {
      return { ...preview, applied: true, paymentActionRequired: false, scheduled: false }
    }

    if (direction === 'upgrade') {
      const updated = await this.stripeClient.subscriptions.update(
        state.subscription.id,
        {
          items: [{ id: state.item.id, quantity: args.targetQuantity }],
          metadata: planChangeMetadata(state.subscription.metadata, args),
          payment_behavior: 'pending_if_incomplete',
          proration_behavior: 'always_invoice',
          proration_date: state.prorationDate,
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
      )
      return {
        ...preview,
        applied: updated.pending_update == null,
        paymentActionRequired: updated.pending_update != null,
        scheduled: false,
      }
    }

    if (state.subscription.status === 'trialing') {
      throw new Error('Trialing subscriptions cannot schedule a downgrade')
    }
    const scheduleKey = args.idempotencyKey ?? [
      'payment_revision',
      state.subscription.id,
      args.planId,
      state.currentPeriodEnd,
    ].join(':')
    let schedule: Stripe.SubscriptionSchedule
    if (state.subscription.schedule) {
      const scheduleId = typeof state.subscription.schedule === 'string'
        ? state.subscription.schedule
        : state.subscription.schedule.id
      schedule = await this.stripeClient.subscriptionSchedules.retrieve(scheduleId)
      if (schedule.metadata?.overlayPlanChangeKey !== scheduleKey) {
        throw new Error('Subscription already has a scheduled change')
      }
    } else {
      schedule = await this.stripeClient.subscriptionSchedules.create(
        {
          from_subscription: state.subscription.id,
          metadata: {
            ...planChangeMetadata({}, args),
            overlayPlanChangeKey: scheduleKey,
          },
        },
        { idempotencyKey: `${scheduleKey}:schedule` },
      )
    }
    const schedulePeriodStart = schedule.current_phase?.start_date ?? state.currentPeriodStart
    const schedulePeriodEnd = schedule.current_phase?.end_date ?? state.currentPeriodEnd
    await this.stripeClient.subscriptionSchedules.update(
      schedule.id,
      {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          {
            start_date: schedulePeriodStart,
            end_date: schedulePeriodEnd,
            items: [{
              price: state.priceId,
              quantity: state.currentQuantity,
              ...stripeItemPhaseSettings(state.item),
            }],
            ...stripeSubscriptionPhaseSettings(state.subscription),
            metadata: { ...state.subscription.metadata },
            proration_behavior: 'none',
          },
          {
            start_date: schedulePeriodEnd,
            duration: { interval: 'month', interval_count: 1 },
            items: [{
              price: state.priceId,
              quantity: args.targetQuantity,
              ...stripeItemPhaseSettings(state.item),
            }],
            ...stripeSubscriptionPhaseSettings(state.subscription),
            metadata: planChangeMetadata(state.subscription.metadata, args),
            proration_behavior: 'none',
          },
        ],
      },
      { idempotencyKey: `${scheduleKey}:apply` },
    )

    return { ...preview, applied: false, paymentActionRequired: false, scheduled: true }
  }

  private async loadPlanChangeState(args: SubscriptionPlanChangeArgs) {
    const subscription = await this.stripeClient.subscriptions.retrieve(args.providerSubscriptionId)
    if (!['active', 'trialing'].includes(subscription.status)) {
      throw new Error('Subscription is not eligible for a plan change')
    }
    if (subscription.cancel_at_period_end || subscription.cancel_at) {
      throw new Error('Canceling subscriptions cannot schedule a plan change')
    }

    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id
    if (args.providerCustomerId && customerId !== args.providerCustomerId) {
      throw new Error('Subscription customer mismatch')
    }

    const items = subscription.items.data
    if (items.length !== 1) {
      throw new Error('Subscription must have exactly one plan item')
    }
    const item = items[0]!
    const priceId = item.price.id
    const expectedPriceId = this.configuredPaidUnitPriceId ?? resolvePaidUnitPriceId()
    if (!expectedPriceId || priceId !== expectedPriceId) {
      throw new Error('Unexpected subscription price')
    }
    const currentQuantity = item.quantity ?? 1
    const currentPeriodStart = item.current_period_start
    const currentPeriodEnd = item.current_period_end
    if (!currentPeriodStart || !currentPeriodEnd) {
      throw new Error('Subscription billing period is unavailable')
    }

    return {
      currency: item.price.currency,
      currentPeriodEnd,
      currentPeriodStart,
      currentQuantity,
      customerId,
      item,
      priceId,
      prorationDate: Math.floor(Date.now() / 1000),
      subscription,
    }
  }
}

function planChangeDirection(currentQuantity: number, targetQuantity: number) {
  if (targetQuantity > currentQuantity) return 'upgrade' as const
  if (targetQuantity < currentQuantity) return 'downgrade' as const
  return 'same' as const
}

function planChangeMetadata(
  current: Stripe.Metadata,
  args: SubscriptionPlanChangeArgs,
): Stripe.MetadataParam {
  return {
    ...current,
    planId: args.planId,
    planKind: 'paid',
    planVersion: 'variable_v2',
    planAmountCents: String(args.targetAmountCents),
    stripeQuantity: String(args.targetQuantity),
  }
}

function stripeDiscountReferences(discounts: Array<string | Stripe.Discount>) {
  return discounts.map((discount) => ({
    discount: typeof discount === 'string' ? discount : discount.id,
  }))
}

function stripeItemPhaseSettings(item: Stripe.SubscriptionItem) {
  return {
    ...(item.discounts.length ? { discounts: stripeDiscountReferences(item.discounts) } : {}),
    ...(item.tax_rates?.length ? { tax_rates: item.tax_rates.map((rate) => rate.id) } : {}),
    ...(Object.keys(item.metadata).length ? { metadata: { ...item.metadata } } : {}),
  }
}

function stripeSubscriptionPhaseSettings(subscription: Stripe.Subscription) {
  return {
    automatic_tax: { enabled: subscription.automatic_tax.enabled },
    collection_method: subscription.collection_method,
    ...(subscription.discounts.length
      ? { discounts: stripeDiscountReferences(subscription.discounts) }
      : {}),
    ...(subscription.default_tax_rates?.length
      ? { default_tax_rates: subscription.default_tax_rates.map((rate) => rate.id) }
      : {}),
  }
}

function planChangePreview(args: {
  args: SubscriptionPlanChangeArgs
  currency: string
  currentQuantity: number
  direction: 'upgrade' | 'downgrade' | 'same'
  effectiveAt: number
  prorationAmountCents: number
}): SubscriptionPlanChangePreview {
  return {
    currency: args.currency,
    currentAmountCents: quantityToPlanAmountCents(args.currentQuantity),
    currentQuantity: args.currentQuantity,
    direction: args.direction,
    effectiveAt: args.effectiveAt,
    losesLegacyPricing: getPersonalPlanFromQuantity(args.currentQuantity) == null,
    planId: args.args.planId,
    prorationAmountCents: args.prorationAmountCents,
    targetAmountCents: args.args.targetAmountCents,
    targetQuantity: args.args.targetQuantity,
  }
}

function toCoreEntitlements(
  value: Awaited<ReturnType<BillingRepository['getEntitlementsByServer']>> & {},
): Entitlements {
  const dailyLimits = value.dailyLimits
  return {
    tier: value.tier,
    planKind: value.planKind,
    planAmountCents: value.planAmountCents,
    status: value.status,
    stripeQuantity: value.stripeQuantity,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    creditsUsed: value.creditsUsed,
    creditsTotal: value.creditsTotal,
    budgetUsedCents: value.budgetUsedCents,
    budgetTotalCents: value.budgetTotalCents,
    budgetRemainingCents: value.budgetRemainingCents,
    allowanceTotalCents: value.allowanceTotalCents,
    allowanceUsedCents: value.allowanceUsedCents,
    allowancePercentUsed: value.allowancePercentUsed,
    topUpBalanceCents: value.topUpBalanceCents,
    autoTopUpEnabled: value.autoTopUpEnabled,
    autoTopUpAmountCents: value.autoTopUpAmountCents,
    autoTopUpConsentGranted: value.autoTopUpConsentGranted,
    dailyUsage: value.dailyUsage ?? { ask: 0, write: 0, agent: 0 },
    dailyLimits: dailyLimits ? {
      ask: finiteLimit(dailyLimits.ask),
      write: finiteLimit(dailyLimits.write),
      agent: finiteLimit(dailyLimits.agent),
    } : undefined,
    overlayStorageBytesUsed: value.overlayStorageBytesUsed,
    overlayStorageBytesLimit: value.overlayStorageBytesLimit,
    transcriptionSecondsUsed: value.transcriptionSecondsUsed,
    transcriptionSecondsLimit: value.transcriptionSecondsLimit,
    localTranscriptionEnabled: value.localTranscriptionEnabled,
    resetAt: value.resetAt ? new Date(value.resetAt).toISOString() : undefined,
    billingPeriodEnd: value.billingPeriodEnd,
    lastSyncedAt: value.lastSyncedAt,
  }
}

function finiteLimit(value: number | string): number {
  if (value === 'Infinity' || value === Infinity) return Number.MAX_SAFE_INTEGER
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
