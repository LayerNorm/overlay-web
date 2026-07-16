import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import type {
  IdempotencyRepository,
  IdempotencyReservationResult,
} from '@/server/idempotency'
import { handleIdempotentMutation } from './idempotency'

class MemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly rows = new Map<string, {
    requestHash: string
    result?: IdempotencyReservationResult
  }>()

  async reserve(args: {
    keyHash: string
    requestHash: string
  }): Promise<IdempotencyReservationResult> {
    const existing = this.rows.get(args.keyHash)
    if (!existing) {
      this.rows.set(args.keyHash, { requestHash: args.requestHash })
      return { status: 'reserved' }
    }
    if (existing.requestHash !== args.requestHash) return { status: 'conflict' }
    return existing.result ?? { status: 'in_flight' }
  }

  async complete(args: {
    keyHash: string
    requestHash: string
    responseBody: string
    responseHeaders: Array<{ name: string; value: string }>
    responseStatus: number
  }): Promise<boolean> {
    const existing = this.rows.get(args.keyHash)
    if (!existing || existing.requestHash !== args.requestHash) return false
    existing.result = {
      responseBody: args.responseBody,
      responseHeaders: args.responseHeaders,
      responseStatus: args.responseStatus,
      status: 'replay',
    }
    return true
  }

  async completeStreamStarted(args: { keyHash: string; requestHash: string }): Promise<boolean> {
    return await this.complete({
      ...args,
      responseBody: '__overlay_stream_started__',
      responseHeaders: [],
      responseStatus: 200,
    })
  }

  async discard(args: { keyHash: string; requestHash: string }): Promise<boolean> {
    const existing = this.rows.get(args.keyHash)
    if (!existing || existing.requestHash !== args.requestHash) return false
    return this.rows.delete(args.keyHash)
  }

  async cleanupExpired(): Promise<number> {
    return 0
  }
}

test('idempotency repository stores and replays a JSON response', async () => {
  let calls = 0
  const repository = new MemoryIdempotencyRepository()
  const request = () => new NextRequest('https://overlay.example.test/api/v1/conversations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'postgres-key-1',
    },
    body: JSON.stringify({ title: 'Postgres idempotency smoke' }),
  })
  const run = async () => {
    calls += 1
    return Response.json({ ok: true })
  }

  const first = await handleIdempotentMutation(request(), 'user_1', run, { repository })
  const replay = await handleIdempotentMutation(request(), 'user_1', run, { repository })

  assert.equal(calls, 1)
  assert.equal(first.headers.get('Idempotency-Status'), 'stored')
  assert.equal(replay.headers.get('Idempotency-Status'), 'replayed')
  assert.equal(replay.headers.get('Idempotency-Replayed'), 'true')
  assert.deepEqual(await replay.json(), { ok: true })
})

test('reusing an idempotency key for a different request returns conflict', async () => {
  const repository = new MemoryIdempotencyRepository()
  const makeRequest = (title: string) => new NextRequest(
    'https://overlay.example.test/api/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'same-key' },
      body: JSON.stringify({ title }),
    },
  )

  await handleIdempotentMutation(
    makeRequest('first'),
    'user_1',
    async () => Response.json({ ok: true }),
    { repository },
  )
  const conflict = await handleIdempotentMutation(
    makeRequest('second'),
    'user_1',
    async () => Response.json({ ok: false }),
    { repository },
  )
  assert.equal(conflict.status, 409)
  assert.deepEqual(await conflict.json(), {
    error: 'Idempotency-Key was already used for a different request',
  })
})

test('invalid idempotency key is rejected before repository handling', async () => {
  let called = false
  const request = new NextRequest('https://overlay.example.test/api/v1/conversations', {
    method: 'POST',
    headers: { 'idempotency-key': 'x'.repeat(256) },
  })
  const response = await handleIdempotentMutation(
    request,
    'user_1',
    async () => {
      called = true
      return Response.json({ ok: true })
    },
    { repository: new MemoryIdempotencyRepository() },
  )

  assert.equal(called, false)
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Invalid Idempotency-Key header' })
})
