import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { handleIdempotentMutation } from './idempotency'

test('Postgres app-data mode accepts valid idempotency keys without Convex persistence', async () => {
  let called = false
  const request = new NextRequest('https://overlay.example.test/api/v1/conversations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'postgres-key-1',
    },
    body: JSON.stringify({ title: 'Postgres idempotency smoke' }),
  })

  const response = await handleIdempotentMutation(
    request,
    'user_1',
    async () => {
      called = true
      return Response.json({ ok: true })
    },
    { appDataProvider: 'postgres' },
  )

  assert.equal(called, true)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Idempotency-Status'), 'app-data-provider-bypass')
  assert.equal(response.headers.get('Idempotency-Provider'), 'postgres-unsupported')
  assert.deepEqual(await response.json(), { ok: true })
})

test('invalid idempotency key is still rejected before provider-specific handling', async () => {
  let called = false
  const request = new NextRequest('https://overlay.example.test/api/v1/conversations', {
    method: 'POST',
    headers: {
      'idempotency-key': 'x'.repeat(256),
    },
  })

  const response = await handleIdempotentMutation(
    request,
    'user_1',
    async () => {
      called = true
      return Response.json({ ok: true })
    },
    { appDataProvider: 'postgres' },
  )

  assert.equal(called, false)
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Invalid Idempotency-Key header' })
})
