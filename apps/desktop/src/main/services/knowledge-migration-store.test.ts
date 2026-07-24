import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createKnowledgeMigrationJournal } from '@overlay/app-core'
import { describe, expect, it } from 'vitest'

import { KnowledgeMigrationStore } from './knowledge-migration-store'

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'overlay-knowledge-migration-'))
  mkdirSync(join(root, 'notes', 'images'), { recursive: true })
  mkdirSync(join(root, 'documents'), { recursive: true })
  writeFileSync(
    join(root, 'notes', 'note-local.md'),
    `---\n${JSON.stringify({ id: 'note-local', title: 'Local note', updatedAt: 10 })}\n---\nHello`,
  )
  writeFileSync(join(root, 'notes', 'images', 'image.png'), Buffer.from('image'))
  writeFileSync(join(root, 'documents', 'brief.txt'), 'document')
  return root
}

describe('KnowledgeMigrationStore', () => {
  it('inventories notes, attachments, and documents with stable checksums', () => {
    const store = new KnowledgeMigrationStore(fixtureRoot())
    const first = store.inventory()
    const second = store.inventory()
    expect(first).toEqual(second)
    expect(first.notes).toHaveLength(1)
    expect(first.documents).toHaveLength(1)
    expect(first.attachments.map((asset) => asset.source).sort()).toEqual(['document', 'note-image'])
    expect(store.readAsset(first.documents[0].assetId).dataBase64).toBe(Buffer.from('document').toString('base64'))
  })

  it('writes an atomic per-user journal and a recoverable backup without deleting sources', () => {
    const root = fixtureRoot()
    const store = new KnowledgeMigrationStore(root)
    const journal = createKnowledgeMigrationJournal('user-1', 20)
    store.saveJournal('user-1', journal)
    expect(store.loadJournal('user-1')).toEqual(journal)
    expect(() => store.saveJournal('another-user', journal)).toThrow(/active user/)

    const backup = store.createBackup('user-1')
    expect(backup.itemCount).toBeGreaterThanOrEqual(3)
    expect(readFileSync(join(root, 'notes', 'note-local.md'), 'utf8')).toContain('Hello')
  })

  it('does not read arbitrary paths through an unrecognized asset id', () => {
    const store = new KnowledgeMigrationStore(fixtureRoot())
    expect(() => store.readAsset('../../etc/passwd')).toThrow(/verified inventory/)
  })
})
