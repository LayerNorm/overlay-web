import assert from 'node:assert/strict'
import test from 'node:test'
import { diffBlockKeys } from './agent-edit-diff'

test('unchanged blocks produce no review ranges', () => {
  assert.deepEqual(diffBlockKeys(['a', 'b'], ['a', 'b']), [])
})

test('each separate change becomes its own range', () => {
  assert.deepEqual(diffBlockKeys(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd', 'e']), [
    [1, 2, 1, 2],
    [4, 4, 4, 5],
  ])
})

test('pure deletions and insertions keep empty ranges on one side', () => {
  assert.deepEqual(diffBlockKeys(['a', 'b', 'c'], ['a', 'c']), [[1, 2, 1, 1]])
  assert.deepEqual(diffBlockKeys([], ['a']), [[0, 0, 0, 1]])
})
