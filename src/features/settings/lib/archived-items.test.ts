import assert from 'node:assert/strict'
import test from 'node:test'
import {
  archivedItemKey,
  filterArchivedItems,
  orderForDelete,
  pruneSelection,
  summarizeBulk,
  type ArchivedItem,
} from './archived-items'

function item(partial: Partial<ArchivedItem> & Pick<ArchivedItem, 'kind' | 'id' | 'name'>): ArchivedItem {
  const category = partial.kind === 'chat' ? 'chats'
    : partial.kind === 'agent' || partial.kind === 'agent-thread' ? 'agents'
      : partial.kind === 'skill' || partial.kind === 'mcp-server' ? 'extensions'
        : partial.kind === 'automation' ? 'automations' : 'files'
  return { key: archivedItemKey(partial.kind, partial.id), category, scope: null, ...partial }
}

const ITEMS = [
  item({ kind: 'chat', id: 'c1', name: 'Launch plan', archivedAt: 5 }),
  item({ kind: 'note', id: 'n1', name: 'Pricing notes', archivedAt: 9, scope: 'workspace' }),
  item({ kind: 'agent', id: 'a1', name: 'Researcher', archivedAt: 7, scope: 'personal' }),
  item({ kind: 'agent-thread', id: 't1', name: 'Q3 research', detail: 'Thread with Analyst', archivedAt: 8, agentId: 'a2' }),
  item({ kind: 'skill', id: 's1', name: 'Summarise', detail: 'Short summaries', archivedAt: 1 }),
]

test('the dropdown narrows to one kind and "All" shows everything, newest archived first', () => {
  assert.deepEqual(filterArchivedItems(ITEMS, 'all', '').map((row) => row.id), ['n1', 't1', 'a1', 'c1', 's1'])
  assert.deepEqual(filterArchivedItems(ITEMS, 'agents', '').map((row) => row.id), ['t1', 'a1'])
  assert.deepEqual(filterArchivedItems(ITEMS, 'files', '').map((row) => row.id), ['n1'])
  assert.deepEqual(filterArchivedItems(ITEMS, 'automations', ''), [])
})

test('search matches the name, the second line, and the kind, and combines with the dropdown', () => {
  assert.deepEqual(filterArchivedItems(ITEMS, 'all', 'pricing').map((row) => row.id), ['n1'])
  assert.deepEqual(filterArchivedItems(ITEMS, 'all', 'analyst').map((row) => row.id), ['t1'])
  assert.deepEqual(filterArchivedItems(ITEMS, 'all', 'agent thread').map((row) => row.id), ['t1'])
  assert.deepEqual(filterArchivedItems(ITEMS, 'agents', 'research').map((row) => row.id), ['t1', 'a1'])
  assert.deepEqual(filterArchivedItems(ITEMS, 'files', 'research'), [])
})

test('an agent and one of its threads are different rows even if they share an id', () => {
  assert.notEqual(archivedItemKey('agent', 'x'), archivedItemKey('agent-thread', 'x'))
})

test('deleting puts threads before everything else and agents last', () => {
  const ordered = orderForDelete([
    item({ kind: 'agent', id: 'a1', name: 'A' }),
    item({ kind: 'note', id: 'n1', name: 'N' }),
    item({ kind: 'agent-thread', id: 't1', name: 'T', agentId: 'a1' }),
  ])
  assert.deepEqual(ordered.map((row) => row.kind), ['agent-thread', 'note', 'agent'])
})

test('the bulk summary says what happened, including partial failure', () => {
  assert.equal(summarizeBulk('deleted', { succeeded: ['a'], failed: [] }), '1 item deleted.')
  assert.equal(summarizeBulk('restored', { succeeded: ['a', 'b'], failed: [] }), '2 items restored.')
  assert.match(summarizeBulk('deleted', { succeeded: [], failed: [{ key: 'a', message: 'x' }] }), /Could not change 1 item/)
  assert.match(summarizeBulk('deleted', { succeeded: ['a'], failed: [{ key: 'b', message: 'x' }, { key: 'c', message: 'y' }] }), /1 item deleted\. 2 items could not be changed/)
})

test('items that left the list drop out of the selection', () => {
  const kept = pruneSelection(new Set([ITEMS[0]!.key, 'chat:gone']), ITEMS)
  assert.deepEqual([...kept], [ITEMS[0]!.key])
})
