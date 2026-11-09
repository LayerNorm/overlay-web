import assert from 'node:assert/strict'
import test from 'node:test'
import { hasThreadActivity, resolveThreadActivity, summarizeThreadActivity, type ThreadActivityStatus } from './thread-activity'

test('active work and actionable pauses use different indicators', () => {
  for (const status of ['queued', 'running', 'waiting_for_children']) {
    assert.equal(resolveThreadActivity({ status, updatedAt: 20 }, null), 'working')
  }
  for (const status of ['waiting_for_input', 'waiting_for_approval', 'waiting_for_authorization', 'waiting_for_resources']) {
    assert.equal(resolveThreadActivity({ status, updatedAt: 20 }, null), 'needs_input')
  }
})

test('activity filters keep actionable statuses and omit new, reviewed and cancelled threads', () => {
  for (const status of ['working', 'needs_input', 'ready', 'failed'] as const) assert.equal(hasThreadActivity(status), true)
  for (const status of ['idle', 'completed', 'cancelled'] as const) assert.equal(hasThreadActivity(status), false)
})

test('only unread completed responses are ready, including completions after an earlier read', () => {
  const run = { status: 'completed', completedAt: 20, updatedAt: 30 }
  assert.equal(resolveThreadActivity(run, null), 'ready')
  assert.equal(resolveThreadActivity(run, { lastReadAt: 19 }), 'ready')
  assert.equal(resolveThreadActivity(run, { lastReadAt: 20 }), 'completed')
  assert.equal(resolveThreadActivity(run, { lastReadAt: 40, markedUnreadAt: 50 }), 'ready')
  assert.equal(resolveThreadActivity({ status: 'completed', updatedAt: 20 }, { lastReadAt: 19 }), 'ready')
})

test('new, failed and cancelled threads never show success checks', () => {
  assert.equal(resolveThreadActivity(null, null), 'idle')
  assert.equal(resolveThreadActivity({ status: 'failed', updatedAt: 20 }, null), 'failed')
  assert.equal(resolveThreadActivity({ status: 'cancelled', updatedAt: 20 }, null), 'cancelled')
})

test('agent summaries count actionable states and omit idle or reviewed threads', () => {
  const statuses: ThreadActivityStatus[] = ['working', 'working', 'ready', 'needs_input', 'completed', 'idle', 'cancelled']
  assert.deepEqual(summarizeThreadActivity(statuses.map((status, i) => ({ conversationId: String(i), status })))
    .map(item => `${item.count} ${item.label}`), ['2 working', '1 ready', '1 needs you'])
  assert.deepEqual(summarizeThreadActivity([]), [])
})
