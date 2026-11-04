import assert from 'node:assert/strict'
import test from 'node:test'

import {
  byokConnectionScopeKey,
  canApplyByokConnectionResponse,
  normalizeByokConnectionsPayload,
} from './useByokModels'
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

test('workspace namespaces are isolated and stale connection responses cannot become active', () => {
  const personal = byokConnectionScopeKey('user-1')
  const workspaceOne = byokConnectionScopeKey('user-1', 'workspace-1')
  const workspaceTwo = byokConnectionScopeKey('user-1', 'workspace-2')

  assert.notEqual(personal, workspaceOne)
  assert.notEqual(workspaceOne, workspaceTwo)
  assert.equal(canApplyByokConnectionResponse(workspaceTwo, workspaceOne), false)
  assert.equal(canApplyByokConnectionResponse(workspaceTwo, workspaceTwo), true)
})
