import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxUsage } from '@overlay/sandbox-runtime'
import { meterBoatUsage } from './sandbox-boat-accounting'

function sample(seconds: number, running = true, multiplier = 2): SandboxUsage {
  return { wallTimeMs: seconds * 1_000, providerMetrics: {
    authoritativeCounter: true, reportedUsd: seconds / 100_000,
    secondsPerDollar: 100_000, billingMultiplier: multiplier, running,
  } }
}

test('Boat charges weighted provider counters once and never charges or holds stalled time', () => {
  const first = meterBoatUsage({ sample: sample(120), now: 1_000_000, stopped: false })
  assert.equal(first.computeUsd, 0.0012)
  assert.equal(first.billableSeconds, 120)
  const stalled = meterBoatUsage({ previous: first.cursor, sample: sample(120), now: 1_120_000, stopped: false })
  assert.equal(stalled.computeUsd, 0)
  assert.equal(stalled.stalled, true)
  const final = meterBoatUsage({ previous: stalled.cursor, sample: sample(420, false), now: 1_150_000, stopped: true })
  assert.ok(Math.abs(final.computeUsd - 0.003) < 1e-12)
  assert.equal(final.stalled, false)
  const duplicate = meterBoatUsage({ previous: final.cursor, sample: sample(420, false), now: 1_160_000, stopped: true })
  assert.equal(duplicate.computeUsd, 0)
})

test('Boat adopts legacy history without retroactive billing and resets stall age on progress', () => {
  const adopted = meterBoatUsage({ sample: sample(1_000), now: 1_000, stopped: false, adopt: true })
  assert.equal(adopted.computeUsd, 0)
  const next = meterBoatUsage({ previous: adopted.cursor, sample: sample(1_120), now: 61_000, stopped: false })
  assert.ok(Math.abs(next.computeUsd - 0.0012) < 1e-12)
  assert.equal(next.cursor.advancedAt, 61_000)
  assert.equal(next.stalled, false)
})

test('Boat refuses counter regressions, price changes, malformed evidence and nonfinal stop readings', () => {
  const first = meterBoatUsage({ sample: sample(120), now: 1_000, stopped: false })
  assert.throws(() => meterBoatUsage({ previous: first.cursor, sample: sample(119), now: 2_000, stopped: false }), /COUNTER_REGRESSED/)
  const changed = sample(150)
  changed.providerMetrics!.secondsPerDollar = 90_000
  assert.throws(() => meterBoatUsage({ previous: first.cursor, sample: changed, now: 2_000, stopped: false }), /PRICE_CHANGED/)
  assert.throws(() => meterBoatUsage({ sample: { wallTimeMs: 0 }, now: 2_000, stopped: false }), /USAGE_INVALID/)
  assert.throws(() => meterBoatUsage({ sample: sample(150), now: 2_000, stopped: true }), /NOT_FINAL/)
  assert.throws(() => meterBoatUsage({ sample: sample(150), now: Number.NaN, stopped: false }), /TIME_INVALID/)
})

test('Boat excludes paused time and resets stall age when a stopped machine resumes', () => {
  const paused = meterBoatUsage({ sample: sample(120, false), now: 1_000, stopped: true })
  const resumed = meterBoatUsage({ previous: paused.cursor, sample: sample(120), now: 10_000_000, stopped: false })
  assert.equal(resumed.computeUsd, 0)
  assert.equal(resumed.stalled, false)
  assert.equal('holdUsd' in resumed, false)
  const advanced = meterBoatUsage({ previous: resumed.cursor, sample: sample(130, true, 0.5), now: 10_070_000, stopped: false })
  assert.ok(Math.abs(advanced.computeUsd - 0.0001) < 1e-12)
})
