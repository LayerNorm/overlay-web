import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkItem } from '@overlay/app-core/work'
import { workPlacement } from './placement'
const task = (id: string, rank: string, scope: 'personal' | 'workspace' = 'personal'): WorkItem => ({ _id: id, _creationTime: 1, userId: 'alice', workspaceId: 'ws', scope, title: id, description: '', status: 'todo', blocked: false, priority: 2, rank, createdAt: 1, updatedAt: 1 })
test('board placements cover first, middle, last and scope isolation', () => {
  const moving = task('m', 'i'); const rows = [task('a', 'a'), moving, task('z', 'z'), task('shared', 'b', 'workspace')]
  assert.deepEqual(workPlacement(rows, moving, 'todo', 'a'), { status: 'todo', beforeId: undefined, afterId: 'a' })
  assert.deepEqual(workPlacement(rows, moving, 'todo', 'z'), { status: 'todo', beforeId: 'a', afterId: 'z' })
  assert.deepEqual(workPlacement(rows, moving, 'todo'), { status: 'todo', beforeId: 'z', afterId: undefined })
  assert.deepEqual(workPlacement(rows, moving, 'review'), { status: 'review', beforeId: undefined, afterId: undefined })
  assert.throws(() => workPlacement(rows, moving, 'todo', 'shared'), /same scope/)
})
