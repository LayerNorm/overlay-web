import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ObjectStore, VectorStore } from './types'

describe('@overlay/storage-contracts', () => {
  it('allows minimal ObjectStore and VectorStore implementations', async () => {
    const objectStore: ObjectStore = {
      async getUploadUrl(key, contentType) {
        return { url: `https://upload.example/${key}`, fields: { 'Content-Type': contentType } }
      },
      async getDownloadUrl(key) {
        return `https://download.example/${key}`
      },
      async deleteObject() {},
      async listObjects() {
        return [{ key: 'a.txt', sizeBytes: 1 }]
      },
    }

    const vectorStore: VectorStore = {
      async upsert() {},
      async query() {
        return [{ id: '1', score: 0.9, metadata: {} }]
      },
      async delete() {},
    }

    const upload = await objectStore.getUploadUrl('files/a.txt', 'text/plain')
    assert.equal(upload.url.includes('files/a.txt'), true)
    assert.equal((await vectorStore.query({ vector: [0.1], topK: 1 })).length, 1)
  })
})
