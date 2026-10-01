import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { callInternalApi, runInToolCallScope } from './internal-api'

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

test('writes inside a tool call get distinct, replay-stable idempotency keys', async () => {
  const originalFetch = globalThis.fetch
  const keys: string[] = []
  globalThis.fetch = (async (_input, init) => {
    keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
    return new Response(null, { status: 204 })
  }) as typeof fetch
  const write = () => callInternalApi('/api/v1/notes', { userId: 'user_1', idempotencyKey: 'turn_1' }, undefined, 'https://overlay.test')

  try {
    await runInToolCallScope('call_a', async () => { await write(); await write() })
    await runInToolCallScope('call_b', write)
    // A replayed step re-issues the same keys in the same order.
    await runInToolCallScope('call_a', async () => { await write(); await write() })
    await write()
    assert.deepEqual(keys, [
      'turn_1:tool:call_a:0',
      'turn_1:tool:call_a:1',
      'turn_1:tool:call_b:0',
      'turn_1:tool:call_a:0',
      'turn_1:tool:call_a:1',
      'turn_1',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
