import 'server-only'

import { appSubscriptionResponse, getTopUpPreferenceSnapshot, normalizeUsageBuckets, unfundedAppSubscription } from '@/shared/billing/app-subscription'
import { getDynamicTopUpConfig } from '@/server/billing/stripe-billing'
import { TOP_UP_MIN_AMOUNT_CENTS } from '@/shared/billing/billing-pricing'
import type { BillingEntitlementsRecord, BillingRepository } from './BillingRepository'

export class BillingServiceError extends Error {
  constructor(
    readonly payload: Record<string, unknown>,
    readonly statusCode: number,
    message?: string,
  ) {
    super(message ?? String(payload.error ?? 'Billing service error'))
    this.name = 'BillingServiceError'
  }
}

export type BillingCustomerServiceDeps = {
  repository: BillingRepository
}

function serviceError(payload: Record<string, unknown>, statusCode: number): never {
  throw new BillingServiceError(payload, statusCode)
}

function normalizeLimitValue(value: number | string | undefined): number {
  if (value === Infinity || value === 'Infinity') {
    return 999999
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export class BillingCustomerService {
  constructor(private readonly deps: BillingCustomerServiceDeps) {}

  async getLandingSubscription(args: {
    userId: string
  }) {
    const entitlements = await this.deps.repository.getEntitlementsByServer({ userId: args.userId })
    if (!entitlements) {
      serviceError({ error: 'Failed to load subscription' }, 502)
    }
    const usageBuckets = normalizeUsageBuckets(entitlements)

    return {
      tier: entitlements.tier,
      planKind: entitlements.planKind,
      planAmountCents: entitlements.planAmountCents,
      status: 'active' as const,
      ...getTopUpPreferenceSnapshot(entitlements),
      creditsUsed: usageBuckets.budgetUsedCents,
      creditsTotal: usageBuckets.budgetTotalCents,
      ...usageBuckets,
      autoTopUpEnabled: entitlements.autoTopUpEnabled,
      autoTopUpConsentGranted: entitlements.autoTopUpConsentGranted,
      billingPeriodEnd: entitlements.billingPeriodEnd || null,
    }
  }

  async getAppSubscription(args: {
    billingAccountId?: string
    unfundedWorkspace?: boolean
    userId: string
  }) {
    if (args.unfundedWorkspace) {
      return unfundedAppSubscription(await this.deps.repository.getEntitlementsByServer({ userId: args.userId }))
    }
    const [entitlements, userEntitlements] = args.billingAccountId
      ? await Promise.all([
          this.deps.repository.getBillingAccountEntitlementsByServer({
            billingAccountId: args.billingAccountId,
          }),
          this.deps.repository.getEntitlementsByServer({ userId: args.userId }),
        ])
      : [
          await this.deps.repository.getEntitlementsByServer({ userId: args.userId }),
          null,
        ]
    if (!entitlements) {
      serviceError({ error: 'Failed to load subscription' }, 502)
    }
    const appEntitlements = args.billingAccountId
      ? {
          ...entitlements,
          overlayStorageBytesUsed: userEntitlements?.overlayStorageBytesUsed ?? entitlements.overlayStorageBytesUsed,
          overlayStorageBytesLimit: userEntitlements?.overlayStorageBytesLimit ?? entitlements.overlayStorageBytesLimit,
        }
      : entitlements
    return appSubscriptionResponse(appEntitlements)
  }

  /** A person's own billing settings. An account has no plan or automatic top-ups (plans belong to workspaces). */
  getBillingSettings() {
    const topUpConfig = getDynamicTopUpConfig()
    return {
      planKind: 'free' as const,
      autoTopUpEnabled: false,
      topUpAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
      autoTopUpAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
      topUpMinAmountCents: topUpConfig.minAmountCents,
      topUpMaxAmountCents: topUpConfig.maxAmountCents,
      topUpStepAmountCents: topUpConfig.stepAmountCents,
    }
  }

  async getEntitlements(args: {
    userId: string
  }) {
    const convexData = await this.deps.repository.getEntitlementsByServer({ userId: args.userId })
    if (!convexData) {
      serviceError({ error: 'Failed to load subscription' }, 502)
    }
    return this.toEntitlementsResponse(convexData)
  }

  private toEntitlementsResponse(convexData: BillingEntitlementsRecord) {
    const tier = convexData.tier
    const planKind = convexData.planKind
    const dailyUsage = convexData.dailyUsage ?? { ask: 0, write: 0, agent: 0 }
    const dailyLimits = convexData.dailyLimits ?? { ask: 0, write: 0, agent: 0 }
    const usageBuckets = normalizeUsageBuckets(convexData)
    const creditsUsed = usageBuckets.budgetUsedCents
    const creditsTotal = usageBuckets.budgetTotalCents
    const transcriptionSecondsUsed = convexData.transcriptionSecondsUsed ?? 0
    const transcriptionSecondsLimit = convexData.transcriptionSecondsLimit ?? 0
    const overlayStorageBytesUsed = convexData.overlayStorageBytesUsed ?? 0
    const overlayStorageBytesLimit = convexData.overlayStorageBytesLimit ?? 0
    const askPerDay = normalizeLimitValue(dailyLimits.ask)
    const agentPerDay = normalizeLimitValue(dailyLimits.agent)
    const writePerDay = normalizeLimitValue(dailyLimits.write)
    const transcriptionSecondsPerWeek = normalizeLimitValue(transcriptionSecondsLimit)

    return {
      tier,
      planKind,
      planAmountCents: convexData.planAmountCents,
      status: 'active' as const,
      ...getTopUpPreferenceSnapshot(convexData),
      autoTopUpConsentGranted: convexData.autoTopUpConsentGranted,
      limits: {
        askPerDay,
        agentPerDay,
        writePerDay,
        tokenBudget: creditsTotal,
        transcriptionSecondsPerWeek,
        overlayStorageBytes: overlayStorageBytesLimit,
      },
      usage: {
        ask: dailyUsage.ask,
        agent: dailyUsage.agent,
        write: dailyUsage.write,
        tokenCostAccrued: creditsUsed,
        transcriptionSeconds: transcriptionSecondsUsed,
        overlayStorageBytes: overlayStorageBytesUsed,
      },
      remaining: {
        ask: Math.max(0, askPerDay - dailyUsage.ask),
        agent: Math.max(0, agentPerDay - dailyUsage.agent),
        write: Math.max(0, writePerDay - dailyUsage.write),
        tokenBudget: Math.max(0, creditsTotal - creditsUsed),
        transcriptionSeconds: Math.max(0, transcriptionSecondsPerWeek - transcriptionSecondsUsed),
        overlayStorageBytes: Math.max(0, overlayStorageBytesLimit - overlayStorageBytesUsed),
      },
      budgetUsedCents: creditsUsed,
      budgetTotalCents: creditsTotal,
      budgetRemainingCents: convexData.budgetRemainingCents ?? Math.max(0, creditsTotal - creditsUsed),
      allowanceTotalCents: usageBuckets.allowanceTotalCents,
      allowanceUsedCents: usageBuckets.allowanceUsedCents,
      allowancePercentUsed: usageBuckets.allowancePercentUsed,
      topUpBalanceCents: usageBuckets.topUpBalanceCents,
      creditsUsed,
      creditsTotal: creditsTotal / 100,
      dailyUsage,
      dailyLimits,
      overlayStorageBytesUsed,
      overlayStorageBytesLimit,
      transcriptionSecondsUsed,
      transcriptionSecondsLimit,
      localTranscriptionEnabled: convexData.localTranscriptionEnabled ?? false,
      resetAt: convexData.resetAt ?? 0,
      billingPeriodEnd: convexData.billingPeriodEnd
        ? new Date(convexData.billingPeriodEnd).getTime() / 1000
        : undefined,
      lastSyncedAt: convexData.lastSyncedAt ?? 0,
    }
  }
}
