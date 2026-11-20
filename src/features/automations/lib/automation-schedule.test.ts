import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SCHEDULE_DRAFT, formatRunTime, scheduleDraftFromSchedule, scheduleFromDraft, scheduleLabel,
} from './automation-schedule'

test('local schedule fields round-trip without UTC fields', () => {
  for (const schedule of [
    { kind: 'interval', intervalMinutes: 60 },
    { kind: 'daily', hour: 7, minute: 30 },
    { kind: 'weekdays', hour: 9, minute: 0 },
    { kind: 'weekly', dayOfWeek: 0, hour: 18, minute: 5 },
    { kind: 'monthly', dayOfMonth: 15, hour: 8, minute: 0 },
  ] as const) {
    assert.deepEqual(scheduleFromDraft(scheduleDraftFromSchedule(schedule, 'America/Los_Angeles')), schedule)
  }
})

test('legacy UTC-only rows read in the automation time zone', () => {
  const draft = scheduleDraftFromSchedule({ kind: 'daily', hourUTC: 17, minuteUTC: 0 }, 'UTC')
  assert.equal(draft.time, '17:00')
  assert.equal(scheduleLabel(draft), 'Every day · 5:00 PM')
})

test('labels describe each schedule in plain words', () => {
  assert.equal(scheduleLabel(DEFAULT_SCHEDULE_DRAFT), 'Every weekday · 9:00 AM')
  assert.equal(scheduleLabel({ ...DEFAULT_SCHEDULE_DRAFT, frequency: 'weekly', weekday: 3 }), 'Every Wednesday · 9:00 AM')
  assert.equal(scheduleLabel({ ...DEFAULT_SCHEDULE_DRAFT, frequency: 'monthly', monthDay: 2 }), 'Monthly on the 2nd · 9:00 AM')
  assert.equal(scheduleLabel({ ...DEFAULT_SCHEDULE_DRAFT, frequency: 'interval', intervalMinutes: 60 }), 'Every hour')
  assert.equal(scheduleLabel({ ...DEFAULT_SCHEDULE_DRAFT, frequency: 'interval', intervalMinutes: 30 }), 'Every 30 minutes')
})

test('run times read relative to today', () => {
  const now = new Date(2026, 10, 18, 12, 0).getTime()
  assert.equal(formatRunTime(new Date(2026, 10, 18, 9, 0).getTime(), now), 'Today 9:00 AM')
  assert.equal(formatRunTime(new Date(2026, 10, 19, 14, 5).getTime(), now), 'Tomorrow 2:05 PM')
  assert.equal(formatRunTime(new Date(2026, 11, 1, 9, 0).getTime(), now), 'Dec 1, 9:00 AM')
})
