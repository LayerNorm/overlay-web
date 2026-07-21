import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FILE_VIEWER_HTML_SANDBOX,
  getFileType,
  isEditableType,
  prefersUrlPreview,
  resolveSafeViewerUrl,
  shouldFetchTextContent,
} from './file-viewer'

test('file viewer classification is shared by web and desktop', () => {
  assert.equal(getFileType('notes.md'), 'markdown')
  assert.equal(getFileType('sheet.csv'), 'csv')
  assert.equal(getFileType('recording.wav'), 'audio')
  assert.equal(getFileType('report.docx'), 'document')
  assert.equal(isEditableType('script.ts'), true)
  assert.equal(prefersUrlPreview('movie.mp4'), true)
  assert.equal(shouldFetchTextContent('report.pdf'), false)
})

test('viewer URL policy rejects executable and cross-context schemes', () => {
  assert.equal(resolveSafeViewerUrl('javascript:alert(1)', 'media'), undefined)
  assert.equal(resolveSafeViewerUrl('file:///etc/passwd', 'download'), undefined)
  assert.equal(resolveSafeViewerUrl('//evil.example/file', 'document'), undefined)
  assert.equal(resolveSafeViewerUrl('data:text/html;base64,PGgxPkJvb208L2gxPg==', 'media'), undefined)
  assert.match(resolveSafeViewerUrl('data:image/png;base64,iVBORw0KGgo=', 'media') ?? '', /^data:image/)
  assert.match(resolveSafeViewerUrl('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E', 'media') ?? '', /^data:image/)
  assert.equal(resolveSafeViewerUrl('/api/v1/files/a/content', 'pdf'), '/api/v1/files/a/content')
  assert.equal(resolveSafeViewerUrl('blob:https://overlay.local/id', 'document'), 'blob:https://overlay.local/id')
  assert.equal(resolveSafeViewerUrl('/api/private', 'external'), undefined)
})

test('sandbox policy cannot inherit the app origin or navigate Electron', () => {
  assert.equal(FILE_VIEWER_HTML_SANDBOX.includes('allow-same-origin'), false)
  assert.equal(FILE_VIEWER_HTML_SANDBOX.includes('allow-top-navigation'), false)
  assert.equal(FILE_VIEWER_HTML_SANDBOX.includes('allow-popups'), false)
  assert.equal(FILE_VIEWER_HTML_SANDBOX.includes('allow-downloads'), false)
})
