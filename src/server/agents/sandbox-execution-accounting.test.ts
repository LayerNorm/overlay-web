import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxExecutionUsage } from '@overlay/sandbox-runtime'
import { E2B_COMPUTE_PRICE, meterExecutionUsage } from './sandbox-execution-accounting'

function sample(id: string, wallTimeMs: number, complete = false): SandboxExecutionUsage {
  return { id, startedAt: id === 'first' ? 0 : 100_000, wallTimeMs, complete, resources: { vcpus: 2, memoryGiB: 0.5 } }
}

test('meters separate execution generations, final tails, and duplicate events exactly once', () => {
  const price = E2B_COMPUTE_PRICE
  const first = meterExecutionUsage({ previous: {}, samples: [sample('first', 30_000)], price })
  const stopped = meterExecutionUsage({ previous: first.cursor, samples: [sample('first', 60_000, true)], price })
  const resumed = meterExecutionUsage({
    previous: stopped.cursor,
    samples: [sample('first', 60_000, true), sample('second', 20_000), sample('second', 20_000)], price,
  })
  // Observed running time is charged as it is seen; the completion event settles the remainder.
  assert.equal(first.durationMs, 30_000)
  assert.ok(Math.abs(first.computeUsd - 0.0009075) < 1e-12)
  assert.equal(stopped.durationMs, 30_000)
  assert.equal(resumed.durationMs, 20_000)
  assert.equal(first.durationMs + stopped.durationMs, 60_000)
  assert.ok(Math.abs(first.computeUsd + stopped.computeUsd - 0.001815) < 1e-12)
  assert.equal('pendingComputeUsd' in first, false)
  assert.equal('headroomComputeUsd' in first, false)
  const repeated = meterExecutionUsage({ previous: resumed.cursor, samples: [sample('first', 60_000, true), sample('second', 20_000)], price })
  assert.equal(repeated.computeUsd, 0)
  assert.deepEqual(repeated.cursor, resumed.cursor)
})

test('uses actual allocation and adopts legacy history without retroactive charges', () => {
  const actual = { ...sample('first', 3_600_000, true), resources: { vcpus: 4, memoryGiB: 8 } }
  const result = meterExecutionUsage({ previous: {}, samples: [actual], price: E2B_COMPUTE_PRICE })
  assert.ok(Math.abs(result.computeUsd - 0.3312) < 1e-12)
  const adopted = meterExecutionUsage({ previous: {}, samples: [actual], price: E2B_COMPUTE_PRICE, adopt: true })
  assert.equal(adopted.computeUsd, 0)
  assert.deepEqual(adopted.cursor.first, { ...actual, settledWallTimeMs: actual.wallTimeMs })
})

test('rejects inconsistent final evidence rather than silently charging or dropping a discrepancy', () => {
  const previous = { first: sample('first', 60_000) }
  for (const current of [
    { ...sample('first', 70_000), resources: { vcpus: 4, memoryGiB: 0.5 } },
    sample('first', Number.NaN),
  ]) {
    assert.throws(() => meterExecutionUsage({ previous, samples: [current], price: E2B_COMPUTE_PRICE }))
  }
  assert.equal(previous.first.wallTimeMs, 60_000)
  const stale = meterExecutionUsage({ previous, samples: [sample('first', 30_000)], price: E2B_COMPUTE_PRICE })
  assert.equal(stale.computeUsd, 0)
  assert.equal(stale.cursor.first.wallTimeMs, 60_000)
})

test('a final duration shorter than the observed live time charges nothing more and is not refunded', () => {
  const previous = meterExecutionUsage({ previous: {}, samples: [sample('first', 61_000)], price: E2B_COMPUTE_PRICE })
  const final = meterExecutionUsage({ previous: previous.cursor, samples: [sample('first', 60_000, true)], price: E2B_COMPUTE_PRICE })
  assert.equal(previous.durationMs, 61_000)
  assert.equal(final.durationMs, 0)
  assert.equal(final.computeUsd, 0)
  assert.equal(final.cursor.first.settledWallTimeMs, 61_000)
  assert.throws(() => meterExecutionUsage({ previous: previous.cursor, samples: [sample('second', 20_000)], price: E2B_COMPUTE_PRICE }), /TAIL_MISSING/)
})

test('retires absent settled history only beyond retention and refuses to bill a replay', () => {
  const now = 10 * 24 * 60 * 60_000
  const old = meterExecutionUsage({ previous: {}, samples: [sample('first', 60_000, true)], price: E2B_COMPUTE_PRICE })
  const recent = { ...sample('recent', 20_000), startedAt: now - 20_000 }
  const result = meterExecutionUsage({ previous: old.cursor, samples: [recent], price: E2B_COMPUTE_PRICE, now })
  assert.equal(result.retiredBefore, 0)
  assert.equal(result.cursor.first, undefined)
  // Only the recent generation's observed time is charged; the retired history charges nothing.
  assert.ok(Math.abs(result.computeUsd - 0.000605) < 1e-12)
  assert.throws(() => meterExecutionUsage({
    previous: result.cursor, samples: [sample('first', 60_000, true), recent], price: E2B_COMPUTE_PRICE, now, retiredBefore: result.retiredBefore,
  }), /RETIRED_USAGE_REAPPEARED/)
  const stillVisible = meterExecutionUsage({ previous: old.cursor, samples: [sample('first', 60_000, true), recent], price: E2B_COMPUTE_PRICE, now })
  assert.equal(stillVisible.retiredBefore, undefined)
  assert.ok(stillVisible.cursor.first)
})
