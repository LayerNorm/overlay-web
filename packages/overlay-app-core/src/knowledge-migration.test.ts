import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createKnowledgeMigrationJournal,
  resolveKnowledgeMigrationConflictName,
  rewriteKnowledgeMigrationReferences,
} from './knowledge-migration'

test('migration conflict names preserve extensions and remain deterministic', () => {
  assert.equal(
    resolveKnowledgeMigrationConflictName('Research.pdf', ['research.pdf', 'Research (On this Mac).pdf']),
    'Research (On this Mac 2).pdf',
  )
  assert.equal(resolveKnowledgeMigrationConflictName('Notes', ['Elsewhere']), 'Notes')
})

test('migration references rewrite only stable Overlay link forms', () => {
  const content = [
    'overlay-note://local note',
    'overlay://file/local-file',
    '?note=local%20note',
    '<span data-note-id="local note">Open</span>',
    'ordinary local note prose',
  ].join('\n')
  const rewritten = rewriteKnowledgeMigrationReferences(content, {
    'local note': 'remote-note',
    'local-file': 'remote-file',
  })
  assert.match(rewritten, /overlay-note:\/\/remote-note/)
  assert.match(rewritten, /overlay:\/\/file\/remote-file/)
  assert.match(rewritten, /\?note=remote-note/)
  assert.match(rewritten, /data-note-id="remote-note"/)
  assert.match(rewritten, /ordinary local note prose/)
})

test('migration journal starts resumable and scoped to one user', () => {
  const journal = createKnowledgeMigrationJournal('user-1', 42)
  assert.equal(journal.version, 1)
  assert.equal(journal.phase, 'inventory')
  assert.equal(journal.startedAt, 42)
  assert.deepEqual(journal.mappings, { nodes: {}, assets: {} })
})
