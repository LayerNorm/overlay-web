import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkItem } from '@overlay/app-core'
import { applyItemPatch, endRankOf, initialsOf, rankForDrop, removeItem, upsertItem } from './work-state'

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
