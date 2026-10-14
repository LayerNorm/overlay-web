import assert from 'node:assert/strict'
import test from 'node:test'
import { describeWorkChange } from './work-analytics'

test('a change is named by what kind of change it is, and carries no task text', () => {
  assert.deepEqual(describeWorkChange({ status: 'done', title: 'Secret plan' }), { event: 'work_task_status_changed', properties: { status: 'done' } })
  assert.deepEqual(describeWorkChange({ dueDate: null }), { event: 'work_task_dates_changed', properties: {} })
  assert.deepEqual(describeWorkChange({ startDate: '2026-01-01', dueDate: '2026-01-02' }), { event: 'work_task_dates_changed', properties: {} })
  assert.deepEqual(describeWorkChange({ assigneePrincipalId: null }), { event: 'work_task_assigned', properties: { cleared: true } })
  assert.deepEqual(describeWorkChange({ assigneePrincipalId: 'p1' }), { event: 'work_task_assigned', properties: { cleared: false } })
  assert.deepEqual(describeWorkChange({ blockedBy: ['a', 'b'] }), { event: 'work_task_dependencies_changed', properties: { count: 2 } })
  assert.deepEqual(describeWorkChange({ title: 'Renamed', priority: 3 }), { event: 'work_task_updated', properties: { fields: ['priority', 'title'] } })
})
