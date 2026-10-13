import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkItem } from '@overlay/app-core/work'
import { addDays, daysBetween, weekStart, shiftedSpan, barLayout, workSpan, timelineRows } from './timeline'
test('UTC calendar arithmetic crosses DST, month, year and leap boundaries', () => {
  assert.equal(addDays('2026-03-08', 1), '2026-03-09')
  assert.equal(addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2)
  assert.equal(weekStart('2026-10-13'), '2026-10-12')
  assert.throws(() => addDays('2026-02-30', 1))
})
test('bars include due date, clip to period and resize without inverted dates', () => {
  const span = { startDate: '2026-10-13', dueDate: '2026-10-15' }
  assert.deepEqual(barLayout(span, '2026-10-12', 14), { left: 28, width: 84 })
  assert.deepEqual(shiftedSpan(span, 'move', 2), { startDate: '2026-10-15', dueDate: '2026-10-17' })
  assert.deepEqual(shiftedSpan(span, 'start', 20), { startDate: '2026-10-15', dueDate: '2026-10-15' })
  assert.deepEqual(shiftedSpan(span, 'end', -20), { startDate: '2026-10-13', dueDate: '2026-10-13' })
  assert.equal(barLayout(span, '2027-01-01', 14), null)
})
test('objectives span child tasks and rows preserve one-level grouping', () => {
  const make = (id: string, fields: Partial<WorkItem> = {}): WorkItem => ({ _id: id, _creationTime: 1, userId: 'alice', workspaceId: 'ws', scope: 'personal', title: id, description: '', status: 'todo', priority: 2, blocked: false, rank: 'i', createdAt: 1, updatedAt: 1, ...fields })
  const objective = make('o'); const a = make('a', { parentId: 'o', startDate: '2026-10-01', dueDate: '2026-10-04' }); const b = make('b', { parentId: 'o', dueDate: '2026-10-09' })
  assert.deepEqual(workSpan(objective, [a, b]), { startDate: '2026-10-01', dueDate: '2026-10-09', objective: true })
  assert.deepEqual(timelineRows([a, objective, b]).map((row) => row._id), ['o', 'a', 'b'])
})
