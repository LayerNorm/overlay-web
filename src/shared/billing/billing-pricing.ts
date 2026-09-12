export type OverlayPlanKind = 'free' | 'paid'

export type LegacyOverlayTier = 'free' | 'pro' | 'max'

export const PAID_PLAN_MIN_AMOUNT_CENTS = 800
export const PAID_PLAN_MAX_AMOUNT_CENTS = 20_000
export const PAID_PLAN_STEP_AMOUNT_CENTS = 100
export const PAID_PLAN_UNIT_AMOUNT_CENTS = 100

export const DEFAULT_MARKUP_BASIS_POINTS = 2_500

export const FREE_PLAN_STORAGE_BYTES = 10 * 1024 * 1024
export const PAID_STORAGE_BASE_PLAN_AMOUNT_CENTS = 800
export const PAID_STORAGE_BASE_BYTES = 1024 * 1024 * 1024

export const TOP_UP_MIN_AMOUNT_CENTS = 800
export const TOP_UP_MAX_AMOUNT_CENTS = 20_000
export const TOP_UP_STEP_AMOUNT_CENTS = 100
export const TOP_UP_UNIT_AMOUNT_CENTS = 100

export function clampPaidPlanAmountCents(amountCents: number): number {
  if (!Number.isFinite(amountCents)) return PAID_PLAN_MIN_AMOUNT_CENTS
  const rounded = Math.round(amountCents / PAID_PLAN_STEP_AMOUNT_CENTS) * PAID_PLAN_STEP_AMOUNT_CENTS
  return Math.max(PAID_PLAN_MIN_AMOUNT_CENTS, Math.min(PAID_PLAN_MAX_AMOUNT_CENTS, rounded))
}

export function clampTopUpAmountCents(amountCents: number): number {
  if (!Number.isFinite(amountCents)) return TOP_UP_MIN_AMOUNT_CENTS
  const rounded = Math.round(amountCents / TOP_UP_STEP_AMOUNT_CENTS) * TOP_UP_STEP_AMOUNT_CENTS
  return Math.max(TOP_UP_MIN_AMOUNT_CENTS, Math.min(TOP_UP_MAX_AMOUNT_CENTS, rounded))
}

export function isPaidPlanKind(planKind: string | null | undefined): planKind is 'paid' {
  return planKind === 'paid'
}

export function derivePlanKind(params: {
  planKind?: string | null
  tier?: string | null
}): OverlayPlanKind {
  if (params.planKind === 'free' || params.planKind === 'paid') {
    return params.planKind
  }
  return params.tier === 'free' || !params.tier ? 'free' : 'paid'
}

export function legacyTierPlanAmountCents(tier: LegacyOverlayTier | string | null | undefined): number {
  if (tier === 'max') return 10_000
  if (tier === 'pro') return 2_000
  return 0
}

export function derivePlanAmountCents(params: {
  planKind?: string | null
  tier?: string | null
  planAmountCents?: number | null
}): number {
  const planKind = derivePlanKind(params)
  if (planKind === 'free') return 0
  if (typeof params.planAmountCents === 'number' && Number.isFinite(params.planAmountCents) && params.planAmountCents > 0) {
    return clampPaidPlanAmountCents(params.planAmountCents)
  }
  return clampPaidPlanAmountCents(legacyTierPlanAmountCents(params.tier))
}

export function getMarkupBasisPoints(markupBasisPoints?: number | null): number {
  if (typeof markupBasisPoints === 'number' && Number.isFinite(markupBasisPoints) && markupBasisPoints >= 0) {
    return Math.round(markupBasisPoints)
  }
  return DEFAULT_MARKUP_BASIS_POINTS
}

export function quantityToPlanAmountCents(quantity?: number | null): number {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    return 0
  }
  return clampPaidPlanAmountCents(Math.round(quantity) * PAID_PLAN_UNIT_AMOUNT_CENTS)
}

export function planAmountCentsToQuantity(planAmountCents: number): number {
  return Math.max(1, Math.round(clampPaidPlanAmountCents(planAmountCents) / PAID_PLAN_UNIT_AMOUNT_CENTS))
}

export function topUpAmountCentsToQuantity(amountCents: number): number {
  return Math.max(1, Math.round(clampTopUpAmountCents(amountCents) / TOP_UP_UNIT_AMOUNT_CENTS))
}

export function quantityToTopUpAmountCents(quantity?: number | null): number {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    return 0
  }
  return clampTopUpAmountCents(Math.round(quantity) * TOP_UP_UNIT_AMOUNT_CENTS)
}

export function isValidTopUpAmount(amountCents: number): boolean {
  if (!Number.isFinite(amountCents)) return false
  const rounded = Math.round(amountCents)
  return (
    rounded >= TOP_UP_MIN_AMOUNT_CENTS &&
    rounded <= TOP_UP_MAX_AMOUNT_CENTS &&
    rounded % TOP_UP_STEP_AMOUNT_CENTS === 0
  )
}

export function getStorageLimitBytes(params: {
  planKind: OverlayPlanKind
  planAmountCents: number
}): number {
  if (params.planKind === 'free') return FREE_PLAN_STORAGE_BYTES
  const ratio = clampPaidPlanAmountCents(params.planAmountCents) / PAID_STORAGE_BASE_PLAN_AMOUNT_CENTS
  return Math.max(PAID_STORAGE_BASE_BYTES, Math.round(PAID_STORAGE_BASE_BYTES * ratio))
}

export function roundCurrencyCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

export function dollarsToCents(value: number): number {
  return roundCurrencyCents(value * 100)
}

export function applyMarkupToCents(params: {
  providerCostCents: number
  markupBasisPoints?: number | null
}): number {
  const markupBasisPoints = getMarkupBasisPoints(params.markupBasisPoints)
  const multiplier = 1 + markupBasisPoints / 10_000
  return roundCurrencyCents(Math.max(0, params.providerCostCents) * multiplier)
}

export function applyMarkupToDollars(params: {
  providerCostUsd: number
  markupBasisPoints?: number | null
}): number {
  return applyMarkupToCents({
    providerCostCents: dollarsToCents(params.providerCostUsd),
    markupBasisPoints: params.markupBasisPoints,
  })
}

export function centsToDollarAmount(cents: number): number {
  if (!Number.isFinite(cents)) return 0
  return Math.round(cents) / 100
}

export function formatDollarAmount(cents: number): string {
  return `$${centsToDollarAmount(cents).toFixed(2)}`
}
