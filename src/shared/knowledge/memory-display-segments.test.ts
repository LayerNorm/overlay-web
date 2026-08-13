import assert from 'node:assert/strict'
import test from 'node:test'
import { memoriesToClientListRows } from './memory-display-segments'

test('workspace memory rows expose creator attribution and creator-only deletion', () => {
  const memories = [
    {
      _id: 'memory_a',
      content: 'A workspace memory from Ada.',
      createdAt: 10,
      source: 'chat',
      userId: 'user_a',
    },
    {
      _id: 'memory_b',
      content: 'A workspace memory from Grace.',
      createdAt: 20,
      source: 'manual',
      userId: 'user_b',
    },
  ]
  const attributionsByUserId = new Map([
    ['user_a', { name: 'Ada Lovelace', principalId: 'principal_a' }],
    ['user_b', { name: 'Grace Hopper', principalId: 'principal_b' }],
  ])

  const rows = memoriesToClientListRows(memories, {
    attributionsByUserId,
    viewerUserId: 'user_a',
  })

  assert.deepEqual(rows.map((row) => ({
    canDelete: row.canDelete,
    creatorName: row.creatorName,
    creatorPrincipalId: row.creatorPrincipalId,
  })), [
    { canDelete: true, creatorName: 'Ada Lovelace', creatorPrincipalId: 'principal_a' },
    { canDelete: false, creatorName: 'Grace Hopper', creatorPrincipalId: 'principal_b' },
  ])
})
