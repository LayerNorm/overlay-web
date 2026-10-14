import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkDate, parseWorkPriority, parseWorkStatus, validateWorkDates, validateWorkTitle } from './status'

test('statuses and priorities parse only known values', () => {
  assert.equal(parseWorkStatus('progress'), 'progress')
  assert.equal(parseWorkStatus('canceled'), undefined)
  assert.equal(parseWorkPriority(3), 3)
  assert.equal(parseWorkPriority(4), undefined)
  assert.equal(parseWorkPriority('3'), undefined)
})

test('dates are real calendar days', () => {
  assert.ok(isWorkDate('2026-02-28'))
  assert.ok(isWorkDate('2028-02-29'))
  assert.ok(!isWorkDate('2026-02-29'))
  assert.ok(!isWorkDate('2026-13-01'))
  assert.ok(!isWorkDate('2026-1-1'))
  assert.ok(!isWorkDate(20260101))
})

test('date and title validation return a plain message or null', () => {
  assert.equal(validateWorkDates('2026-03-01', '2026-03-01'), null)
  assert.equal(validateWorkDates(null, '2026-03-01'), null)
  assert.match(validateWorkDates('2026-03-02', '2026-03-01') ?? '', /on or before/)
  assert.match(validateWorkDates('nope', null) ?? '', /start date/)
  assert.equal(validateWorkTitle(' Ship it '), null)
  assert.match(validateWorkTitle('   ') ?? '', /title/)
  assert.match(validateWorkTitle('x'.repeat(201)) ?? '', /200/)
})
