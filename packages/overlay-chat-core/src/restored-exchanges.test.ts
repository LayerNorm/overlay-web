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

test('restores only variant zero and prefers it over an undefined variant', () => {
  const exchanges = buildRestoredMessageExchanges([
    { id: 'u-1', turnId: 'turn-1', role: 'user' as const, parts: [{ type: 'text', text: 'first' }] },
    { id: 'a-1-other', turnId: 'turn-1', role: 'assistant' as const, variantIndex: 1, parts: [{ type: 'text', text: 'other' }], model: 'model-b' },
    { id: 'a-1-primary', turnId: 'turn-1', role: 'assistant' as const, variantIndex: 0, parts: [{ type: 'text', text: 'primary' }], model: 'model-a' },
    { id: 'u-2', turnId: 'turn-2', role: 'user' as const, parts: [{ type: 'text', text: 'second' }] },
    { id: 'a-2-legacy', turnId: 'turn-2', role: 'assistant' as const, parts: [{ type: 'text', text: 'legacy' }], model: 'model-b' },
    { id: 'a-2-primary', turnId: 'turn-2', role: 'assistant' as const, variantIndex: 0, parts: [{ type: 'text', text: 'primary' }], model: 'model-a' },
    { id: 'u-3', turnId: 'turn-3', role: 'user' as const, parts: [{ type: 'text', text: 'third' }] },
    { id: 'a-3-legacy', turnId: 'turn-3', role: 'assistant' as const, parts: [{ type: 'text', text: 'legacy' }], model: 'model-a' },
  ], {
    defaultModelId: 'model-a',
    hasAutomationContext: false,
  })

  assert.deepEqual(exchanges.map((exchange) => exchange.responses.map(({ msg }) => msg.id)), [
    ['a-1-primary'],
    ['a-2-primary'],
    ['a-3-legacy'],
  ])
})
