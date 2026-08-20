import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRestoredMessageExchanges } from './restored-exchanges'

test('pairs orphan assistants with unmatched user turns instead of dumping them on the last user', () => {
  const exchanges = buildRestoredMessageExchanges([
    { id: 'u-1', turnId: 'turn-1', role: 'user' as const, parts: [{ type: 'text', text: 'first' }] },
    { id: 'u-2', turnId: 'turn-2', role: 'user' as const, parts: [{ type: 'text', text: 'second' }] },
    { id: 'a-1', role: 'assistant' as const, parts: [{ type: 'text', text: 'answer 1' }], model: 'model-a' },
    { id: 'a-2', role: 'assistant' as const, parts: [{ type: 'text', text: 'answer 2' }], model: 'model-a' },
  ], {
    defaultModelId: 'model-a',
    hasAutomationContext: false,
  })

  assert.equal(exchanges.length, 2)
  assert.equal(exchanges[0]!.userMsg.id, 'u-1')
  assert.deepEqual(exchanges[0]!.responses.map((response) => response.msg.id), ['a-1'])
  assert.equal(exchanges[1]!.userMsg.id, 'u-2')
  assert.deepEqual(exchanges[1]!.responses.map((response) => response.msg.id), ['a-2'])
})

test('keeps turn-id grouped assistants on their original user turn', () => {
  const exchanges = buildRestoredMessageExchanges([
    { id: 'u-1', turnId: 'turn-1', role: 'user' as const, parts: [{ type: 'text', text: 'first' }] },
    { id: 'a-1', turnId: 'turn-1', role: 'assistant' as const, parts: [{ type: 'text', text: 'answer 1' }], model: 'model-a' },
    { id: 'u-2', turnId: 'turn-2', role: 'user' as const, parts: [{ type: 'text', text: 'second' }] },
    { id: 'a-2', turnId: 'turn-2', role: 'assistant' as const, parts: [{ type: 'text', text: 'answer 2' }], model: 'model-a' },
  ], {
    defaultModelId: 'model-a',
    hasAutomationContext: false,
  })

  assert.equal(exchanges.length, 2)
  assert.deepEqual(exchanges[0]!.responses.map((response) => response.msg.id), ['a-1'])
  assert.deepEqual(exchanges[1]!.responses.map((response) => response.msg.id), ['a-2'])
})
