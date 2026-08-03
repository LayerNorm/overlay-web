import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'

import { requestExceedsByteLimit } from './request-size'

test('rejects oversized provider bodies without relying on Content-Length', async () => {
  const request = new NextRequest('https://getoverlay.io/api/v1/providers/connections', {
    method: 'POST',
    body: JSON.stringify({ apiKey: 'x'.repeat(128) }),
    headers: { 'content-type': 'application/json' },
  })
  request.headers.delete('content-length')

  assert.equal(await requestExceedsByteLimit(request, 64), true)
})

test('preserves valid provider request bodies for downstream parsing', async () => {
  const body = JSON.stringify({ providerId: 'groq' })
  const request = new NextRequest('https://getoverlay.io/api/v1/providers/connections', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  })

  assert.equal(await requestExceedsByteLimit(request, 1_000), false)
  assert.deepEqual(await request.json(), { providerId: 'groq' })
})
