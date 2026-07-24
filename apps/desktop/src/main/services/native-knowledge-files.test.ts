import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NativeKnowledgeFileStore } from './native-knowledge-files'

describe('NativeKnowledgeFileStore', () => {
  it('issues opaque tokens, preserves relative folder paths, and rejects forged reads', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlay-native-files-'))
    const folder = join(root, 'picked')
    mkdirSync(join(folder, 'nested'), { recursive: true })
    writeFileSync(join(folder, 'nested', 'note.txt'), 'hello')
    const store = new NativeKnowledgeFileStore(root)
    const selected = store.registerSelection([folder], folder)
    expect(selected).toHaveLength(1)
    expect(selected[0].relativePath).toBe('nested/note.txt')
    expect(store.readSelection(selected[0].token).dataBase64).toBe(Buffer.from('hello').toString('base64'))
    expect(() => store.readSelection(selected[0].token)).toThrow(/invalid or expired/)
    expect(() => store.readSelection('../../etc/passwd')).toThrow(/invalid or expired/)
  })

  it('sanitizes Finder cache names and keeps writes inside the cache root', () => {
    const root = mkdtempSync(join(tmpdir(), 'overlay-native-files-'))
    const store = new NativeKnowledgeFileStore(root)
    const path = store.cacheDownloadedFile('../../report.txt', Buffer.from('report').toString('base64'))
    expect(path).toContain('knowledge-file-cache')
    expect(readFileSync(path, 'utf8')).toBe('report')
  })
})
