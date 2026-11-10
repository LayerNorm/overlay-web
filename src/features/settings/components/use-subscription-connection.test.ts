import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldPollSubscriptionAuthorization, shouldStopSubscriptionFlow } from './use-subscription-connection'

test('callback authorization is expiry-timed instead of browser-polled', () => {
  assert.equal(shouldPollSubscriptionAuthorization({
    connectionId: 'connection-1',
    authorization: { url: 'https://provider.example/auth', expiresAt: Date.now() + 60_000, interval: 5, callbackRequired: true },
  }.authorization), false)
  assert.equal(shouldPollSubscriptionAuthorization({
    connectionId: 'connection-1',
    authorization: { url: 'https://provider.example/auth', expiresAt: Date.now() + 60_000, interval: 5 },
  }.authorization), true)
})

test('retryable callback errors keep the completion flow active', () => {
  assert.equal(shouldStopSubscriptionFlow({
    status: 'error',
    error: 'The callback does not match this authorization.',
    retryable: true,
  }), false)
  assert.equal(shouldStopSubscriptionFlow({ status: 'error', error: 'Authorization failed.' }), true)
  assert.equal(shouldStopSubscriptionFlow({ status: 'expired', error: 'Sign-in expired.' }), true)
})

test('device sign-in recovers from a retryable provider response without restarting authorization', async (t) => {
  const React = await import('react')
  const { createRequire } = await import('node:module')
  const { create } = createRequire(import.meta.url)('react-test-renderer') as {
    create: (element: React.ReactElement) => { unmount(): void }
  }
  const { useSubscriptionConnection } = await import('./use-subscription-connection')
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  let polls = 0
  let connected = 0
  let flow!: ReturnType<typeof useSubscriptionConnection>
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    if (!init?.body) return Response.json({ data: { available: true, providers: [] } })
    if (init.method === 'POST') return Response.json({ data: {
      connectionId: 'connection-1', authorization: {
        url: 'https://provider.example/auth', expiresAt: Date.now() + 60_000, interval: 5,
      },
    } })
    polls++
    return Response.json({ data: polls === 1
      ? { status: 'error', error: 'Provider temporarily unavailable.', retryable: true }
      : { status: 'connected', connection: { _id: 'connection-1' } } })
  })
  function Probe() {
    flow = useSubscriptionConnection({ onConnected: () => { connected++ }, onClose() {} })
    return null
  }
  let renderer!: ReturnType<typeof create>
  await React.act(async () => { renderer = create(React.createElement(Probe)) })
  t.after(async () => {
    await React.act(async () => { renderer.unmount() })
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  await React.act(async () => { await flow.start('xai') })
  await React.act(async () => { t.mock.timers.tick(5_000) })
  assert.equal(polls, 1)
  assert.equal(flow.stopped, false)
  assert.equal(flow.error, 'Provider temporarily unavailable.')
  await React.act(async () => { t.mock.timers.tick(5_000) })
  assert.equal(polls, 2)
  assert.equal(connected, 1)
  assert.equal(flow.connected?._id, 'connection-1')
  assert.equal(flow.stopped, true)
})

test('cancel closes the dialog even when cleanup of the pending sign-in fails (#454)', async (t) => {
  const React = await import('react')
  const { createRequire } = await import('node:module')
  const { create } = createRequire(import.meta.url)('react-test-renderer') as {
    create: (element: React.ReactElement) => { unmount(): void }
  }
  const { useSubscriptionConnection } = await import('./use-subscription-connection')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  let closed = 0
  const deletes: Array<{ url: string; headers?: HeadersInit }> = []
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      deletes.push({ url: String(url), headers: init.headers })
      return Response.json({ error: 'Failed to delete provider connection' }, { status: 500 })
    }
    if (!init?.body) return Response.json({ data: { available: true, providers: [] } })
    return Response.json({ data: {
      connectionId: 'connection-1', authorization: {
        url: 'https://provider.example/auth', userCode: 'ABCD-1234', expiresAt: Date.now() + 60_000, interval: 5,
      },
    } })
  })
  let flow!: ReturnType<typeof useSubscriptionConnection>
  function Probe() {
    flow = useSubscriptionConnection({ workspaceId: 'workspace-1', onConnected() {}, onClose: () => { closed++ } })
    return null
  }
  let renderer!: ReturnType<typeof create>
  await React.act(async () => { renderer = create(React.createElement(Probe)) })
  t.after(async () => {
    await React.act(async () => { renderer.unmount() })
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  await React.act(async () => { await flow.start('codex') })
  assert.equal(flow.login?.connectionId, 'connection-1')
  await React.act(async () => { flow.close() })
  assert.equal(closed, 1)
  assert.equal(deletes.length, 1)
  assert.match(deletes[0].url, /connectionId=connection-1/)
  assert.deepEqual(deletes[0].headers, { 'x-overlay-workspace-id': 'workspace-1' })
  await React.act(async () => { flow.close() })
  assert.equal(closed, 1)
})
