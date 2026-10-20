import type { SandboxExecutionUsage } from '@overlay/sandbox-runtime'

export type ExecutionMeterCursor = Record<string, SandboxExecutionUsage & { settledWallTimeMs?: number }>

/** Rates are frozen with the cursor, never inferred from requested template resources. */
export const E2B_COMPUTE_PRICE = {
  version: 'e2b-list-2026-10-20',
  vcpuSecondUsd: 0.000014,
  gibSecondUsd: 0.0000045,
} as const

export function meterExecutionUsage(input: {
  previous: ExecutionMeterCursor
  samples: SandboxExecutionUsage[]
  price: { vcpuSecondUsd: number; gibSecondUsd: number }
  adopt?: boolean
  now?: number
  retiredBefore?: number
}): { cursor: ExecutionMeterCursor; durationMs: number; computeUsd: number; pendingComputeUsd: number; headroomComputeUsd: number; retiredBefore?: number } {
  if (![input.price.vcpuSecondUsd, input.price.gibSecondUsd].every(nonnegative)) {
    throw new Error('SANDBOX_PRICE_INVALID')
  }
  const cursor: ExecutionMeterCursor = { ...input.previous }
  let retiredBefore = input.retiredBefore
  if (retiredBefore !== undefined && !nonnegative(retiredBefore)) throw new Error('SANDBOX_RETIREMENT_CURSOR_INVALID')
  let durationMs = 0
  let computeUsd = 0
  for (const sample of input.samples) {
    validate(sample)
    if (retiredBefore !== undefined && sample.startedAt <= retiredBefore) throw new Error('SANDBOX_RETIRED_USAGE_REAPPEARED')
    const previous = cursor[sample.id]
    if (previous) {
      validate(previous)
      if (sample.startedAt !== previous.startedAt
        || sample.resources.vcpus !== previous.resources.vcpus
        || sample.resources.memoryGiB !== previous.resources.memoryGiB) {
        throw new Error('SANDBOX_EXECUTION_IDENTITY_CHANGED')
      }
      if (previous.complete) {
        if (sample.complete && sample.wallTimeMs !== previous.wallTimeMs) {
          throw new Error('SANDBOX_COMPLETED_USAGE_CHANGED')
        }
        continue
      }
      if (!sample.complete && sample.wallTimeMs < previous.wallTimeMs) {
        continue
      }
    }
    const settledWallTimeMs = input.adopt ? sample.wallTimeMs : previous?.settledWallTimeMs ?? 0
    const delta = sample.complete ? Math.max(0, sample.wallTimeMs - settledWallTimeMs) : 0
    durationMs += delta
    computeUsd += delta / 1_000 * (
      sample.resources.vcpus * input.price.vcpuSecondUsd
      + sample.resources.memoryGiB * input.price.gibSecondUsd
    )
    cursor[sample.id] = { ...sample, resources: { ...sample.resources }, settledWallTimeMs: sample.complete ? sample.wallTimeMs : settledWallTimeMs }
  }
  let pendingComputeUsd = 0
  let headroomComputeUsd = 0
  const observed = new Set(input.samples.map((sample) => sample.id))
  const retirementCutoff = input.now === undefined ? -1 : Math.min(
    input.now - 8 * 24 * 60 * 60_000,
    ...input.samples.map((sample) => sample.startedAt),
    ...Object.values(cursor).filter((sample) => !sample.complete).map((sample) => sample.startedAt),
  )
  for (const execution of Object.values(cursor)) {
    if (execution.complete) {
      if (!observed.has(execution.id) && execution.startedAt < retirementCutoff) {
        delete cursor[execution.id]
        retiredBefore = Math.max(retiredBefore ?? 0, execution.startedAt)
      }
      continue
    }
    if (!observed.has(execution.id)) throw new Error('SANDBOX_EXECUTION_TAIL_MISSING')
    const perSecond = execution.resources.vcpus * input.price.vcpuSecondUsd
      + execution.resources.memoryGiB * input.price.gibSecondUsd
    pendingComputeUsd += Math.max(0, execution.wallTimeMs - (execution.settledWallTimeMs ?? 0)) / 1_000 * perSecond
    headroomComputeUsd += 300 * perSecond
  }
  if (![computeUsd, durationMs, pendingComputeUsd, headroomComputeUsd].every(Number.isFinite)) {
    throw new Error('SANDBOX_USAGE_OVERFLOW')
  }
  if (Object.keys(cursor).length > 2_000) throw new Error('SANDBOX_EXECUTION_CURSOR_LIMIT')
  return { cursor, durationMs, computeUsd, pendingComputeUsd, headroomComputeUsd, ...(retiredBefore === undefined ? {} : { retiredBefore }) }
}

function nonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function validate(sample: SandboxExecutionUsage): void {
  if (!sample.id || !nonnegative(sample.startedAt) || !nonnegative(sample.wallTimeMs)
    || typeof sample.complete !== 'boolean'
    || !Number.isFinite(sample.resources.vcpus) || sample.resources.vcpus <= 0
    || !Number.isFinite(sample.resources.memoryGiB) || sample.resources.memoryGiB <= 0) {
    throw new Error('SANDBOX_EXECUTION_USAGE_INVALID')
  }
}
