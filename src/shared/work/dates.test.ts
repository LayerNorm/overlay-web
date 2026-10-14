import assert from 'node:assert/strict'
import test from 'node:test'
import { addDays, clampDate, diffDays, dueTone, formatWorkDate, formatWorkDateRange, startOfWeek, taskSpan, toWorkDate } from './dates'

test('day arithmetic is exact across month ends, leap days, and daylight-saving changes', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(diffDays('2026-03-07', '2026-03-09'), 2)
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2)
  assert.equal(diffDays('2026-10-31', '2026-11-02'), 2)
  assert.equal(diffDays('2026-03-10', '2026-03-01'), -9)
  assert.equal(diffDays('2026-01-01', '2027-01-01'), 365)
})

test('today is the viewer\'s own calendar day', () => {
  assert.equal(toWorkDate(new Date(2026, 9, 14, 23, 59)), '2026-10-14')
  assert.equal(toWorkDate(new Date(2026, 0, 5, 0, 1)), '2026-01-05')
})

test('weeks start on Monday', () => {
  assert.equal(startOfWeek('2026-10-14'), '2026-10-12')
  assert.equal(startOfWeek('2026-10-12'), '2026-10-12')
  assert.equal(startOfWeek('2026-10-11'), '2026-10-05')
  assert.equal(startOfWeek('2026-01-01'), '2025-12-29')
})

test('dates read as short labels, with the year only when it differs', () => {
  assert.equal(formatWorkDate('2026-10-14'), 'Oct 14')
  assert.equal(formatWorkDate('2026-10-14', '2026-02-01'), 'Oct 14')
  assert.equal(formatWorkDate('2027-01-05', '2026-12-30'), 'Jan 5, 2027')
  assert.equal(formatWorkDateRange('2026-10-01', '2026-10-14'), 'Oct 1 to Oct 14')
  assert.equal(formatWorkDateRange('2026-10-01', '2026-10-01'), 'Oct 1')
  assert.equal(formatWorkDateRange(null, '2026-10-14'), 'Due Oct 14')
  assert.equal(formatWorkDateRange('2026-10-01', null), 'Starts Oct 1')
  assert.equal(formatWorkDateRange(null, null), '')
})

test('due dates are overdue, soon (within three days), later, or neutral', () => {
  const today = '2026-10-14'
  assert.equal(dueTone('2026-10-13', false, today), 'overdue')
  assert.equal(dueTone('2026-10-14', false, today), 'soon')
  assert.equal(dueTone('2026-10-17', false, today), 'soon')
  assert.equal(dueTone('2026-10-18', false, today), 'later')
  assert.equal(dueTone('2026-10-13', true, today), 'none')
  assert.equal(dueTone(null, false, today), 'none')
})

test('a task occupies the days between its start and due date, or the one day it has', () => {
  assert.deepEqual(taskSpan('2026-10-01', '2026-10-05'), { start: '2026-10-01', end: '2026-10-05' })
  assert.deepEqual(taskSpan(null, '2026-10-05'), { start: '2026-10-05', end: '2026-10-05' })
  assert.deepEqual(taskSpan('2026-10-01', null), { start: '2026-10-01', end: '2026-10-01' })
  assert.equal(taskSpan(null, null), null)
  assert.equal(clampDate('2026-10-20', '2026-10-01', '2026-10-10'), '2026-10-10')
  assert.equal(clampDate('2026-09-20', '2026-10-01', '2026-10-10'), '2026-10-01')
})
