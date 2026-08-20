import assert from 'node:assert/strict'
import test from 'node:test'
import { getMessageText, resolveActAssistant } from './messages'

test('getMessageText reads output-text parts and content fallback', () => {
  assert.equal(getMessageText({ parts: [{ type: 'output-text', text: 'hello' }] }), 'hello')
  assert.equal(getMessageText({ parts: [{ type: 'text', text: '' }], content: 'stored' }), 'stored')
})

test('resolveActAssistant matches by user-turn count when thread lengths differ', () => {
  const chat0 = [
    { id: 'u-1', role: 'user' as const },
    { id: 'u-2', role: 'user' as const },
    { id: 'a-2', role: 'assistant' as const, parts: [{ type: 'text', text: 'later' }] },
  ]
  const actMsgs = [
    { id: 'u-1', role: 'user' as const },
    { id: 'a-1', role: 'assistant' as const, parts: [{ type: 'text', text: 'first' }] },
    { id: 'u-2', role: 'user' as const },
    { id: 'a-2', role: 'assistant' as const, parts: [{ type: 'text', text: 'later' }] },
  ]

  assert.equal(resolveActAssistant(chat0, actMsgs, 'u-1')?.id, 'a-1')
  assert.equal(resolveActAssistant(chat0, actMsgs, 'u-2')?.id, 'a-2')
})
