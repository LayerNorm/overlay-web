import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { requestTitle } from './generate-title'

test('retries a timed-out title request with a fresh signal', async (t) => {
  const signals: (AbortSignal | null | undefined)[] = []
  const mock = t.mock.method(overlayAppClient.chat, 'generateTitleResponse', async (_body, init) => {
    signals.push(init?.signal)
    if (signals.length === 1) return new Promise<Response>(() => {})
    return new Response(JSON.stringify({ title: 'A generated title' }), { status: 200 })
  })

  assert.equal(await requestTitle('first message', 20), 'A generated title')
  assert.equal(mock.mock.callCount(), 2)
  assert.equal(signals[0]?.aborted, true)
  assert.notEqual(signals[0], signals[1])
  assert.equal(signals[1]?.aborted, false)
})

test('does not retry a non-retryable client error', async (t) => {
  const mock = t.mock.method(
    overlayAppClient.chat,
    'generateTitleResponse',
    async () => new Response(null, { status: 400 }),
  )

  assert.equal(await requestTitle('first message', 20), null)
  assert.equal(mock.mock.callCount(), 1)
})

test('retries rate-limit and server errors once', async (t) => {
  for (const status of [429, 503]) {
    let calls = 0
    const mock = t.mock.method(overlayAppClient.chat, 'generateTitleResponse', async () => {
      calls++
      return calls === 1
        ? new Response(null, { status })
        : new Response(JSON.stringify({ title: 'A generated title' }), { status: 200 })
    })

    assert.equal(await requestTitle(`message ${status}`, 20), 'A generated title')
    assert.equal(mock.mock.callCount(), 2)
    mock.mock.restore()
  }
})

test('retries a network failure once', async (t) => {
  let calls = 0
  const mock = t.mock.method(overlayAppClient.chat, 'generateTitleResponse', async () => {
    calls++
    if (calls === 1) throw new TypeError('Network error')
    return new Response(JSON.stringify({ title: 'A generated title' }), { status: 200 })
  })

  assert.equal(await requestTitle('first message', 20), 'A generated title')
  assert.equal(mock.mock.callCount(), 2)
})
