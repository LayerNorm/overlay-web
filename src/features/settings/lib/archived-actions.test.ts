import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { archivedItemKey, type ArchivedItem } from './archived-items'
import type { WorkItem } from '@overlay/app-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { deleteArchivedItem, loadArchivedWork, restoreArchivedItem, runBulkWith } from './archived-actions'

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

function task(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    workspaceId: 'ws', scope: 'workspace', createdBy: 'me', title: overrides.id, description: null, status: 'todo', blocked: false,
    priority: 2, rank: 'M', assigneePrincipalId: null, reviewerUserId: null, startDate: null, dueDate: null, parentId: null,
    blockedBy: [], doneWhen: [], context: [], archivedAt: 10, archivedFromScope: 'workspace', createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

test('archived tasks are listed once: a subtask archived with its parent shows only under the parent', async (t) => {
  t.mock.method(overlayAppClient.work, 'list', async (query?: { view?: string }) => {
    assert.equal(query?.view, 'archived')
    return {
      items: [
        task({ id: 'objective', title: 'Launch', archivedAt: 10 }),
        task({ id: 'child', title: 'Post', parentId: 'objective', archivedAt: 10 }),
        // Archived on its own earlier, so it keeps its own row.
        task({ id: 'earlier', title: 'Earlier child', parentId: 'objective', archivedAt: 4, archivedFromScope: 'personal' }),
        task({ id: 'orphan', title: 'Orphan', parentId: 'gone', archivedAt: 7 }),
      ],
    }
  })
  const items = await loadArchivedWork()
  assert.deepEqual(items.map((entry) => entry.id), ['objective', 'earlier', 'orphan'])
  assert.deepEqual(items.map((entry) => [entry.kind, entry.category]), [['work-item', 'work'], ['work-item', 'work'], ['work-item', 'work']])
  assert.equal(items[1]!.scope, 'personal')
  assert.equal(items[0]!.archivedAt, 10)
})

test('restoring a task puts it back through the scope route; deleting removes it for good; both refresh the Work views', async (t) => {
  const events: string[] = []
  const target = new EventTarget()
  ;(globalThis as { window?: unknown }).window = target
  t.after(() => { delete (globalThis as { window?: unknown }).window })
  target.addEventListener('overlay:work-updated', () => events.push('work-updated'))
  const calls: string[] = []
  t.mock.method(overlayAppClient.scope, 'restore', async (resource: string, id: string) => { calls.push(`restore ${resource} ${id}`); return { success: true } })
  t.mock.method(overlayAppClient.work, 'remove', async (id: string) => { calls.push(`remove ${id}`); return { success: true } })
  const entry: ArchivedItem = { key: 'work-item:w1', kind: 'work-item', category: 'work', id: 'w1', name: 'Launch', scope: 'workspace' }
  await restoreArchivedItem(entry, 'ws')
  await deleteArchivedItem(entry, 'ws')
  assert.deepEqual(calls, ['restore work w1', 'remove w1'])
  assert.deepEqual(events, ['work-updated', 'work-updated'])
})
