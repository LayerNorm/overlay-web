import assert from 'node:assert/strict'
import test from 'node:test'
import { beginKnowledgeUploadToast, type KnowledgeUploadToast } from './upload-toast'

test('upload settlement updates the loading toast under the same operation id', () => {
  const events: Array<{ type: string; message: string; id: string }> = []
  const toast: KnowledgeUploadToast = {
    loading: (message, { id }) => { events.push({ type: 'loading', message, id }) },
    success: (message, { id }) => { events.push({ type: 'success', message, id }) },
    error: (message, { id }) => { events.push({ type: 'error', message, id }) },
  }
  const upload = beginKnowledgeUploadToast(toast, 'Uploading file…', () => 'knowledge-upload-1')

  upload.error('Upload failed.')

  assert.deepEqual(events, [
    { type: 'loading', message: 'Uploading file…', id: 'knowledge-upload-1' },
    { type: 'error', message: 'Upload failed.', id: 'knowledge-upload-1' },
  ])
})

test('overlapping upload invocations use distinct operation ids', () => {
  const ids: string[] = []
  const toast: KnowledgeUploadToast = {
    loading: (_message, { id }) => { ids.push(id) },
    success: () => undefined,
    error: () => undefined,
  }
  let nextId = 0

  beginKnowledgeUploadToast(toast, 'Uploading first…', () => `upload-${++nextId}`)
  beginKnowledgeUploadToast(toast, 'Uploading second…', () => `upload-${++nextId}`)

  assert.deepEqual(ids, ['upload-1', 'upload-2'])
})
