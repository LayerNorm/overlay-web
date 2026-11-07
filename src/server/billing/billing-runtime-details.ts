import type { Entitlements } from '@/shared/app/app-contracts'
import { getTopUpPreferenceSnapshot } from '@/shared/billing/app-subscription'
import { centsToDollarAmount } from '@/shared/billing/billing-pricing'

export function isPaidPlan(entitlements: Pick<Entitlements, 'tier' | 'planKind'>): boolean {
  if (entitlements.planKind) return entitlements.planKind === 'paid'
  return entitlements.tier !== 'free'
}

export function getBudgetTotals(entitlements: Pick<
  Entitlements,
  'creditsUsed' | 'creditsTotal' | 'budgetUsedCents' | 'budgetTotalCents' | 'budgetRemainingCents'
>) {
  const usedCents =
    typeof entitlements.budgetUsedCents === 'number'
      ? entitlements.budgetUsedCents
      : Math.max(0, Math.round(entitlements.creditsUsed ?? 0))
  const totalCents =
    typeof entitlements.budgetTotalCents === 'number'
      ? entitlements.budgetTotalCents
      : Math.max(0, Math.round((entitlements.creditsTotal ?? 0) * 100))
  const remainingCents =
    typeof entitlements.budgetRemainingCents === 'number'
      ? entitlements.budgetRemainingCents
      : Math.max(0, totalCents - usedCents)
  return { usedCents, totalCents, remainingCents }
}

export function canUsePaidBudgetFeatures(entitlements: Pick<
  Entitlements,
  'tier' | 'planKind' | 'creditsUsed' | 'creditsTotal' | 'budgetUsedCents' | 'budgetTotalCents' | 'budgetRemainingCents'
>): boolean {
  return isPaidPlan(entitlements) && getBudgetTotals(entitlements).remainingCents > 0
}

export async function ensureBudgetAvailable(params: {
  userId: string
  entitlements: Entitlements
  minimumRequiredCents?: number
}) {
  return {
    entitlements: params.entitlements,
    remainingCents: getBudgetTotals(params.entitlements).remainingCents,
    autoTopUpApplied: false,
    autoTopUpReason: 'not_needed',
  } as const
}

export function formatBudgetUsage(entitlements: Pick<
  Entitlements,
  'creditsUsed' | 'creditsTotal' | 'budgetUsedCents' | 'budgetTotalCents' | 'budgetRemainingCents'
>) {
  const { usedCents, totalCents, remainingCents } = getBudgetTotals(entitlements)
  const usedPct = totalCents > 0 ? Math.min(100, (usedCents / totalCents) * 100) : 0
  const remainingPct = totalCents > 0 ? Math.max(0, 100 - usedPct) : 0
  return {
    usedCents,
    totalCents,
    remainingCents,
    usedDollars: centsToDollarAmount(usedCents),
    totalDollars: centsToDollarAmount(totalCents),
    remainingDollars: centsToDollarAmount(remainingCents),
    usedPct,
    remainingPct,
  }
}

export function buildInsufficientCreditsPayload(
  entitlements: Pick<Entitlements, 'autoTopUpEnabled' | 'autoTopUpAmountCents'>,
  message: string,
) {
  return {
    error: 'insufficient_credits',
    message,
    billingAction: {
      type: 'top_up',
      ...getTopUpPreferenceSnapshot(entitlements),
    },
  } as const
}

export { getTopUpPreferenceSnapshot }
