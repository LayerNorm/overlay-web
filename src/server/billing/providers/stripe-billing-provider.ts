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
  quantityToPlanAmountCents,
} from '@/shared/billing/billing-pricing'
import {
  createFreeEntitlements,
  StripeBillingProvider as CoreStripeBillingProvider,
  type Entitlements,
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
  readonly providerConfigSummary: {
    provider: 'stripe'
    mode: 'test' | 'live' | 'unknown'
    hasSecretKey: boolean
    hasPaidUnitPriceId: boolean
    hasTopupUnitPriceId: boolean
    hasPortalConfigurationId: boolean
  }

  constructor(config: StripeBillingProviderConfig = {}) {
    const configuredStripe = config.secretKey
      ? new Stripe(config.secretKey)
      : stripe

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
    })

    this.providerConfigSummary = {
      provider: 'stripe',
      mode: config.mode ?? 'unknown',
      hasSecretKey: Boolean(config.secretKey),
      hasPaidUnitPriceId: Boolean(config.paidUnitPriceId),
      hasTopupUnitPriceId: Boolean(config.topupUnitPriceId),
      hasPortalConfigurationId: Boolean(config.portalConfigurationId),
    }
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
    creditsUsed: value.creditsUsed,
    creditsTotal: value.creditsTotal,
    budgetUsedCents: value.budgetUsedCents,
    budgetTotalCents: value.budgetTotalCents,
    budgetRemainingCents: value.budgetRemainingCents,
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
