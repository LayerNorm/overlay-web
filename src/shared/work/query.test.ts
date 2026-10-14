import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkItem } from '@overlay/app-core'
import {
  assignedToViewer,
  columnsByStatus,
  countOpen,
  filterWork,
  groupByStatus,
  matchesQuery,
  needsViewer,
  parentIds,
  parentTitle,
  parseWorkFilter,
  reviewerOf,
} from './query'

const me = { userId: 'me', principalId: 'p-me' }

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    workspaceId: 'ws', scope: 'workspace', createdBy: 'other', title: overrides.id, description: null, status: 'todo', blocked: false,
    priority: 2, rank: 'M', assigneePrincipalId: null, reviewerUserId: null, startDate: null, dueDate: null, parentId: null,
    blockedBy: [], doneWhen: [], context: [], archivedAt: null, archivedFromScope: null, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

test('"needs you" is a task in review that you review, or a blocked task that is yours', () => {
  assert.ok(needsViewer(item({ id: 'a', status: 'review', reviewerUserId: 'me' }), me))
  // No reviewer named: the creator reviews.
  assert.ok(needsViewer(item({ id: 'b', status: 'review', createdBy: 'me' }), me))
  assert.ok(!needsViewer(item({ id: 'c', status: 'review', reviewerUserId: 'other' }), me))
  assert.ok(needsViewer(item({ id: 'd', status: 'progress', blocked: true, assigneePrincipalId: 'p-me' }), me))
  assert.ok(needsViewer(item({ id: 'e', status: 'progress', blocked: true, reviewerUserId: 'me' }), me))
  assert.ok(!needsViewer(item({ id: 'f', status: 'progress', blocked: true, assigneePrincipalId: 'p-other', reviewerUserId: 'other' }), me))
  assert.ok(!needsViewer(item({ id: 'g', status: 'done', reviewerUserId: 'me', blocked: true }), me))
  assert.ok(!needsViewer(item({ id: 'h', status: 'review', reviewerUserId: 'me', archivedAt: 5 }), me))
  assert.equal(reviewerOf(item({ id: 'x', createdBy: 'zed' })), 'zed')
})

test('"assigned to me" is assigned or reviewed by you', () => {
  assert.ok(assignedToViewer(item({ id: 'a', assigneePrincipalId: 'p-me' }), me))
  assert.ok(assignedToViewer(item({ id: 'b', reviewerUserId: 'me' }), me))
  assert.ok(!assignedToViewer(item({ id: 'c', createdBy: 'me' }), me))
})

test('search needs every word in the title or description, in any case', () => {
  const task = item({ id: 'a', title: 'Write the Launch post', description: 'About the pricing page' })
  assert.ok(matchesQuery(task, ''))
  assert.ok(matchesQuery(task, 'launch'))
  assert.ok(matchesQuery(task, 'POST pricing'))
  assert.ok(!matchesQuery(task, 'launch refund'))
})

test('filter and search combine; without a viewer the personal filters show nothing', () => {
  const items = [
    item({ id: 'a', title: 'Alpha', status: 'review', reviewerUserId: 'me' }),
    item({ id: 'b', title: 'Beta', assigneePrincipalId: 'p-me' }),
    item({ id: 'c', title: 'Gamma' }),
  ]
  assert.deepEqual(filterWork(items, { filter: 'all', query: '', viewer: me }).map((i) => i.id), ['a', 'b', 'c'])
  assert.deepEqual(filterWork(items, { filter: 'needs-you', query: '', viewer: me }).map((i) => i.id), ['a'])
  assert.deepEqual(filterWork(items, { filter: 'mine', query: '', viewer: me }).map((i) => i.id), ['a', 'b'])
  assert.deepEqual(filterWork(items, { filter: 'mine', query: 'beta', viewer: me }).map((i) => i.id), ['b'])
  assert.deepEqual(filterWork(items, { filter: 'mine', query: '', viewer: null }), [])
  assert.equal(parseWorkFilter('needs-you'), 'needs-you')
  assert.equal(parseWorkFilter('bogus'), 'all')
})

test('the list groups by status with attention first, in rank order, leaving out empty groups', () => {
  const items = [
    item({ id: 'done1', status: 'done', rank: 'A' }),
    item({ id: 'todo2', status: 'todo', rank: 'T' }),
    item({ id: 'todo1', status: 'todo', rank: 'F' }),
    item({ id: 'rev', status: 'review' }),
  ]
  const groups = groupByStatus(items)
  assert.deepEqual(groups.map((g) => g.status), ['review', 'todo', 'done'])
  assert.deepEqual(groups[1].items.map((i) => i.id), ['todo1', 'todo2'])
})

test('the board always has all five columns, left to right', () => {
  const columns = columnsByStatus([item({ id: 'a', status: 'progress' })])
  assert.deepEqual(columns.map((c) => c.status), ['backlog', 'todo', 'progress', 'review', 'done'])
  assert.deepEqual(columns.map((c) => c.items.length), [0, 0, 1, 0, 0])
})

test('open counts skip done and archived; parents resolve by id', () => {
  const objective = item({ id: 'obj', title: 'Objective' })
  const child = item({ id: 'kid', parentId: 'obj' })
  const orphan = item({ id: 'orphan', parentId: 'hidden' })
  assert.equal(countOpen([objective, child, item({ id: 'd', status: 'done' }), item({ id: 'x', archivedAt: 4 })]), 2)
  const byId = new Map([objective, child, orphan].map((i) => [i.id, i]))
  assert.equal(parentTitle(child, byId), 'Objective')
  assert.equal(parentTitle(orphan, byId), null)
  assert.equal(parentTitle(objective, byId), null)
  assert.deepEqual([...parentIds([objective, child, orphan])].sort(), ['hidden', 'obj'])
})
