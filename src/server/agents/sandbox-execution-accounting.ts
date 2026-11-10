import type { SandboxExecutionUsage } from '@overlay/sandbox-runtime'

export type ExecutionMeterCursor = Record<string, SandboxExecutionUsage & { settledWallTimeMs?: number }>

/** Rates are frozen with the cursor, never inferred from requested template resources. */
export const E2B_COMPUTE_PRICE = {
  version: 'e2b-list-2026-10-20',
  vcpuSecondUsd: 0.000014,
  gibSecondUsd: 0.0000045,
} as const

type ExecutionMeterPrice = { vcpuSecondUsd: number; gibSecondUsd: number }

/**
 * Charges observed compute only. A running generation is charged up to its observed wall time on every tick (E2B
 * bills a running sandbox by the second); its completion event settles any remainder. Nothing is held ahead of use.
 */
export function meterExecutionUsage(input: {
  previous: ExecutionMeterCursor
  samples: SandboxExecutionUsage[]
  price: ExecutionMeterPrice
  adopt?: boolean
  now?: number
  retiredBefore?: number
}): { cursor: ExecutionMeterCursor; durationMs: number; computeUsd: number; retiredBefore?: number } {
  if (![input.price.vcpuSecondUsd, input.price.gibSecondUsd].every(nonnegative)) {
    throw new Error('SANDBOX_PRICE_INVALID')
  }
  if (input.retiredBefore !== undefined && !nonnegative(input.retiredBefore)) throw new Error('SANDBOX_RETIREMENT_CURSOR_INVALID')
  const { cursor, durationMs, computeUsd } = settleExecutionSamples({
    previous: input.previous,
    samples: input.samples,
    price: input.price,
    adopt: input.adopt,
    retiredBefore: input.retiredBefore,
  })
  const retiredBefore = retireSettledExecutions({ cursor, samples: input.samples, now: input.now, retiredBefore: input.retiredBefore })
  if (![computeUsd, durationMs].every(Number.isFinite)) throw new Error('SANDBOX_USAGE_OVERFLOW')
  if (Object.keys(cursor).length > 2_000) throw new Error('SANDBOX_EXECUTION_CURSOR_LIMIT')
  return { cursor, durationMs, computeUsd, ...(retiredBefore === undefined ? {} : { retiredBefore }) }
}

function settleExecutionSamples(input: {
  previous: ExecutionMeterCursor
  samples: SandboxExecutionUsage[]
  price: ExecutionMeterPrice
  adopt?: boolean
  retiredBefore?: number
}): { cursor: ExecutionMeterCursor; durationMs: number; computeUsd: number } {
  const cursor: ExecutionMeterCursor = { ...input.previous }
  let durationMs = 0
  let computeUsd = 0
  for (const sample of input.samples) {
    validate(sample)
    if (input.retiredBefore !== undefined && sample.startedAt <= input.retiredBefore) throw new Error('SANDBOX_RETIRED_USAGE_REAPPEARED')
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
    const alreadySettledMs = previous?.settledWallTimeMs ?? 0
    // A final duration shorter than what live observations already charged is not refunded.
    const delta = input.adopt ? 0 : Math.max(0, sample.wallTimeMs - alreadySettledMs)
    durationMs += delta
    computeUsd += delta / 1_000 * (
      sample.resources.vcpus * input.price.vcpuSecondUsd
      + sample.resources.memoryGiB * input.price.gibSecondUsd
    )
    cursor[sample.id] = {
      ...sample, resources: { ...sample.resources },
      settledWallTimeMs: input.adopt ? sample.wallTimeMs : Math.max(alreadySettledMs, sample.wallTimeMs),
    }
  }
  return { cursor, durationMs, computeUsd }
}

/** Drops settled generations the provider stopped reporting beyond its event retention, behind a watermark. */
function retireSettledExecutions(input: {
  cursor: ExecutionMeterCursor
  samples: SandboxExecutionUsage[]
  now?: number
  retiredBefore?: number
}): number | undefined {
  let retiredBefore = input.retiredBefore
  const observed = new Set(input.samples.map((sample) => sample.id))
  const retirementCutoff = input.now === undefined ? -1 : Math.min(
    input.now - 8 * 24 * 60 * 60_000,
    ...input.samples.map((sample) => sample.startedAt),
    ...Object.values(input.cursor).filter((sample) => !sample.complete).map((sample) => sample.startedAt),
  )
  for (const execution of Object.values(input.cursor)) {
    if (execution.complete) {
      if (!observed.has(execution.id) && execution.startedAt < retirementCutoff) {
        delete input.cursor[execution.id]
        retiredBefore = Math.max(retiredBefore ?? 0, execution.startedAt)
      }
      continue
    }
    if (!observed.has(execution.id)) throw new Error('SANDBOX_EXECUTION_TAIL_MISSING')
  }
  return retiredBefore
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
