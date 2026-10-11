import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
  formatWorkItemDay,
  formatWorkItemTimestamp,
  workItemKey,
  workItemStatusPillClass,
} from './work-item-ui'
import { WORK_ITEM_PRIORITIES, WORK_ITEM_STATUSES } from './work-items'

test('the UI option lists come from the shared status and priority lists', () => {
  assert.deepEqual(WORK_ITEM_STATUS_OPTIONS.map((o) => o.id), [...WORK_ITEM_STATUSES])
  assert.deepEqual([...WORK_ITEM_PRIORITY_OPTIONS.map((o) => o.id)].sort(), [...WORK_ITEM_PRIORITIES].sort())
  assert.equal(WORK_ITEM_PRIORITY_OPTIONS[0]?.id, 'urgent')
  assert.equal(WORK_ITEM_PRIORITY_OPTIONS.at(-1)?.id, 'none')
  assert.equal(workItemKey({ itemNumber: 7 }), 'OVR-7')
})

test('a due date shows the same day everywhere, a created time shows the viewer\'s day', () => {
  const utcMidnight = Date.UTC(2026, 9, 14)
  assert.equal(formatWorkItemDay(utcMidnight), 'Oct 14')
  assert.equal(formatWorkItemDay(undefined), '')
  // 11pm in Los Angeles on Oct 13 is already Oct 14 in UTC: the created date must stay Oct 13 for that viewer.
  const created = Date.UTC(2026, 9, 14, 6, 0)
  assert.equal(formatWorkItemTimestamp(created, 'America/Los_Angeles'), 'Oct 13')
  assert.equal(formatWorkItemTimestamp(created, 'UTC'), 'Oct 14')
  assert.equal(formatWorkItemTimestamp(undefined), '')
})

test('status pills take their text from the theme, not a fixed light or dark color', () => {
  for (const status of ['in_progress', 'in_review', 'done'] as const) {
    assert.match(workItemStatusPillClass(status), /var\(--foreground\)/)
  }
  assert.match(workItemStatusPillClass('todo'), /var\(--muted\)/)
})
