import test from 'node:test'
import assert from 'node:assert/strict'
import { readNativeAgentInput } from './native-agent-input'

const input = { runId: 'r1', conversationId: 'c1', userId: 'u1', token: 't1', requestedAt: 1, question: 'Which file?' }

test('native input projection keeps only the persisted wait contract', () => {
  assert.deepEqual(readNativeAgentInput({ ...input, extra: 'ignored' }), input)
})

test('malformed native input projections do not render', () => {
  for (const value of [null, [], {}, { ...input, token: '' }, { ...input, requestedAt: NaN }, { ...input, question: ' ' }]) {
    assert.equal(readNativeAgentInput(value), undefined)
  }
})
