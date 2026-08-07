export type UsageBuckets = {
  allowanceTotal: number
  allowanceUsed: number
  topUpBalance: number
  topUpPurchased: number
}

export type UsageAllocation = {
  allowance: number
  topUp: number
}

export function deriveUsageBuckets(args: {
  allowanceTotal: number
  legacyUsed: number
  topUpPurchased: number
}): UsageBuckets {
  const allowanceTotal = nonNegative(args.allowanceTotal)
  const legacyUsed = nonNegative(args.legacyUsed)
  const topUpPurchased = nonNegative(args.topUpPurchased)
  const allowanceUsed = Math.min(legacyUsed, allowanceTotal)
  const topUpUsed = Math.min(topUpPurchased, Math.max(0, legacyUsed - allowanceUsed))
  return {
    allowanceTotal,
    allowanceUsed,
    topUpBalance: topUpPurchased - topUpUsed,
    topUpPurchased,
  }
}

export function allocateUsageCharge(
  buckets: UsageBuckets,
  amount: number,
): { allocation: UsageAllocation; buckets: UsageBuckets } {
  const safe = normalizeBuckets(buckets)
  const charge = nonNegative(amount)
  const allowanceRemaining = Math.max(0, safe.allowanceTotal - safe.allowanceUsed)
  const available = allowanceRemaining + safe.topUpBalance
  if (charge > available) throw new Error('insufficient_budget')
  const allowance = Math.min(charge, allowanceRemaining)
  const topUp = charge - allowance
  return {
    allocation: { allowance, topUp },
    buckets: {
      ...safe,
      allowanceUsed: safe.allowanceUsed + allowance,
      topUpBalance: safe.topUpBalance - topUp,
    },
  }
}

export function refundUsageAllocation(
  buckets: UsageBuckets,
  allocation: UsageAllocation,
  amount: number,
): { allocation: UsageAllocation; buckets: UsageBuckets } {
  const safe = normalizeBuckets(buckets)
  const original = normalizeAllocation(allocation)
  const refund = Math.min(nonNegative(amount), original.allowance + original.topUp)
  const topUp = Math.min(refund, original.topUp)
  const allowance = refund - topUp
  return {
    allocation: { allowance, topUp },
    buckets: {
      ...safe,
      allowanceUsed: Math.max(0, safe.allowanceUsed - allowance),
      topUpBalance: Math.min(safe.topUpPurchased, safe.topUpBalance + topUp),
    },
  }
}

export function inferRefundAllocation(buckets: UsageBuckets, amount: number): UsageAllocation {
  const safe = normalizeBuckets(buckets)
  const topUpUsed = Math.max(0, safe.topUpPurchased - safe.topUpBalance)
  const refund = Math.min(nonNegative(amount), safe.allowanceUsed + topUpUsed)
  const topUp = Math.min(refund, topUpUsed)
  return { allowance: refund - topUp, topUp }
}

export function availableUsageBalance(buckets: UsageBuckets, reserved = 0): number {
  const safe = normalizeBuckets(buckets)
  return Math.max(
    0,
    safe.allowanceTotal - safe.allowanceUsed + safe.topUpBalance - nonNegative(reserved),
  )
}

export function topUpBalanceAfterReservations(buckets: UsageBuckets, reserved = 0): number {
  const safe = normalizeBuckets(buckets)
  const allowanceRemaining = Math.max(0, safe.allowanceTotal - safe.allowanceUsed)
  const reservedTopUp = Math.max(0, nonNegative(reserved) - allowanceRemaining)
  return Math.max(0, safe.topUpBalance - reservedTopUp)
}

export function legacyUsageTotal(buckets: UsageBuckets): number {
  const safe = normalizeBuckets(buckets)
  return safe.allowanceUsed + (safe.topUpPurchased - safe.topUpBalance)
}

function normalizeBuckets(value: UsageBuckets): UsageBuckets {
  const topUpPurchased = nonNegative(value.topUpPurchased)
  return {
    allowanceTotal: nonNegative(value.allowanceTotal),
    allowanceUsed: nonNegative(value.allowanceUsed),
    topUpBalance: Math.min(nonNegative(value.topUpBalance), topUpPurchased),
    topUpPurchased,
  }
}

function normalizeAllocation(value: UsageAllocation): UsageAllocation {
  return { allowance: nonNegative(value.allowance), topUp: nonNegative(value.topUp) }
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Usage amount must be finite')
  return Math.max(0, value)
}
