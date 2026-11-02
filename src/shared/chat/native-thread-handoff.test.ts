import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNativeThreadHandoff } from './native-thread-handoff'

test('handoff is bounded and copies visible text and stable file IDs, not hidden tool data or signed attachment URLs', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: 'assistant',
    parts: [{ type: 'text', text: `message-${index} ${'x'.repeat(1000)}` }],
  }))
  const result = buildNativeThreadHandoff({
    conversationId: 'old-conversation',
    threadRootMessageId: 'old-root',
    messages: [...messages, {
      role: 'user',
      parts: [
        { type: 'text', text: 'Render the film.' },
        { type: 'file', url: 'https://storage.invalid/?secret=signed', fileName: 'script.txt' },
        { type: 'tool-result', text: 'private tool receipt' },
      ],
      metadata: { indexedAttachments: [{ name: 'script.txt', fileIds: ['file-1'] }] },
    }],
    files: [{ id: 'file-1', name: 'script.txt' }, { id: 'file-2', name: 'draft.mp4' }],
  })
  assert.ok(result.length <= 6000)
  assert.match(result, /Source conversation: old-conversation; thread: old-root/)
  assert.match(result, /User: Render the film/)
  assert.match(result, /file-2: draft.mp4/)
  assert.equal(result.match(/file-1/g)?.length, 1)
  assert.doesNotMatch(result, /message-0 |private tool receipt|secret=signed/)
})

test('room handoffs omit system messages and do not invent files or completed progress', () => {
  const result = buildNativeThreadHandoff({
    conversationId: 'room',
    messages: [
      { authorKind: 'system', content: 'internal event' },
      { authorKind: 'human', content: 'Make a film' },
      { authorKind: 'agent', content: 'The script is ready' },
    ],
  })
  assert.match(result, /Verify current progress and file availability/)
  assert.match(result, /User: Make a film/)
  assert.doesNotMatch(result, /internal event|Overlay file references/)
})
