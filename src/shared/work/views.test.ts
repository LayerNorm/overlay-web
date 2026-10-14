import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_WORK_VIEW, WORK_VIEWS, parseWorkView, resolveWorkView } from './views'

test('work views parse only the three known views and default to the list', () => {
  assert.deepEqual([...WORK_VIEWS], ['list', 'board', 'timeline'])
  assert.equal(parseWorkView('board'), 'board')
  assert.equal(parseWorkView('gantt'), null)
  assert.equal(parseWorkView(null), null)
  assert.equal(resolveWorkView('timeline'), 'timeline')
  assert.equal(resolveWorkView('nope'), DEFAULT_WORK_VIEW)
  assert.equal(resolveWorkView(undefined), 'list')
})
