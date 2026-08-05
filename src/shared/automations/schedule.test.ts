import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeNextRunAt,
  normalizeSchedule,
  msUntilNextRun,
  DEFAULT_SCHEDULE,
  MIN_INTERVAL_MINUTES,
  type AutomationSchedule,
} from './schedule'

// ---------------------------------------------------------------------------
// computeNextRunAt
// ---------------------------------------------------------------------------

test('computeNextRunAt: interval schedule adds intervalMinutes to fromMs', () => {
  const schedule: AutomationSchedule = { kind: 'interval', intervalMinutes: 30 }
  const from = 1700000000000
  const next = computeNextRunAt(schedule, from)
  assert.equal(next, from + 30 * 60_000)
})

test('computeNextRunAt: interval schedule defaults to 60 minutes', () => {
  const schedule: AutomationSchedule = { kind: 'interval' }
  const from = 1700000000000
  const next = computeNextRunAt(schedule, from)
  assert.equal(next, from + 60 * 60_000)
})

test('computeNextRunAt: daily schedule returns today slot if still in the future', () => {
  // 2023-11-14T10:00:00Z → next daily at 14:00 UTC should be today at 14:00
  const from = Date.UTC(2023, 10, 14, 10, 0, 0)
  const schedule: AutomationSchedule = { kind: 'daily', hourUTC: 14, minuteUTC: 0 }
  const next = computeNextRunAt(schedule, from)
  assert.equal(next, Date.UTC(2023, 10, 14, 14, 0, 0))
})

test('computeNextRunAt: daily schedule returns tomorrow slot if today already passed', () => {
  // 2023-11-14T15:00:00Z → next daily at 14:00 UTC should be tomorrow at 14:00
  const from = Date.UTC(2023, 10, 14, 15, 0, 0)
  const schedule: AutomationSchedule = { kind: 'daily', hourUTC: 14, minuteUTC: 0 }
  const next = computeNextRunAt(schedule, from)
  assert.equal(next, Date.UTC(2023, 10, 15, 14, 0, 0))
})

test('computeNextRunAt: weekly schedule finds next matching day', () => {
  // 2023-11-14 is a Tuesday (day 2)
  // Next Monday (day 1) is 2023-11-20
  const from = Date.UTC(2023, 10, 14, 10, 0, 0)
  const schedule: AutomationSchedule = { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 9, minuteUTC: 0 }
  const next = computeNextRunAt(schedule, from)
  assert.equal(next, Date.UTC(2023, 10, 20, 9, 0, 0))
})

test('computeNextRunAt: weekly schedule with same day but past time goes to next week', () => {
  // 2023-11-13 is a Monday (day 1) at 10:00
  // Next Monday at 9:00 should be 2023-11-20
  const from = Date.UTC(2023, 10, 13, 10, 0, 0)
  const schedule: AutomationSchedule = { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 9, minuteUTC: 0 }
  const next = computeNextRunAt(schedule, from)
  assert.equal(next, Date.UTC(2023, 10, 20, 9, 0, 0))
})

test('computeNextRunAt: monthly schedule finds next matching day', () => {
  // 2023-11-14 → next monthly on day 15 at 9:00 UTC
  const from = Date.UTC(2023, 10, 14, 10, 0, 0)
  const schedule: AutomationSchedule = { kind: 'monthly', dayOfMonthUTC: 15, hourUTC: 9, minuteUTC: 0 }
  const next = computeNextRunAt(schedule, from)
  assert.equal(next, Date.UTC(2023, 10, 15, 9, 0, 0))
})

test('computeNextRunAt: monthly schedule skips to next month if day already passed', () => {
  // 2023-11-16 → day 15 already passed → next is Dec 15
  const from = Date.UTC(2023, 10, 16, 10, 0, 0)
  const schedule: AutomationSchedule = { kind: 'monthly', dayOfMonthUTC: 15, hourUTC: 9, minuteUTC: 0 }
  const next = computeNextRunAt(schedule, from)
  assert.equal(next, Date.UTC(2023, 11, 15, 9, 0, 0))
})

