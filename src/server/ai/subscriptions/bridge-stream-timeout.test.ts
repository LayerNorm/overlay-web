import 'server-only'

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { SUBSCRIPTION_STREAM_SILENCE_TIMEOUT_MS, subscriptionBridgeFetch } from './bridge-client'

test('a subscription stream may stay silent longer than five minutes, under the 800 s step limit', () => {
  assert.ok(SUBSCRIPTION_STREAM_SILENCE_TIMEOUT_MS > 300_000)
  assert.ok(SUBSCRIPTION_STREAM_SILENCE_TIMEOUT_MS < 800_000)
})

test('the bridge fetch streams a response through its own dispatcher', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: one\n\n')
    setTimeout(() => response.end('data: two\n\n'), 50)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    const response = await subscriptionBridgeFetch(new URL(`http://127.0.0.1:${port}/internal/v1/infer`), { method: 'POST', body: '{}' })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'data: one\n\ndata: two\n\n')
  } finally {
    server.close()
  }
})
