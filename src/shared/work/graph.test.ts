import assert from 'node:assert/strict'
import test from 'node:test'
import { ancestorsOf, checkBlockedBy, checkParent, descendantsOf, subtreeHeight } from './graph'

const parents: Record<string, string | undefined> = { task: 'objective', subtask: 'task', objective: undefined, other: undefined }
const parentOf = (id: string) => parents[id]
const childrenOf = (id: string) => Object.keys(parents).filter((key) => parents[key] === id)

test('ancestors, descendants and height follow parent links', () => {
  assert.deepEqual(ancestorsOf('subtask', parentOf), ['task', 'objective'])
  assert.deepEqual(descendantsOf('objective', childrenOf).sort(), ['subtask', 'task'])
  assert.equal(subtreeHeight('objective', childrenOf), 3)
  assert.equal(subtreeHeight('other', childrenOf), 1)
})

test('a task cannot be its own parent or sit under a descendant', () => {
  assert.deepEqual(checkParent({ id: 'task', parentId: 'task', parentOf, childrenOf }), { ok: false, reason: 'self' })
  assert.deepEqual(checkParent({ id: 'objective', parentId: 'task', parentOf, childrenOf }), { ok: false, reason: 'descendant' })
  assert.deepEqual(checkParent({ id: 'objective', parentId: 'subtask', parentOf, childrenOf }), { ok: false, reason: 'descendant' })
  assert.deepEqual(checkParent({ id: 'other', parentId: 'objective', parentOf, childrenOf }), { ok: true })
})

test('nesting is capped by depth, counting what is already below the task', () => {
  assert.deepEqual(checkParent({ id: 'other', parentId: 'subtask', parentOf, childrenOf }), { ok: false, reason: 'too_deep' })
  // The objective already has two levels beneath it, so it cannot go under anything.
  assert.deepEqual(checkParent({ id: 'objective', parentId: 'other', parentOf, childrenOf }), { ok: false, reason: 'too_deep' })
})

test('a corrupt parent cycle in the data does not loop forever', () => {
  const loop: Record<string, string> = { a: 'b', b: 'a' }
  assert.deepEqual(ancestorsOf('a', (id) => loop[id]), ['b'])
})

test('blocked-by rejects self, cycles and too many blockers', () => {
  const blockedBy: Record<string, string[]> = { a: ['b'], b: ['c'], c: [] }
  const lookup = (id: string) => blockedBy[id]
  assert.deepEqual(checkBlockedBy({ id: 'a', blockers: ['a'], blockedByOf: lookup }), { ok: false, reason: 'self' })
  assert.deepEqual(checkBlockedBy({ id: 'c', blockers: ['a'], blockedByOf: lookup }), { ok: false, reason: 'cycle' })
  assert.deepEqual(checkBlockedBy({ id: 'c', blockers: ['b'], blockedByOf: lookup }), { ok: false, reason: 'cycle' })
  assert.deepEqual(checkBlockedBy({ id: 'd', blockers: ['a', 'b', 'c'], blockedByOf: lookup }), { ok: true })
  assert.deepEqual(checkBlockedBy({ id: 'a', blockers: ['c'], blockedByOf: lookup }), { ok: true })
  const many = Array.from({ length: 51 }, (_, index) => `x${index}`)
  assert.deepEqual(checkBlockedBy({ id: 'z', blockers: many, blockedByOf: lookup }), { ok: false, reason: 'too_many' })
})
