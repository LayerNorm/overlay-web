import assert from 'node:assert/strict'
import test from 'node:test'
import { messageText, visibleShape, type Message } from './via-overlay.mts'

test('smoke counts and saves the API text parts when content is omitted', () => {
  const message: Message = { id: 'reply', role: 'assistant', createdAt: 1, updatedAt: 2,
    parts: [{ type: 'text', text: '# Result\n\n' }, { type: 'tool-invocation' }, { type: 'text', text: 'Full answer.' }] }
  assert.equal(messageText(message), '# Result\n\nFull answer.')
  assert.equal(visibleShape(message).text, '# Result\n\nFull answer.'.length)
  assert.equal(visibleShape(message).tools, 1)
})

test('smoke respects explicit canonical content and tolerates an absent reply', () => {
  assert.equal(messageText(undefined), '')
  assert.equal(messageText({ id: 'r', role: 'assistant', createdAt: 1, updatedAt: 1, content: 'canonical', parts: [{ type: 'text', text: 'old' }] }), 'canonical')
})
