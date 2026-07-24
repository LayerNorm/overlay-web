import type { Entitlements } from './types'

export function createFreeEntitlements(): Entitlements {
  return {
    tier: 'free',
    planKind: 'free',
    creditsUsed: 0,
    creditsTotal: 0,
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: { ask: 0, write: 0, agent: 0 },
  }
}

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

export function usesFreeTierPrivileges(entitlements: Pick<
  Entitlements,
  'tier' | 'planKind' | 'creditsUsed' | 'creditsTotal' | 'budgetUsedCents' | 'budgetTotalCents' | 'budgetRemainingCents'
>): boolean {
  return !canUsePaidBudgetFeatures(entitlements)
}
