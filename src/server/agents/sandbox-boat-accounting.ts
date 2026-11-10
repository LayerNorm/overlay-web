import type { SandboxUsage } from '@overlay/sandbox-runtime'

export const BOAT_COMPUTE_PRICE = { version: 'boat-list-2026-10-20', secondsPerDollar: 100_000 } as const
export const SANDBOX_RUNTIME_FENCE_MS = 4 * 60_000
const COUNTER_STALL_MS = 2 * 60_000

type BoatPrice = { secondsPerDollar: number; billingMultiplier: number }
export type BoatMeterCursor = {
  billableSeconds: number
  dollars: number
  advancedAt: number
  price: BoatPrice
  running: boolean
}

export function meterBoatUsage(input: {
  previous?: BoatMeterCursor
  sample: SandboxUsage
  now: number
  stopped: boolean
  adopt?: boolean
}) {
  const current = boatSample(input.sample)
  if (!nonnegative(input.now)) throw new Error('SANDBOX_METER_TIME_INVALID')
  if (input.stopped && current.running) throw new Error('SANDBOX_USAGE_NOT_FINAL')
  const previous = input.adopt ? undefined : input.previous
  if (previous) validatePrevious(previous, current, input.now)
  const advanced = !previous || current.billableSeconds > previous.billableSeconds || (!previous.running && current.running)
  const advancedAt = advanced ? input.now : previous.advancedAt
  const unreportedMs = Math.max(0, input.now - advancedAt)
  // The live counter is authoritative: only its advance is charged. Elapsed time is never charged or held.
  const computeUsd = input.adopt ? 0 : current.dollars - (previous?.dollars ?? 0)
  const billableSeconds = input.adopt ? 0 : current.billableSeconds - (previous?.billableSeconds ?? 0)
  if (![computeUsd, billableSeconds].every(nonnegative)) throw new Error('SANDBOX_USAGE_OVERFLOW')
  const cursor: BoatMeterCursor = {
    billableSeconds: current.billableSeconds,
    dollars: current.dollars,
    advancedAt,
    price: current.price,
    running: current.running,
  }
  return {
    cursor, computeUsd, billableSeconds,
    stalled: current.running && unreportedMs >= COUNTER_STALL_MS,
  }
}

function boatSample(sample: SandboxUsage) {
  const metrics = sample.providerMetrics ?? {}
  const { secondsPerDollar, billingMultiplier, reportedUsd, running } = metrics
  if (!nonnegative(sample.wallTimeMs) || !nonnegative(reportedUsd)
    || !positive(secondsPerDollar) || !positive(billingMultiplier)
    || typeof running !== 'boolean' || metrics.authoritativeCounter !== true) {
    throw new Error('SANDBOX_BOAT_USAGE_INVALID')
  }
  return {
    billableSeconds: sample.wallTimeMs / 1_000,
    dollars: reportedUsd,
    running,
    price: { secondsPerDollar, billingMultiplier },
  }
}

function validatePrevious(previous: BoatMeterCursor, current: ReturnType<typeof boatSample>, now: number) {
  if (![previous.billableSeconds, previous.dollars, previous.advancedAt].every(nonnegative)
    || !positive(previous.price?.secondsPerDollar) || !positive(previous.price?.billingMultiplier)
    || typeof previous.running !== 'boolean'
    || previous.advancedAt > now) throw new Error('SANDBOX_BOAT_CURSOR_INVALID')
  if (current.price.secondsPerDollar !== previous.price.secondsPerDollar) throw new Error('SANDBOX_BOAT_PRICE_CHANGED')
  if (current.billableSeconds < previous.billableSeconds || current.dollars < previous.dollars) {
    throw new Error('SANDBOX_BOAT_COUNTER_REGRESSED')
  }
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function positive(value: unknown): value is number {
  return nonnegative(value) && value > 0
}
