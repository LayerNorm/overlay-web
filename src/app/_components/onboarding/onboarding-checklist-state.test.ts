import assert from 'node:assert/strict'
import test from 'node:test'
import { CHECKLIST_ITEMS, checklistVisible, parseChecklistState } from './onboarding-checklist-state'

test('the checklist has seven steps and starts hidden', () => {
  assert.equal(CHECKLIST_ITEMS.length, 7)
  assert.equal(checklistVisible(parseChecklistState(null)), false)
  assert.equal(checklistVisible(parseChecklistState('not json')), false)
})

test('the checklist shows once enabled, until dismissed or every step is done', () => {
  const enabled = parseChecklistState(JSON.stringify({ enabled: true, done: ['first-task', 'first-task', 'bogus'] }))
  assert.deepEqual(enabled.done, ['first-task'])
  assert.equal(checklistVisible(enabled), true)
  assert.equal(checklistVisible({ ...enabled, dismissed: true }), false)
  assert.equal(checklistVisible({ ...enabled, done: CHECKLIST_ITEMS.map((item) => item.id) }), false)
})
