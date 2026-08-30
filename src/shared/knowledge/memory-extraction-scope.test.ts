import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasSameMemoryExtractionAuthor,
  selectMessagesAtOrBeforeTarget,
} from './memory-extraction-scope'

test('human extraction context includes only messages by the target human', () => {
  const target = { authorKind: 'human', authorPrincipalId: 'human-1', userId: 'user-1' }

  assert.equal(hasSameMemoryExtractionAuthor(target, target), true)
  assert.equal(hasSameMemoryExtractionAuthor(
    { authorKind: 'human', authorPrincipalId: 'human-2', userId: 'user-2' },
    target,
  ), false)
  assert.equal(hasSameMemoryExtractionAuthor(
    { authorKind: 'agent', authorPrincipalId: 'agent-1', userId: 'user-1' },
    target,
  ), false)
})

test('agent extraction context uses the target agent principal rather than billing user', () => {
  const target = { authorKind: 'agent', authorPrincipalId: 'agent-1', userId: 'billing-user' }

  assert.equal(hasSameMemoryExtractionAuthor(target, target), true)
  assert.equal(hasSameMemoryExtractionAuthor(
    { authorKind: 'agent', authorPrincipalId: 'agent-2', userId: 'billing-user' },
    target,
  ), false)
  assert.equal(hasSameMemoryExtractionAuthor(
    { authorKind: 'human', authorPrincipalId: 'human-1', userId: 'billing-user' },
    target,
  ), false)
})

test('agent extraction refuses an unidentifiable target principal', () => {
  assert.equal(hasSameMemoryExtractionAuthor(
    { authorKind: 'agent', authorPrincipalId: 'agent-1', userId: 'billing-user' },
    { authorKind: 'agent', userId: 'billing-user' },
  ), false)
})

test('database position excludes later messages when timestamps tie', () => {
  const later = { id: 'later', createdAt: 1_000 }
  const target = { id: 'target', createdAt: 1_000 }
  const earlier = { id: 'earlier', createdAt: 999 }

  assert.deepEqual(
    selectMessagesAtOrBeforeTarget(
      [later, target, earlier],
      target,
      (message) => message.id === target.id,
    ),
    [target, earlier],
  )
})

test('a target outside the bounded window does not admit newer messages', () => {
  const target = { id: 'target' }

  assert.deepEqual(
    selectMessagesAtOrBeforeTarget(
      [{ id: 'newer-2' }, { id: 'newer-1' }],
      target,
      (message) => message.id === target.id,
    ),
    [target],
  )
})
