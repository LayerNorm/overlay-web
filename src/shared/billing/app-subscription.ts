import {
  clampTopUpAmountCents,
  TOP_UP_MAX_AMOUNT_CENTS,
  TOP_UP_MIN_AMOUNT_CENTS,
  TOP_UP_STEP_AMOUNT_CENTS,
} from '@/shared/billing/billing-pricing'

/** The entitlement fields the app's subscription view is built from (a ledger account, or a person's storage). */
export type AppEntitlementsInput = {
  tier: 'free' | 'pro' | 'max'
  planKind: 'free' | 'paid'
  planAmountCents: number
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  allowanceTotalCents?: number
  allowanceUsedCents?: number
  allowancePercentUsed?: number
  topUpBalanceCents?: number
  autoTopUpEnabled: boolean
  autoTopUpAmountCents: number
  creditsUsed: number
  creditsTotal: number
  dailyUsage?: { ask: number; write: number; agent: number }
}

/** Top-up amounts shown with a balance: the account's chosen amount clamped to the allowed range, and that range. */
export function getTopUpPreferenceSnapshot(entitlements: { autoTopUpEnabled?: boolean; autoTopUpAmountCents?: number }) {
  const topUpAmountCents = clampTopUpAmountCents(
    typeof entitlements.autoTopUpAmountCents === 'number' && entitlements.autoTopUpAmountCents > 0
      ? entitlements.autoTopUpAmountCents
      : TOP_UP_MIN_AMOUNT_CENTS,
  )
  return {
    topUpAmountCents,
    autoTopUpEnabled: Boolean(entitlements.autoTopUpEnabled),
    topUpMinAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
    topUpMaxAmountCents: TOP_UP_MAX_AMOUNT_CENTS,
    topUpStepAmountCents: TOP_UP_STEP_AMOUNT_CENTS,
    autoTopUpAmountCents: topUpAmountCents,
  }
}

/** Budget, allowance and top-up balance in cents, filled in from older credit fields where a source lacks them. */
export function normalizeUsageBuckets(entitlements: AppEntitlementsInput) {
  const budgetUsedCents = entitlements.budgetUsedCents ?? entitlements.creditsUsed
  const budgetTotalCents = entitlements.budgetTotalCents ?? entitlements.creditsTotal * 100
  const budgetRemainingCents = entitlements.budgetRemainingCents ?? Math.max(0, budgetTotalCents - budgetUsedCents)
  const allowanceTotalCents = entitlements.allowanceTotalCents ?? entitlements.planAmountCents ?? budgetTotalCents
  const allowanceUsedCents = entitlements.allowanceUsedCents ?? Math.min(budgetUsedCents, allowanceTotalCents)
  const allowancePercentUsed = entitlements.allowancePercentUsed ?? (
    allowanceTotalCents > 0 ? Math.min(100, Math.max(0, allowanceUsedCents / allowanceTotalCents * 100)) : 0
  )
  const allowanceRemainingCents = Math.max(0, allowanceTotalCents - allowanceUsedCents)
  return {
    budgetUsedCents,
    budgetTotalCents,
    budgetRemainingCents,
    allowanceTotalCents,
    allowanceUsedCents,
    allowancePercentUsed,
    topUpBalanceCents: entitlements.topUpBalanceCents ?? Math.max(0, budgetRemainingCents - allowanceRemainingCents),
  }
}

/** The subscription view the app shows: entitlements with normalized buckets and the top-up preferences. */
export function appSubscriptionResponse<T extends AppEntitlementsInput>(entitlements: T) {
  const usageBuckets = normalizeUsageBuckets(entitlements)
  return {
    ...entitlements,
    dailyUsage: entitlements.dailyUsage ?? { ask: 0, write: 0, agent: 0 },
    ...getTopUpPreferenceSnapshot(entitlements),
    ...usageBuckets,
    creditsUsed: usageBuckets.budgetUsedCents,
    creditsTotal: usageBuckets.budgetTotalCents / 100,
  }
}

/** A workspace with no wallet yet: nothing to spend, plus the person's own storage. */
export function unfundedAppSubscription(storage: { overlayStorageBytesUsed?: number; overlayStorageBytesLimit?: number } | null) {
  return appSubscriptionResponse({
    tier: 'free' as const, planKind: 'free' as const, planAmountCents: 0, status: 'active' as const,
    budgetUsedCents: 0, budgetTotalCents: 0, budgetRemainingCents: 0,
    creditsUsed: 0, creditsTotal: 0,
    autoTopUpEnabled: false, autoTopUpAmountCents: 0, autoTopUpConsentGranted: false,
    dailyLimits: { ask: 0, write: 0, agent: 0 },
    transcriptionSecondsUsed: 0, transcriptionSecondsLimit: 0,
    overlayStorageBytesUsed: storage?.overlayStorageBytesUsed ?? 0,
    overlayStorageBytesLimit: storage?.overlayStorageBytesLimit ?? 0,
  })
}
