import 'server-only'

import Stripe from 'stripe'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { stripe, getBaseUrl } from '@/server/billing/stripe'
import {
  getPlanQuantityForCheckout,
  getTopUpPriceId,
  getTopUpQuantityForCheckout,
  isRecognizedTopUpAmount,
  resolvePaidUnitPriceId,
  resolvePortalConfigurationId,
} from '@/server/billing/stripe-billing'
import { refreshEntitlementsForUser } from '@/server/billing/billing-runtime'
import {
  clampPaidPlanAmountCents,
  clampTopUpAmountCents,
  quantityToPlanAmountCents,
} from '@/shared/billing/billing-pricing'
import {
  createFreeEntitlements,
  StripeBillingProvider as CoreStripeBillingProvider,
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

async function getSubscriptionState(userId: string): Promise<SubscriptionBillingState | null> {
  return await convex.query<SubscriptionBillingState | null>(
    'billing/subscriptions:getByUserIdByServer',
    {
      serverSecret: getInternalApiSecret(),
      userId,
    },
    { throwOnError: true },
  )
}

async function recordUsage(args: UsageArgs): Promise<void> {
  if (!args.accessToken) {
    throw new Error('StripeBillingProvider.recordUsage requires an access token')
  }

  await convex.mutation(
    'platform/usage:recordUsage',
    {
      accessToken: args.accessToken,
      userId: args.userId,
      type: args.type,
      modelId: args.modelId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cachedTokens: args.cachedTokens,
      cost: args.cost,
    },
    { throwOnError: true },
  )
}

async function syncSubscriptionCustomer(args: SubscriptionBillingState & {
  userId: string
  stripeCustomerId: string
}): Promise<void> {
  await convex.mutation('billing/subscriptions:upsertSubscription', {
    serverSecret: getInternalApiSecret(),
    userId: args.userId,
    email: args.email,
    stripeCustomerId: args.stripeCustomerId,
    stripeSubscriptionId: args.stripeSubscriptionId,
    tier: args.tier,
    planKind: args.planKind,
    planAmountCents: args.planAmountCents,
    status: args.status,
  })
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

    super({
      stripe: configuredStripe as unknown as StripeBillingClient,
      baseUrl: () => config.baseUrl ?? getBaseUrl(),
      paidPlanPriceId: () => config.paidUnitPriceId ?? resolvePaidUnitPriceId(),
      topUpPriceId: () => config.topupUnitPriceId ?? getTopUpPriceId(),
      portalConfigurationId: () => config.portalConfigurationId ?? resolvePortalConfigurationId(),
      getEntitlements: refreshEntitlementsForUser,
      getSubscriptionState,
      recordUsage,
      createFreeEntitlements,
      normalizePlanAmountCents: clampPaidPlanAmountCents,
      normalizeTopUpAmountCents: clampTopUpAmountCents,
      isRecognizedTopUpAmount,
      planQuantityForAmountCents: getPlanQuantityForCheckout,
      planAmountCentsForQuantity: quantityToPlanAmountCents,
      topUpQuantityForAmountCents: getTopUpQuantityForCheckout,
      syncSubscriptionCustomer,
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
