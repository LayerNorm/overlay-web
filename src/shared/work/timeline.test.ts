import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkItem } from '@overlay/app-core'
import { applyDrag, barLayout, buildTimelineRows, dayAtX, timelineRange, unionSpan, weekColumns } from './timeline'

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    workspaceId: 'ws', scope: 'workspace', createdBy: 'me', title: overrides.id, description: null, status: 'todo', blocked: false,
    priority: 2, rank: 'M', assigneePrincipalId: null, reviewerUserId: null, startDate: null, dueDate: null, parentId: null,
    blockedBy: [], doneWhen: [], context: [], archivedAt: null, archivedFromScope: null, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

test('an objective covers its earliest task to its latest, and rows group under it by start date', () => {
  const rows = buildTimelineRows([
    item({ id: 'obj', title: 'Objective', startDate: '2026-10-01', dueDate: '2026-10-02', rank: 'A' }),
    item({ id: 'late', parentId: 'obj', startDate: '2026-10-10', dueDate: '2026-10-14' }),
    item({ id: 'early', parentId: 'obj', startDate: '2026-10-05', dueDate: '2026-10-08' }),
    item({ id: 'solo', startDate: '2026-09-20', dueDate: '2026-09-22', rank: 'B' }),
    item({ id: 'nodates', rank: 'C' }),
  ])
  assert.deepEqual(rows.map((row) => `${row.kind}:${row.item.id}`), ['task:solo', 'objective:obj', 'task:early', 'task:late', 'task:nodates'])
  const objective = rows.find((row) => row.kind === 'objective')!
  assert.deepEqual(objective.span, { start: '2026-10-05', end: '2026-10-14' })
  assert.equal(objective.kind === 'objective' && objective.childCount, 2)
  assert.equal(rows.find((row) => row.item.id === 'early')!.kind === 'task' && (rows.find((row) => row.item.id === 'early') as { indented: boolean }).indented, true)
})

test('an objective with undated tasks falls back to its own dates; a task whose parent is not shown is a plain row', () => {
  const rows = buildTimelineRows([
    item({ id: 'obj', startDate: '2026-10-01', dueDate: '2026-10-09' }),
    item({ id: 'kid', parentId: 'obj' }),
    item({ id: 'orphan', parentId: 'hidden', startDate: '2026-10-03', dueDate: '2026-10-04' }),
  ])
  assert.deepEqual(rows[0].span, { start: '2026-10-01', end: '2026-10-09' })
  assert.deepEqual(rows.map((row) => row.item.id), ['obj', 'kid', 'orphan'])
  assert.equal(unionSpan([null, null]), null)
})

test('the range is at least eight whole weeks, starts on a Monday, and always includes today and every bar', () => {
  const today = '2026-10-14'
  const empty = timelineRange([], today)
  assert.equal(empty.start, '2026-10-05')
  assert.equal(empty.days % 7, 0)
  assert.ok(empty.days >= 56)
  const rows = buildTimelineRows([item({ id: 'a', startDate: '2026-08-01', dueDate: '2026-12-31' })])
  const range = timelineRange(rows, today)
  assert.equal(range.start, '2026-07-20')
  const end = barLayout({ start: '2026-12-31', end: '2026-12-31' }, range)
  assert.ok(end.left + end.width <= range.days * 24)
})

test('a bar starts at its first day and covers its last day', () => {
  const range = { start: '2026-10-05', days: 56 }
  assert.deepEqual(barLayout({ start: '2026-10-05', end: '2026-10-05' }, range), { left: 0, width: 24 })
  assert.deepEqual(barLayout({ start: '2026-10-07', end: '2026-10-10' }, range), { left: 48, width: 96 })
  assert.deepEqual(barLayout({ start: '2026-10-07', end: '2026-10-10' }, range, 10), { left: 20, width: 40 })
  assert.equal(dayAtX(0, range), '2026-10-05')
  assert.equal(dayAtX(47, range), '2026-10-06')
  assert.equal(dayAtX(48, range), '2026-10-07')
})

test('dragging moves a bar or one end, and an end never passes the other', () => {
  const span = { start: '2026-10-10', end: '2026-10-14' }
  assert.deepEqual(applyDrag(span, 'move', 3), { start: '2026-10-13', end: '2026-10-17' })
  assert.deepEqual(applyDrag(span, 'move', -10), { start: '2026-09-30', end: '2026-10-04' })
  assert.deepEqual(applyDrag(span, 'end', 4), { start: '2026-10-10', end: '2026-10-18' })
  assert.deepEqual(applyDrag(span, 'end', -9), { start: '2026-10-10', end: '2026-10-10' })
  assert.deepEqual(applyDrag(span, 'start', -2), { start: '2026-10-08', end: '2026-10-14' })
  assert.deepEqual(applyDrag(span, 'start', 20), { start: '2026-10-14', end: '2026-10-14' })
  assert.deepEqual(applyDrag(span, 'move', 0), span)
})

test('week headers tile the range exactly', () => {
  const range = { start: '2026-10-05', days: 21 }
  const weeks = weekColumns(range)
  assert.deepEqual(weeks.map((week) => week.start), ['2026-10-05', '2026-10-12', '2026-10-19'])
  assert.deepEqual(weeks.map((week) => [week.left, week.width]), [[0, 168], [168, 168], [336, 168]])
})
