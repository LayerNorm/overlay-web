import assert from 'node:assert/strict'
import test from 'node:test'

import {
  byokConnectionScopeKey,
  canApplyByokConnectionResponse,
  normalizeByokConnectionsPayload,
} from './useByokModels'
import { ByokRegistryOwnership } from './byok-registry-ownership'
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

test('active registry subscribers survive disable and reject late responses from the previous workspace', async () => {
  const registered: ByokConnectionRow[][] = []
  const registry = new ByokRegistryOwnership((connections) => registered.push(connections))
  const cache = new Map<string, ByokConnectionRow[]>()
  const workspaceA = byokConnectionScopeKey('user-1', 'workspace-a')
  const workspaceB = byokConnectionScopeKey('user-1', 'workspace-b')
  const connectionA = { ...connection, _id: 'connection-a' }
  const connectionB = { ...connection, _id: 'connection-b' }
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
    return { promise, resolve }
  }
  const aResponse = deferred<ByokConnectionRow[]>()
  const bResponse = deferred<ByokConnectionRow[]>()

  const releaseFirstA = registry.subscribe(workspaceA, (scopeKey) => cache.get(scopeKey) ?? null)
  const releaseSecondA = registry.subscribe(workspaceA, (scopeKey) => cache.get(scopeKey) ?? null)
  const initialRegistrations = registered.length
  releaseSecondA()
  assert.equal(registry.activeScopeKey, workspaceA)
  assert.equal(registered.length, initialRegistrations)

  const load = async (scopeKey: string, response: Promise<ByokConnectionRow[]>) => {
    const rows = await response
    if (!registry.isActive(scopeKey)) return []
    cache.set(scopeKey, rows)
    registry.publish(scopeKey, rows)
    return rows
  }
  const pendingA = load(workspaceA, aResponse.promise)
  releaseFirstA()

  const releaseB = registry.subscribe(workspaceB, (scopeKey) => cache.get(scopeKey) ?? null)
  const pendingB = load(workspaceB, bResponse.promise)
  bResponse.resolve([connectionB])
  assert.deepEqual(await pendingB, [connectionB])
  aResponse.resolve([connectionA])
  assert.deepEqual(await pendingA, [])
  assert.equal(registry.activeScopeKey, workspaceB)
  assert.deepEqual(registered.at(-1), [connectionB])
  assert.equal(cache.has(workspaceA), false)
  releaseB()
})
