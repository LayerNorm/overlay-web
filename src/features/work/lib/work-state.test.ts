import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkItem } from '@overlay/app-core'
import { applyItemPatch, endRankOf, initialsOf, keyboardMove, neighborsForSlot, rankForDrop, removeItem, slotFromPointer, upsertItem } from './work-state'

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    workspaceId: 'ws', scope: 'personal', createdBy: 'me', title: overrides.id, description: null, status: 'todo', blocked: false,
    priority: 2, rank: 'M', assigneePrincipalId: null, reviewerUserId: null, startDate: null, dueDate: null, parentId: null,
    blockedBy: [], doneWhen: [], context: [], archivedAt: null, archivedFromScope: null, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

test('a patch changes what it names, null clears, and a new status goes to the end of its column', () => {
  const base = item({ id: 'a', assigneePrincipalId: 'p1', dueDate: '2026-10-14', description: 'old' })
  const patched = applyItemPatch(base, { title: '  New  ', assigneePrincipalId: null, dueDate: null, status: 'done' }, { now: 9, endRank: 'Z' })
  assert.equal(patched.title, 'New')
  assert.equal(patched.assigneePrincipalId, null)
  assert.equal(patched.dueDate, null)
  assert.equal(patched.status, 'done')
  assert.equal(patched.rank, 'Z')
  assert.equal(patched.description, 'old')
  assert.equal(patched.updatedAt, 9)
  // The original is untouched, and an unchanged status keeps its place.
  assert.equal(base.title, 'a')
  assert.equal(applyItemPatch(base, { status: 'todo' }, { now: 9, endRank: 'Z' }).rank, 'M')
})

test('end-of-column ranks sort after everything in that column', () => {
  const items = [item({ id: 'a', rank: 'F' }), item({ id: 'b', rank: 'T' }), item({ id: 'c', status: 'done', rank: 'a' })]
  assert.ok(endRankOf(items, 'todo') > 'T')
  assert.ok(endRankOf(items, 'backlog') > '')
  // The task being moved does not count as part of the column it is leaving.
  assert.ok(endRankOf(items, 'todo', 'b') > 'F')
})

test('dropping between two tasks gets a rank between them; with no usable neighbour it goes last', () => {
  const items = [item({ id: 'a', rank: 'F' }), item({ id: 'b', rank: 'T' }), item({ id: 'x', status: 'done', rank: 'M' })]
  const between = rankForDrop(items, { id: 'x', status: 'todo', afterId: 'a', beforeId: 'b' })
  assert.ok(between > 'F' && between < 'T')
  assert.ok(rankForDrop(items, { id: 'x', status: 'todo', beforeId: 'a' }) < 'F')
  assert.ok(rankForDrop(items, { id: 'x', status: 'todo', afterId: 'b' }) > 'T')
  assert.ok(rankForDrop(items, { id: 'x', status: 'todo' }) > 'T')
  // A neighbour in another column is ignored.
  assert.ok(rankForDrop(items, { id: 'a', status: 'done', afterId: 'b' }) > 'M')
})

test('upsert replaces by id or appends; remove drops by id', () => {
  const items = [item({ id: 'a' }), item({ id: 'b' })]
  assert.deepEqual(upsertItem(items, item({ id: 'b', title: 'B2' })).map((i) => i.title), ['a', 'B2'])
  assert.deepEqual(upsertItem(items, item({ id: 'c' })).map((i) => i.id), ['a', 'b', 'c'])
  assert.deepEqual(removeItem(items, 'a').map((i) => i.id), ['b'])
})

test('initials use the first and last word', () => {
  assert.equal(initialsOf('Divyansh Singh'), 'DS')
  assert.equal(initialsOf('sam'), 'S')
  assert.equal(initialsOf('Priya Q. Nair'), 'PN')
  assert.equal(initialsOf('  '), '?')
})

test('a dropped card lands between the cards above and below the slot', () => {
  const column = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(neighborsForSlot(column, 0), { afterId: null, beforeId: 'a' })
  assert.deepEqual(neighborsForSlot(column, 1), { afterId: 'a', beforeId: 'b' })
  assert.deepEqual(neighborsForSlot(column, 3), { afterId: 'c', beforeId: null })
  assert.deepEqual(neighborsForSlot(column, 99), { afterId: 'c', beforeId: null })
  assert.deepEqual(neighborsForSlot(column, -4), { afterId: null, beforeId: 'a' })
  assert.deepEqual(neighborsForSlot([], 0), { afterId: null, beforeId: null })
})

test('the slot under the pointer counts the cards whose centre is above it', () => {
  const mids = [40, 120, 200]
  assert.equal(slotFromPointer(mids, 10), 0)
  assert.equal(slotFromPointer(mids, 41), 1)
  assert.equal(slotFromPointer(mids, 130), 2)
  assert.equal(slotFromPointer(mids, 999), 3)
  assert.equal(slotFromPointer([], 50), 0)
  // Exactly on a centre counts as above it, so the card goes before.
  assert.equal(slotFromPointer(mids, 40), 0)
})

const COLUMNS = [
  { status: 'backlog' as const, items: [] },
  { status: 'todo' as const, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  { status: 'progress' as const, items: [{ id: 'd' }] },
  { status: 'review' as const, items: [] },
  { status: 'done' as const, items: [{ id: 'e' }] },
]

test('keyboard moves go up, down, left and right and stop at the edges', () => {
  assert.deepEqual(keyboardMove(COLUMNS, 'b', 'up'), { id: 'b', status: 'todo', afterId: null, beforeId: 'a', position: 0 })
  assert.deepEqual(keyboardMove(COLUMNS, 'b', 'down'), { id: 'b', status: 'todo', afterId: 'c', beforeId: null, position: 2 })
  assert.equal(keyboardMove(COLUMNS, 'a', 'up'), null)
  assert.equal(keyboardMove(COLUMNS, 'c', 'down'), null)
  // Right: same height in the next column, or its end when that is shorter.
  assert.deepEqual(keyboardMove(COLUMNS, 'a', 'right'), { id: 'a', status: 'progress', afterId: null, beforeId: 'd', position: 0 })
  assert.deepEqual(keyboardMove(COLUMNS, 'c', 'right'), { id: 'c', status: 'progress', afterId: 'd', beforeId: null, position: 1 })
  assert.deepEqual(keyboardMove(COLUMNS, 'd', 'right'), { id: 'd', status: 'review', afterId: null, beforeId: null, position: 0 })
  assert.deepEqual(keyboardMove(COLUMNS, 'b', 'left'), { id: 'b', status: 'backlog', afterId: null, beforeId: null, position: 0 })
  assert.equal(keyboardMove(COLUMNS, 'e', 'right'), null)
  assert.equal(keyboardMove(COLUMNS, 'e', 'down'), null)
  assert.equal(keyboardMove(COLUMNS, 'ghost', 'up'), null)
})
