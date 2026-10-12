import { isValidTopUpAmount } from './billing-pricing'

/**
 * When a workspace runs out of credit, either paid resources stop (the default) or an automatic top-up adds credit,
 * up to a monthly limit the owner sets. This decides which, from the workspace plan's settings; it charges nothing.
 */
export type AutoTopUpSettings = {
  enabled: boolean
  amountCents: number
  /** Most automatic top-ups may add in one billing period. Required: no limit means no automatic top-ups. */
  monthlyLimitCents?: number
  /** Automatic top-ups already charged (pending or succeeded) this period. */
  spentThisPeriodCents: number
  offSessionConsentAt?: number
  stripeCustomerId?: string
}

export type AutoTopUpDecision =
  | { charge: true; amountCents: number }
  | {
      charge: false
      reason: 'disabled' | 'missing_consent' | 'missing_customer' | 'invalid_amount' | 'amount_too_small' | 'monthly_limit_reached'
    }

export function decideAutoTopUp(settings: AutoTopUpSettings, minimumRequiredCents = 1): AutoTopUpDecision {
  if (!settings.enabled) return { charge: false, reason: 'disabled' }
  if (!settings.offSessionConsentAt) return { charge: false, reason: 'missing_consent' }
  if (!settings.stripeCustomerId) return { charge: false, reason: 'missing_customer' }
  const amountCents = Math.round(settings.amountCents)
  if (!isValidTopUpAmount(amountCents)) return { charge: false, reason: 'invalid_amount' }
  if (amountCents < Math.max(1, Math.round(minimumRequiredCents))) return { charge: false, reason: 'amount_too_small' }
  if (!autoTopUpFitsLimit(settings, amountCents)) return { charge: false, reason: 'monthly_limit_reached' }
  return { charge: true, amountCents }
}

/** Whether one more top-up of `amountCents` stays within the monthly limit. */
export function autoTopUpFitsLimit(
  settings: Pick<AutoTopUpSettings, 'monthlyLimitCents' | 'spentThisPeriodCents'>,
  amountCents: number,
): boolean {
  const limit = settings.monthlyLimitCents ?? 0
  return Math.max(0, settings.spentThisPeriodCents) + amountCents <= limit
}

/** Validates what an owner submits. The limit must allow at least one top-up. */
export function validateAutoTopUpInput(input: {
  enabled: boolean
  amountCents: number
  monthlyLimitCents: number
}): { ok: true } | { ok: false; error: string } {
  if (!input.enabled) return { ok: true }
  if (!Number.isSafeInteger(input.amountCents) || !isValidTopUpAmount(input.amountCents)) {
    return { ok: false, error: 'Top-up amount must be a whole dollar amount from $8 to $500.' }
  }
  if (!Number.isSafeInteger(input.monthlyLimitCents) || input.monthlyLimitCents < input.amountCents) {
    return { ok: false, error: 'The monthly limit must be at least one top-up.' }
  }
  if (input.monthlyLimitCents > 1_000_000) return { ok: false, error: 'The monthly limit can be at most $10,000.' }
  return { ok: true }
}
