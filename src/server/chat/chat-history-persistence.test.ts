import 'server-only'

import test from 'node:test'
import assert from 'node:assert/strict'
import type { PersistedMessagePart } from './chat-message-persistence'

import { sanitizeMessagePartsForPersistence } from './chat-message-persistence.ts'

test('sanitizeMessagePartsForPersistence keeps file URLs for reload', () => {
  const parts = sanitizeMessagePartsForPersistence(
    [
      { type: 'text', text: 'See image' },
      {
        type: 'file',
        url: 'https://example.com/a.png',
        mediaType: 'image/png',
        filename: 'a.png',
      },
    ],
    {},
  )
  assert.ok(
    parts?.some(
      (p: PersistedMessagePart) => p.type === 'file' && 'url' in p && p.url.includes('example.com'),
    ),
  )
  assert.ok(parts?.some((p: PersistedMessagePart) => p.type === 'text'))
})

test('sanitizeMessagePartsForPersistence skips file without url', () => {
  const parts = sanitizeMessagePartsForPersistence(
    [{ type: 'file', mediaType: 'image/png' }],
    {},
  )
  assert.ok(!parts?.some((p: PersistedMessagePart) => p.type === 'file'))
})
