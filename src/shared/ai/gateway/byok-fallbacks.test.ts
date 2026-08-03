import assert from 'node:assert/strict'
import test from 'node:test'

import { getChatModelFallbackCandidates } from './model-fallbacks'

test('BYOK models never fall back to an Overlay-funded model', () => {
  assert.deepEqual(getChatModelFallbackCandidates({
    modelId: 'byok/connection_1/vendor/model-a',
    paid: true,
  }), [])
})
