import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { callInternalApi } from './internal-api'

test('callInternalApi forwards a stable idempotency key without serializing it', async () => {
  const originalFetch = globalThis.fetch
  let request: { input: string | URL | Request; init?: RequestInit } | undefined
  globalThis.fetch = (async (input, init) => {
    request = { input, init }
    return new Response(null, { status: 204 })
  }) as typeof fetch

  try {
    await callInternalApi('/api/v1/files', {
      userId: 'user_1',
      workspaceId: 'workspace_1',
      idempotencyKey: 'agent-run:run_1:tool:call_1',
      name: 'report.txt',
    }, undefined, 'https://overlay.test')

    assert.ok(request)
    assert.equal(String(request.input), 'https://overlay.test/api/v1/files')
    const headers = new Headers(request.init?.headers)
    assert.equal(headers.get('Idempotency-Key'), 'agent-run:run_1:tool:call_1')
    assert.equal(headers.get('X-Overlay-Workspace-Id'), 'workspace_1')
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      userId: 'user_1',
      name: 'report.txt',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
