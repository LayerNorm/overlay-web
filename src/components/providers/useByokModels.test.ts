import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeByokConnectionsPayload } from './useByokModels'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'

const connection: ByokConnectionRow = {
  _id: 'connection_123',
  providerId: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  displayName: 'OpenRouter',
  enabledModelIds: ['anthropic/claude-sonnet-4.6'],
  status: 'active',
  isDefault: false,
  isDeletable: true,
}

test('normalizes the BFF paginated provider connections envelope', () => {
  assert.deepEqual(
    normalizeByokConnectionsPayload({
      data: [connection],
      hasMore: false,
      total: 1,
    }),
    [connection],
  )
})

test('normalizes legacy raw provider connection arrays', () => {
  assert.deepEqual(normalizeByokConnectionsPayload([connection]), [connection])
})

test('surfaces provider connection API errors without crashing the model registry', () => {
  assert.throws(
    () => normalizeByokConnectionsPayload({ error: 'Failed to fetch provider connections' }),
    /Failed to fetch provider connections/,
  )
})
