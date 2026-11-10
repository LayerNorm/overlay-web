import assert from 'node:assert/strict'
import test from 'node:test'
import { assignmentWorkState, isOpenAssignment, matchesAssignmentQuery } from './assignment-state'

test('execution statuses map onto Work groups, glyphs and tags', () => {
  assert.deepEqual(assignmentWorkState({ status: 'running' }), { glyph: 'progress', group: 'progress', label: 'In progress' })
  assert.equal(assignmentWorkState({ status: 'queued' }).group, 'progress')
  assert.equal(assignmentWorkState({ status: 'publication_pending' }).group, 'progress')
  assert.equal(assignmentWorkState({ status: 'waiting_for_children' }).group, 'progress')
  assert.deepEqual(assignmentWorkState({ status: 'waiting_for_input' }), { glyph: 'review', group: 'review', label: 'Needs you', tag: { tone: 'attention', text: 'Needs you' } })
  assert.equal(assignmentWorkState({ status: 'waiting_for_approval' }).group, 'review')
  assert.deepEqual(assignmentWorkState({ status: 'completed', disposition: 'accepted' }), { glyph: 'done', group: 'done', label: 'Done' })
  assert.equal(assignmentWorkState({ status: 'completed', disposition: 'revision_requested' }).tag?.text, 'Revision requested')
  assert.deepEqual(assignmentWorkState({ status: 'failed', disposition: 'excluded' }), { glyph: 'failed', group: 'done', label: 'Failed', tag: { tone: 'danger', text: 'Failed' } })
  assert.deepEqual(assignmentWorkState({ status: 'cancelled' }), { glyph: 'backlog', group: 'done', label: 'Cancelled', tag: { tone: 'neutral', text: 'Cancelled' } })
})

test('only unfinished assignments count as open', () => {
  assert.equal(isOpenAssignment({ status: 'running' }), true)
  assert.equal(isOpenAssignment({ status: 'waiting_for_input' }), true)
  assert.equal(isOpenAssignment({ status: 'completed' }), false)
  assert.equal(isOpenAssignment({ status: 'failed' }), false)
  assert.equal(isOpenAssignment({ status: 'cancelled' }), false)
})

test('search matches titles and agent names, ignoring case and padding', () => {
  const item = { title: 'Identify launch blockers', agentName: 'Product' }
  assert.equal(matchesAssignmentQuery(item, ''), true)
  assert.equal(matchesAssignmentQuery(item, '  LAUNCH '), true)
  assert.equal(matchesAssignmentQuery(item, 'product'), true)
  assert.equal(matchesAssignmentQuery(item, 'sales'), false)
})
