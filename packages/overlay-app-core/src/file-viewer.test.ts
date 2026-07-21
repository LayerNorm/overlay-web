import assert from 'node:assert/strict'
import test from 'node:test'

import { getFileType, isEditableType, prefersUrlPreview, shouldFetchTextContent } from './file-viewer'

test('file viewer classification is shared by web and desktop', () => {
  assert.equal(getFileType('notes.md'), 'markdown')
  assert.equal(getFileType('sheet.csv'), 'csv')
  assert.equal(getFileType('recording.wav'), 'audio')
  assert.equal(getFileType('report.docx'), 'document')
  assert.equal(isEditableType('script.ts'), true)
  assert.equal(prefersUrlPreview('movie.mp4'), true)
  assert.equal(shouldFetchTextContent('report.pdf'), false)
})
