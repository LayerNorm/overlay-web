import assert from 'node:assert/strict'
import test from 'node:test'
import { hasSameMemoryExtractionAuthor } from './memory-extraction-scope'

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
