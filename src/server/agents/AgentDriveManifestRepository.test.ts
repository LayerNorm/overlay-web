import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentDriveManifestRepository } from './AgentDriveManifestRepository'
import { handleAgentDriveRequest } from './agent-drive-http'
import { createAgentDriveTokens } from './agent-drive-token'

test('actual SDK pins all manifest pages to one timestamp while authority checks use current queries', async () => {
  const originalFetch = globalThis.fetch
  const previousUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  const previousSecret = process.env.INTERNAL_API_SECRET
  process.env.NEXT_PUBLIC_CONVEX_URL = 'https://drive-fixture.convex.cloud'
  process.env.INTERNAL_API_SECRET = 'drive-repository-test-secret'
  const calls: { endpoint: string; body: Record<string, unknown> }[] = []
  let timestamps = 0; let revoked = false; let redacted = false; let snapshotFailure = false
  globalThis.fetch = async (input, options) => {
    const endpoint = new URL(String(input)).pathname
    const body = options?.body ? JSON.parse(String(options.body)) : {}
    calls.push({ endpoint, body })
    if (endpoint === '/api/query_ts') return Response.json({ ts: `snapshot-${++timestamps}` })
    if (redacted && ((endpoint === '/api/query' && revoked) || (endpoint === '/api/query_at_ts' && snapshotFailure))) {
      return Response.json({ status: 'error', errorMessage: 'Server Error', errorData: 'DRIVE_RUN_UNAVAILABLE' })
    }
    if (endpoint === '/api/query_at_ts') return Response.json({ status: 'success', value: { rows: [], scope: { kind: 'workspace', workspaceId: 'w' }, viewer: { userId: 'u', role: 'member' }, nextCursor: null }, logLines: [] })
    if (endpoint === '/api/query' && revoked) return Response.json({ status: 'error', errorMessage: '[Request ID: synthetic] Server Error\nUncaught Error: DRIVE_RUN_UNAVAILABLE\n    at requireDriveAuthority (agents/agentDrive.ts:37:0)' })
    return Response.json({ status: 'success', value: null })
  }
  try {
    const tokens = createAgentDriveTokens({ secret: 'manifest-test-secret-at-least-32-bytes' })
    const token = tokens.mint({ actorUserId: 'u', agentId: 'a', environmentId: 'e', bindingId: 'b', runId: 'r', sessionId: 's', scope: { kind: 'workspace', workspaceId: 'w' } }, Date.now() + 300000)
    const claims = tokens.verify(token)!
    const repository = createAgentDriveManifestRepository(claims)
    await repository.authorize()
    await repository.page(null)
    await repository.authorize()
    await repository.page('second')
    const pages = calls.filter(call => call.endpoint === '/api/query_at_ts')
    assert.equal(timestamps, 1)
    assert.equal(pages.length, 2)
    assert.ok(pages.every(call => call.body.ts === 'snapshot-1'))
    const args = pages[0]!.body.args as Record<string, unknown>[]
    assert.equal(args[0]!.audience, undefined)
    assert.equal(args[0]!.issuedAt, undefined)
    assert.equal(args[0]!.metadataOnly, true)
    assert.ok(calls.filter(call => call.endpoint === '/api/query').every(call => call.body.ts === undefined))
    revoked = true
    await assert.rejects(repository.authorize(), /DRIVE_RUN_UNAVAILABLE/)
    const denied = await handleAgentDriveRequest(new Request('https://preview.invalid/api/agent-drive', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"action":"manifest"}',
    }), { enabled: () => true, limit: async () => null, service: () => ({
      async manifest() { await repository.authorize(); return { entries: [] } }, async download() { return new Uint8Array() },
    }) })
    assert.equal(denied.status, 403)
    assert.deepEqual(await denied.json(), { error: 'DRIVE_RUN_UNAVAILABLE' })
    const secondRepository = createAgentDriveManifestRepository(claims)
    await secondRepository.page(null)
    assert.equal(timestamps, 2)
    redacted = true
    for (const transport of ['live', 'snapshot']) {
      snapshotFailure = transport === 'snapshot'
      const response = await handleAgentDriveRequest(new Request('https://preview.invalid/api/agent-drive', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"action":"manifest"}',
      }), { enabled: () => true, limit: async () => null, service: () => ({
        async manifest() { if (transport === 'live') await repository.authorize(); else await repository.page(null); return { entries: [] } },
        async download() { return new Uint8Array() },
      }) })
      assert.equal(response.status, 403, `redacted ${transport} Convex transport`)
      assert.deepEqual(await response.json(), { error: 'DRIVE_RUN_UNAVAILABLE' })
    }
  } finally {
    globalThis.fetch = originalFetch
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL; else process.env.NEXT_PUBLIC_CONVEX_URL = previousUrl
    if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET; else process.env.INTERNAL_API_SECRET = previousSecret
  }
})
