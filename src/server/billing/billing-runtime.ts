import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Entitlements } from '@/shared/app/app-contracts'
import {
  applyMarkupToCents,
  applyMarkupToDollars,
  centsToDollarAmount,
  clampTopUpAmountCents,
  TOP_UP_MAX_AMOUNT_CENTS,
  TOP_UP_MIN_AMOUNT_CENTS,
  TOP_UP_STEP_AMOUNT_CENTS,
} from '@/shared/billing/billing-pricing'
import { maybeAutoTopUpBudget } from '@/server/billing/stripe-billing'

export function isPaidPlan(entitlements: Pick<Entitlements, 'tier' | 'planKind'>): boolean {
  if (entitlements.planKind) return entitlements.planKind === 'paid'
  return entitlements.tier !== 'free'
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

export function billableBudgetCentsFromProviderUsd(providerCostUsd: number): number {
  return applyMarkupToDollars({ providerCostUsd })
}

export function billableBudgetCentsFromProviderCents(providerCostCents: number): number {
  return applyMarkupToCents({ providerCostCents })
}

export type ProviderSpendKind =
  | 'ask'
  | 'write'
  | 'agent'
  | 'embedding'
  | 'transcription'
  | 'generation'
  | 'sandbox'

export type ProviderUsageEvent = {
  type: ProviderSpendKind
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  cost: number
  timestamp: number
}

export function createBudgetReservationId(prefix = 'provider'): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`
}

export async function reserveProviderBudget(params: {
  userId: string
  entitlements: Entitlements
  providerCostUsd: number
  kind: ProviderSpendKind
  modelId?: string
  reservationId?: string
}) {
  const reservedCents = billableBudgetCentsFromProviderUsd(params.providerCostUsd)
  if (reservedCents <= 0) {
    return {
      ok: true,
      reservationId: null,
      reservedCents: 0,
      entitlements: params.entitlements,
    } as const
  }

  const budget = await ensureBudgetAvailable({
    userId: params.userId,
    entitlements: params.entitlements,
    minimumRequiredCents: Math.max(1, Math.ceil(reservedCents)),
  })

  if (!isPaidPlan(budget.entitlements) || budget.remainingCents + 0.000001 < reservedCents) {
    return {
      ok: false,
      status: 402,
      code: 'insufficient_budget',
      payload: buildInsufficientCreditsPayload(
        budget.entitlements,
        'Your Overlay budget is exhausted. Add budget or enable auto top-up before running this request.',
      ),
    } as const
  }

  const reservationId = params.reservationId ?? createBudgetReservationId(params.kind)
  await convex.mutation(
    'platform/usage:reserveBudgetByServer',
    {
      serverSecret: getInternalApiSecret(),
      userId: params.userId,
      reservationId,
      kind: params.kind,
      modelId: params.modelId,
      reservedCents,
    },
    { throwOnError: true },
  )

  return {
    ok: true,
    reservationId,
    reservedCents,
    entitlements: budget.entitlements,
  } as const
}

export async function finalizeProviderBudgetReservation(params: {
  userId: string
  reservationId: string | null | undefined
  actualProviderCostUsd: number
  events?: ProviderUsageEvent[]
}) {
  if (!params.reservationId) return { success: true, skipped: true } as const
  const actualCents = billableBudgetCentsFromProviderUsd(params.actualProviderCostUsd)
  return await convex.mutation(
    'platform/usage:finalizeBudgetReservationByServer',
    {
      serverSecret: getInternalApiSecret(),
      userId: params.userId,
      reservationId: params.reservationId,
      actualCents,
      events: params.events,
    },
    { throwOnError: true },
  )
}

export async function releaseProviderBudgetReservation(params: {
  userId: string
  reservationId: string | null | undefined
  providerWorkStarted?: boolean
  reason?: string
}) {
  if (!params.reservationId) return { success: true, skipped: true } as const
  return await convex.mutation(
    'platform/usage:releaseBudgetReservationByServer',
    {
      serverSecret: getInternalApiSecret(),
      userId: params.userId,
      reservationId: params.reservationId,
      providerWorkStarted: params.providerWorkStarted,
      reason: params.reason,
    },
    { throwOnError: true },
  )
}

export async function markProviderBudgetReconcile(params: {
  userId: string
  reservationId: string | null | undefined
  errorMessage?: string
}) {
  if (!params.reservationId) return { success: true, skipped: true } as const
  return await convex.mutation(
    'platform/usage:markBudgetReservationReconcileByServer',
    {
      serverSecret: getInternalApiSecret(),
      userId: params.userId,
      reservationId: params.reservationId,
      errorMessage: params.errorMessage,
    },
    { throwOnError: true },
  )
}

export async function refreshEntitlementsForUser(userId: string): Promise<Entitlements | null> {
  return await convex.query<Entitlements | null>(
    'platform/usage:getEntitlementsByServer',
    {
      serverSecret: getInternalApiSecret(),
      userId,
    },
    { throwOnError: true },
  )
}

export async function ensureBudgetAvailable(params: {
  userId: string
  entitlements: Entitlements
  minimumRequiredCents?: number
}) {
  const minimumRequiredCents = Math.max(1, Math.round(params.minimumRequiredCents ?? 1))
  const current = getBudgetTotals(params.entitlements)

  if (!isPaidPlan(params.entitlements) || current.remainingCents >= minimumRequiredCents) {
    return {
      entitlements: params.entitlements,
      remainingCents: current.remainingCents,
      autoTopUpApplied: false,
      autoTopUpReason: 'not_needed',
    } as const
  }

  const autoTopUp = await maybeAutoTopUpBudget({
    userId: params.userId,
    minimumRequiredCents,
  })

  if (!autoTopUp.applied) {
    return {
      entitlements: params.entitlements,
      remainingCents: current.remainingCents,
      autoTopUpApplied: false,
      autoTopUpReason: autoTopUp.reason,
    } as const
  }

  const refreshed = await refreshEntitlementsForUser(params.userId)
  const nextEntitlements = refreshed ?? params.entitlements
  const nextBudget = getBudgetTotals(nextEntitlements)

  return {
    entitlements: nextEntitlements,
    remainingCents: nextBudget.remainingCents,
    autoTopUpApplied: true,
    autoTopUpAmountCents: autoTopUp.amountCents,
    autoTopUpReason: autoTopUp.reason,
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

export function getTopUpPreferenceSnapshot(entitlements: Pick<
  Entitlements,
  'autoTopUpEnabled' | 'autoTopUpAmountCents'
>) {
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
