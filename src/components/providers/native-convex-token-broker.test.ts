import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativeConvexTokenFetcher } from './native-convex-token-broker'

test('native tokens use a separate endpoint, force refresh and deduplicate matching requests', async (t) => {
  let refreshes = 0
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/api/auth/convex-token')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.credentials, 'same-origin')
    requests++
    return Response.json({ token: 'native-token', userId: 'user-a' })
  })
  const fetchToken = createNativeConvexTokenFetcher('user-a', async () => { refreshes++ })
  assert.deepEqual(await Promise.all([
    fetchToken({ forceRefreshToken: true }), fetchToken({ forceRefreshToken: true }),
  ]), ['native-token', 'native-token'])
  assert.equal(refreshes, 1)
  assert.equal(requests, 1)
  assert.equal(await fetchToken({ forceRefreshToken: true }), 'native-token')
  assert.equal(refreshes, 2)
})

test('anonymous and switched identities never receive another session token', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return Response.json({ token: 'new-user-token', userId: 'user-b' })
  })
  const refresh = async () => {}
  assert.equal(await createNativeConvexTokenFetcher(null, refresh)({ forceRefreshToken: true }), null)
  assert.equal(requests, 0)
  const oldUser = createNativeConvexTokenFetcher('user-a', refresh)
  const newUser = createNativeConvexTokenFetcher('user-b', refresh)
  assert.deepEqual(await Promise.all([
    oldUser({ forceRefreshToken: false }), newUser({ forceRefreshToken: false }),
  ]), [null, 'new-user-token'])
  assert.equal(requests, 2)
})

test('expired session gets one locked refresh; failures return null without retry loops', async (t) => {
  let requests = 0
  let refreshes = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return requests === 1 ? Response.json({}, { status: 401 }) : Response.json({ token: 'fresh', userId: 'user-a' })
  })
  const fetchToken = createNativeConvexTokenFetcher('user-a', async () => { refreshes++ })
  assert.equal(await fetchToken({ forceRefreshToken: false }), 'fresh')
  assert.equal(requests, 2)
  assert.equal(refreshes, 1)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  assert.equal(await fetchToken({ forceRefreshToken: false }), null)
})

test('forced refresh cannot reuse an in-flight non-forced token read', async (t) => {
  let finish!: (response: Response) => void
  let requests = 0
  let refreshes = 0
  t.mock.method(globalThis, 'fetch', async () => {
    if (++requests === 1) return new Promise<Response>((resolve) => { finish = resolve })
    return Response.json({ token: 'rotated', userId: 'user-a' })
  })
  const fetchToken = createNativeConvexTokenFetcher('user-a', async () => { refreshes++ })
  const stale = fetchToken({ forceRefreshToken: false })
  assert.equal(await fetchToken({ forceRefreshToken: true }), 'rotated')
  assert.equal(refreshes, 1)
  finish(Response.json({ token: 'previous', userId: 'user-a' }))
  await stale
})

test('a failed token request for a signed-in user reports the failure so the caller can retry', async (t) => {
  const responses = [new Response('busy', { status: 503 }), Response.json({ token: 'later-token', userId: 'user-a' })]
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  let failures = 0
  const fetchToken = createNativeConvexTokenFetcher('user-a', async () => {}, () => { failures++ })
  assert.equal(await fetchToken({ forceRefreshToken: false }), null)
  assert.equal(failures, 1)
  assert.equal(await fetchToken({ forceRefreshToken: false }), 'later-token')
  assert.equal(failures, 1)
})

test('network errors and timeouts also report a failure; signed-out callers never do', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('network down') })
  let failures = 0
  assert.equal(await createNativeConvexTokenFetcher('user-a', async () => {}, () => { failures++ })({ forceRefreshToken: true }), null)
  assert.equal(failures, 1)
  assert.equal(await createNativeConvexTokenFetcher(null, async () => {}, () => { failures++ })({ forceRefreshToken: true }), null)
  assert.equal(failures, 1)
})
