import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStoredModelId } from './model-selection-utils'

test('normalizes legacy stored model arrays to the first allowed model', () => {
  assert.equal(
    normalizeStoredModelId(JSON.stringify(['image-a', 'image-b']), ['image-a', 'image-b']),
    'image-a',
  )
  assert.equal(
    normalizeStoredModelId(JSON.stringify(['multiple', 'image-b']), ['image-a', 'image-b']),
    'image-b',
  )
  assert.equal(normalizeStoredModelId('multiple', ['image-a', 'image-b']), null)
})
