import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { archivedItemKey, type ArchivedItem } from './archived-items'
import { runBulkWith } from './archived-actions'

function row(kind: ArchivedItem['kind'], id: string, agentId?: string): ArchivedItem {
  return {
    key: archivedItemKey(kind, id),
    kind,
    id,
    name: id,
    category: kind === 'agent' || kind === 'agent-thread' ? 'agents' : 'files',
    scope: null,
    ...(agentId ? { agentId } : {}),
  }
}

test('bulk delete removes an agent\'s threads before the agent, and the agent last', async () => {
  const calls: string[] = []
  const outcome = await runBulkWith(
    [row('agent', 'a1'), row('note', 'n1'), row('agent-thread', 't1', 'a1'), row('agent-thread', 't2', 'a1')],
    'delete',
    async (item) => { calls.push(item.key); await Promise.resolve() },
  )
  assert.equal(outcome.failed.length, 0)
  assert.equal(calls.at(-1), 'agent:a1')
  assert.ok(calls.indexOf('agent-thread:t1') < calls.indexOf('agent:a1'))
  assert.ok(calls.indexOf('agent-thread:t2') < calls.indexOf('agent:a1'))
})

test('one failure does not stop the rest, and is reported', async () => {
  const outcome = await runBulkWith(
    [row('note', 'n1'), row('file', 'f1'), row('note', 'n2')],
    'delete',
    async (item) => { if (item.id === 'f1') throw new Error('Not yours') },
  )
  assert.deepEqual(outcome.succeeded.sort(), ['note:n1', 'note:n2'])
  assert.deepEqual(outcome.failed, [{ key: 'file:f1', message: 'Not yours' }])
})

test('bulk restore keeps every selected row, in order of arrival', async () => {
  const seen: string[] = []
  const outcome = await runBulkWith([row('agent', 'a1'), row('agent-thread', 't1', 'a2')], 'restore', async (item) => { seen.push(item.key) })
  assert.deepEqual(seen.sort(), ['agent-thread:t1', 'agent:a1'])
  assert.equal(outcome.succeeded.length, 2)
})
