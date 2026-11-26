/**
 * Admin spend limits (a cap per person or per program) renew every period of their own length, so a cap set for one
 * billing period keeps applying in the next without anyone resetting it. Outside the period it was last charged in,
 * nothing counts as used yet.
 */
export type SpendLimitWindow = { periodStart: number; periodEnd: number }

/** What counts as used right now: the stored amount only while `now` is inside the stored period. */
export function spendLimitUsedNow(limit: SpendLimitWindow & { used: number; reserved: number }, now: number): number {
  return now >= limit.periodStart && now < limit.periodEnd ? limit.used + limit.reserved : 0
}

export function spendLimitReachedNow(limit: SpendLimitWindow & { used: number; reserved: number; limit: number }, now: number): boolean {
  return spendLimitUsedNow(limit, now) >= limit.limit
}

/** The period containing `now`, stepping the stored one forward by its own length; null while it still applies. */
export function rolledSpendLimitWindow(limit: SpendLimitWindow, now: number): SpendLimitWindow | null {
  if (now < limit.periodEnd) return null
  const length = Math.max(1, limit.periodEnd - limit.periodStart)
  const periods = Math.floor((now - limit.periodStart) / length)
  return { periodStart: limit.periodStart + periods * length, periodEnd: limit.periodStart + (periods + 1) * length }
}
