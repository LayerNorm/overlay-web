import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeNextAutomationRunAt,
  normalizeAutomationSchedule,
} from './AutomationSchedule'

test('automation schedules normalize unsafe values', () => {
  assert.deepEqual(normalizeAutomationSchedule({ kind: 'interval', intervalMinutes: 2 }), {
    kind: 'interval',
    intervalMinutes: 15,
  })
  assert.deepEqual(normalizeAutomationSchedule({ kind: 'monthly', dayOfMonthUTC: 99 }), {
    kind: 'monthly',
    dayOfMonthUTC: 31,
    hourUTC: 9,
    minuteUTC: 0,
  })
})

test('automation schedule computes deterministic UTC occurrences', () => {
  const from = Date.UTC(2026, 0, 30, 10, 0)
  assert.equal(
    computeNextAutomationRunAt({ kind: 'daily', hourUTC: 9, minuteUTC: 30 }, from),
    Date.UTC(2026, 0, 31, 9, 30),
  )
  assert.equal(
    computeNextAutomationRunAt({ kind: 'monthly', dayOfMonthUTC: 31, hourUTC: 9 }, from),
    Date.UTC(2026, 0, 31, 9),
  )
  assert.equal(
    computeNextAutomationRunAt({ kind: 'monthly', dayOfMonthUTC: 31, hourUTC: 9 }, Date.UTC(2026, 0, 31, 10)),
    Date.UTC(2026, 1, 28, 9),
  )
})
