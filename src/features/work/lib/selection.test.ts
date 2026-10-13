import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkItem } from '@overlay/app-core/work'
import { selectWork, groupWork } from './selection'
const task = (id: string, patch: Partial<WorkItem> = {}): WorkItem => ({
  _id: id,
  _creationTime: 1,
  userId: 'alice',
  workspaceId: 'ws-1',
  scope: 'personal',
  title: id,
  description: '',
  status: 'todo',
  blocked: false,
  priority: 2,
  rank: 'i',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

test('Needs you separates reviewer work and blocked ownership from ordinary assignments', () => {
  const items = [
    task('review', { status: 'review', reviewerUserId: 'alice' }),
    task('blocked', { blocked: true, assigneePrincipalId: 'p-alice' }),
    task('assigned', { assigneePrincipalId: 'p-alice' }),
    task('other-review', { status: 'review', reviewerUserId: 'bob' }),
  ]
  assert.deepEqual(
    selectWork(items, {
      query: '',
      filter: 'needs-you',
      userId: 'alice',
      principalId: 'p-alice',
    }).map((r) => r._id),
    ['review', 'blocked'],
  )
  assert.deepEqual(
    selectWork(items, {
      query: '',
      filter: 'assigned',
      userId: 'alice',
      principalId: 'p-alice',
    }).map((r) => r._id),
    ['blocked', 'assigned'],
  )
  assert.deepEqual(selectWork(items, { query: '', filter: 'assigned', userId: 'alice' }), [])
})
test('search and ownership filters compose without changing the source list', () => {
  const items = [
    task('Release', { assigneePrincipalId: 'p-alice', description: 'Check the candidate' }),
    task('Draft', { description: 'Release brief', assigneePrincipalId: 'p-bob' }),
  ]
  assert.deepEqual(
    selectWork(items, { query: '  CANDIDATE ', filter: 'all', userId: 'alice' }).map((r) => r._id),
    ['Release'],
  )
  assert.deepEqual(
    selectWork(items, {
      query: 'release',
      filter: 'assigned',
      userId: 'alice',
      principalId: 'p-alice',
    }).map((r) => r._id),
    ['Release'],
  )
  assert.equal(items.length, 2)
})
test('groups retain fixed workflow order and lexical task ordering', () => {
  const items = [
    task('done', { status: 'done' }),
    task('later', { rank: 'z' }),
    task('earlier', { rank: 'a' }),
  ]
  const groups = groupWork(items)
  assert.deepEqual(
    groups.map((g) => g.status),
    ['backlog', 'todo', 'progress', 'review', 'done'],
  )
  assert.deepEqual(
    groups[1].items.map((r) => r._id),
    ['earlier', 'later'],
  )
  assert.deepEqual(
    items.map((r) => r._id),
    ['done', 'later', 'earlier'],
  )
})
