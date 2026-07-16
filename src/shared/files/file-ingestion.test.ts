import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldIngestDocument } from './file-ingestion'

test('shouldIngestDocument selects formats supported by document extraction', () => {
  for (const filename of ['report.pdf', 'notes.txt', 'README.md', 'data.csv', 'page.html', 'brief.docx']) {
    assert.equal(shouldIngestDocument(filename), true, filename)
  }
})

test('shouldIngestDocument leaves unsupported binary media on direct storage upload', () => {
  for (const filename of ['legacy.doc', 'photo.png', 'clip.mp4', 'archive.zip']) {
    assert.equal(shouldIngestDocument(filename), false, filename)
  }
})