test('computeNextRunAt: monthly schedule handles months with fewer days', () => {
  // 2023-01-31 → day 31, Feb has 28 days → Feb 28 (clamped)
  const from = Date.UTC(2023, 0, 31, 10, 0, 0)
  const schedule: AutomationSchedule = { kind: 'monthly', dayOfMonthUTC: 31, hourUTC: 9, minuteUTC: 0 }
  const next = computeNextRunAt(schedule, from)
  // Jan 31 at 9:00 is before 10:00, so skip. Feb 28 at 9:00 is the next slot.
  assert.equal(next, Date.UTC(2023, 1, 28, 9, 0, 0))
})

// ---------------------------------------------------------------------------
// normalizeSchedule
// ---------------------------------------------------------------------------

test('normalizeSchedule: interval clamps below minimum to minimum', () => {
  const result = normalizeSchedule({ kind: 'interval', intervalMinutes: 5 })
  assert.equal(result.kind, 'interval')
  assert.equal((result as { intervalMinutes: number }).intervalMinutes, MIN_INTERVAL_MINUTES)
})

test('normalizeSchedule: interval defaults to 60 minutes when undefined', () => {
  const result = normalizeSchedule({ kind: 'interval' })
  assert.equal((result as { intervalMinutes: number }).intervalMinutes, 60)
})

test('normalizeSchedule: daily clamps hour to 0-23', () => {
  const result = normalizeSchedule({ kind: 'daily', hourUTC: 25 })
  assert.equal((result as { hourUTC: number }).hourUTC, 23) // clamped to max
})

test('normalizeSchedule: daily clamps minute to 0-59', () => {
  const result = normalizeSchedule({ kind: 'daily', minuteUTC: 70 })
  assert.equal((result as { minuteUTC: number }).minuteUTC, 59) // clamped to max
})

test('normalizeSchedule: weekly clamps dayOfWeek to 0-6', () => {
  const result = normalizeSchedule({ kind: 'weekly', dayOfWeekUTC: 10 })
  assert.equal((result as { dayOfWeekUTC: number }).dayOfWeekUTC, 6) // clamped to max
})

test('normalizeSchedule: monthly clamps dayOfMonth to 1-31', () => {
  const result = normalizeSchedule({ kind: 'monthly', dayOfMonthUTC: 0 })
  assert.equal((result as { dayOfMonthUTC: number }).dayOfMonthUTC, 1) // falls back
})

// ---------------------------------------------------------------------------
// msUntilNextRun
// ---------------------------------------------------------------------------

test('msUntilNextRun: returns positive duration for future runs', () => {
  const schedule: AutomationSchedule = { kind: 'interval', intervalMinutes: 60 }
  const ms = msUntilNextRun(schedule, Date.now())
  assert.ok(ms > 0)
  assert.ok(ms <= 60 * 60_000)
})

test('msUntilNextRun: clamps to minimum 1 second', () => {
  // Create a schedule that would compute to 0 or negative ms
  // interval with very small minutes still clamps to MIN_INTERVAL_MINUTES
  const schedule: AutomationSchedule = { kind: 'interval', intervalMinutes: 0 }
  const ms = msUntilNextRun(schedule, Date.now())
  assert.ok(ms >= 1_000)
})

test('msUntilNextRun: clamps to maximum 365 days', () => {
  // Monthly schedule could be up to ~31 days, which is fine
  // But verify the clamp works
  const schedule: AutomationSchedule = { kind: 'monthly', dayOfMonthUTC: 1, hourUTC: 0, minuteUTC: 0 }
  const ms = msUntilNextRun(schedule, Date.now())
  assert.ok(ms <= 365 * 24 * 60 * 60_000)
})

// ---------------------------------------------------------------------------
// DEFAULT_SCHEDULE
// ---------------------------------------------------------------------------

test('DEFAULT_SCHEDULE is daily at 14:00 UTC', () => {
  assert.equal(DEFAULT_SCHEDULE.kind, 'daily')
  assert.equal((DEFAULT_SCHEDULE as { hourUTC: number }).hourUTC, 14)
  assert.equal((DEFAULT_SCHEDULE as { minuteUTC: number }).minuteUTC, 0)
})
