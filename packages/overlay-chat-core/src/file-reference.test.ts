import assert from 'node:assert/strict'
import test from 'node:test'
import { fileContentHref, parsePersistedFileReference, removeKnownFileMarkdown } from './file-reference'

test('parses only successful allowlisted file results and retains the typed reference', () => {
  const reference = {
    fileId: 'file-1', name: 'launch.md', mimeType: 'text/markdown', sizeBytes: 0,
    revision: 'r2', conversationId: 'conversation-1',
  }
  assert.deepEqual(parsePersistedFileReference('write_file', {
    success: true, fileReference: reference,
  }), reference)
  assert.deepEqual(parsePersistedFileReference('computer_publish_file', {
    display: { success: true, fileReference: { ...reference, mimeType: 'video/mp4' } },
  }), { ...reference, mimeType: 'video/mp4' })
  assert.equal(parsePersistedFileReference('model_claimed_file', {
    success: true, fileReference: reference,
  }), null)
  assert.equal(parsePersistedFileReference('write_file', {
    success: false, display: { success: true, fileReference: reference },
  }), null)
  assert.equal(parsePersistedFileReference('write_file', {
    success: true, fileReference: { ...reference, fileId: 'x'.repeat(300) },
  }), null)
  assert.equal(parsePersistedFileReference('write_file', {
    success: true, fileReference: { fileId: '', name: '', mimeType: '' },
  }), null, 'an empty or malformed result does not create a card')
})

test('supports historical successful note, file, and Computer result shapes', () => {
  assert.deepEqual(parsePersistedFileReference('create_note', {
    success: true, noteId: 'note-1', saved: { title: 'Launch notes' }, revision: '17',
  }), {
    fileId: 'note-1', name: 'Launch notes', mimeType: 'text/markdown', revision: '17',
  })
  assert.deepEqual(parsePersistedFileReference('write_file', {
    success: true, fileId: 'file-2', saved: { name: 'data.json', revision: '3' },
  }), {
    fileId: 'file-2', name: 'data.json', mimeType: 'application/json', revision: '3',
  })
  assert.deepEqual(parsePersistedFileReference('computer_publish_file', {
    success: true, artifact: {
      fileId: 'file-3', name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 12,
      checksumSha256: 'abc', conversationId: 'conversation-3',
    },
  }), {
    fileId: 'file-3', name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 12,
    revision: 'abc', conversationId: 'conversation-3',
  })
  assert.deepEqual(parsePersistedFileReference('update_note', {
    success: true, noteId: 'note-2', saved: { title: 'Updated notes' }, revision: '18',
  }), {
    fileId: 'note-2', name: 'Updated notes', mimeType: 'text/markdown', revision: '18',
  })
  assert.equal(parsePersistedFileReference('append_to_note', {
    success: true, noteId: 'note-2', revision: '19',
  }), null, 'historical note edits without enough identity metadata do not create cards')
  assert.equal(parsePersistedFileReference('get_note', {
    success: true, fileReference: { fileId: 'note-1', name: 'Read note', mimeType: 'text/markdown' },
  }), null, 'read tools never create persisted-file cards')
})

test('normalizes only known canonical links outside inline and fenced code', () => {
  const href = fileContentHref('file-1')
  const markdown = [
    `![poster](${href}?download=1)`,
    `[Open](https://app.getoverlay.io${href})`,
    '[Note](/app/w/workspace/notes?id=note-1&scope=personal)',
    `[external](https://outside.test${href})`,
    `[protocol-relative](//evil.example${href})`,
    `\`[code](${href})\``,
    `\`\`\`md\n[code](${href})\n\`\`\``,
  ].join('\n')
  const normalized = removeKnownFileMarkdown(markdown, new Set(['file-1', 'note-1']))
  assert.equal(normalized.includes('![poster]'), false)
  assert.equal(normalized.includes('[Open]('), false)
  assert.equal(normalized.includes('[Note]('), false)
  assert.equal(normalized.includes('[external](https://outside.test'), true)
  assert.equal(normalized.includes(`[protocol-relative](//evil.example${href})`), true)
  assert.equal(normalized.includes(`\`[code](${href})\``), true)
  assert.equal(normalized.includes(`\`\`\`md\n[code](${href})\n\`\`\``), true)
  assert.equal(removeKnownFileMarkdown(markdown, new Set()), markdown)
})
