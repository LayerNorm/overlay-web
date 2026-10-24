import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { overlayAppClient } from '../app/overlay-app-client'
import { requestSessionState } from './browser-session'
import { fetchWithSessionRecovery } from './session-fetch'

function browser(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: new URL('https://app.example/app/chats') },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
}

function authenticated() {
  return Response.json({ authenticated: true, user: { id: 'test-user', email: 'qa@example.com' } })
}

test('app client recovers concurrent expired-session reads and a PATCH through one shared refresh', async (t) => {
  browser(t)
  let refreshed = false
  let refreshes = 0
  const attempts: Array<{ path: string; init?: RequestInit }> = []
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/auth/session') {
      refreshes++
      started.resolve()
      await release.promise
      refreshed = true
      return authenticated()
    }
    attempts.push({ path, init })
    return Response.json(refreshed ? { ok: true } : { error: 'Unauthorized' }, { status: refreshed ? 200 : 401 })
  })
  const reads = [
    overlayAppClient.conversations.getResponse({}),
    fetchWithSessionRecovery('/api/v1/conversations/test/participants'),
  ]
  const mutationInit = {
    method: 'PATCH',
    body: JSON.stringify({ conversationId: 'test', title: 'Kept once' }),
    headers: { 'Idempotency-Key': 'same-intent', 'x-overlay-workspace-id': 'workspace-test' },
  }
  const mutation = fetchWithSessionRecovery('/api/v1/conversations', mutationInit)
  await started.promise
  // Periodic auth checks and Convex recovery share this exact broker too.
  const session = requestSessionState()
  release.resolve()
  assert.deepEqual((await Promise.all([...reads, mutation])).map((r) => r.status), [200, 200, 200])
  assert.equal((await session).status, 'authenticated')
  assert.equal(refreshes, 1)
  assert.equal(attempts.length, 6)
  const writes = attempts.filter((a) => a.init?.method === 'PATCH')
  assert.equal(writes.length, 2)
  assert.equal(writes[0].init, mutationInit)
  assert.equal(writes[1].init, mutationInit)
})

test('a late 401 reuses a refresh completed since that request started', async (t) => {
  browser(t)
  const late = Promise.withResolvers<Response>()
  let refreshes = 0
  let lateAttempts = 0
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/session') { refreshes++; return authenticated() }
    if (String(input).endsWith('/late') && lateAttempts++ === 0) return late.promise
    return Response.json({}, { status: refreshes ? 200 : 401 })
  })
  const pending = fetchWithSessionRecovery('/api/v1/late')
  assert.equal((await fetchWithSessionRecovery('/api/v1/conversations')).status, 200)
  late.resolve(Response.json({}, { status: 401 }))
  assert.equal((await pending).status, 200)
  assert.equal(refreshes, 1)
  assert.equal(lateAttempts, 2)
})

test('refresh is bounded and preserves terminal or transient failures', async (t) => {
  browser(t)
  for (const result of ['guest', 'unavailable', 'network', 'invalid-json', 'still-unauthorized']) {
    let calls = 0
    let refreshes = 0
    const unauthorized = Response.json({ error: 'Unauthorized' }, { status: 401 })
    const mock = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      if (String(input) !== '/api/auth/session') { calls++; return unauthorized }
      refreshes++
      if (result === 'network') throw new Error('unavailable')
      if (result === 'unavailable') return Response.json({}, { status: 503 })
      if (result === 'invalid-json') return new Response('{', { headers: { 'content-type': 'application/json' } })
      return result === 'guest' ? Response.json({ authenticated: false }) : authenticated()
    })
    assert.equal(await fetchWithSessionRecovery('/api/v1/conversations'), unauthorized)
    assert.equal(refreshes, 1, result)
    assert.equal(calls, result === 'still-unauthorized' ? 2 : 1, result)
    mock.mock.restore()
  }
})

test('recovery never refreshes permission errors, non-browser or non-cookie requests', async (t) => {
  let calls = 0
  let status = 401
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status }) })
  await fetchWithSessionRecovery('https://app.example/api/v1/conversations')
  assert.equal(calls, 1, 'SSR is unchanged')
  browser(t)
  const cases: Array<[RequestInfo | URL, RequestInit?]> = [
    ['https://other.example/api/v1/conversations'],
    ['/api/auth/session'],
    ['/api/v1/conversations', { credentials: 'omit' }],
    ['/api/v1/conversations', { headers: { authorization: 'Bearer fixture' } }],
    ['/api/v1/conversations', { method: 'POST', body: new ReadableStream() }],
    [new Request('https://app.example/api/v1/conversations')],
  ]
  for (const [input, init] of cases) await fetchWithSessionRecovery(input, init)
  for (status of [200, 403, 429, 500]) await fetchWithSessionRecovery('/api/v1/conversations')
  assert.equal(calls, 1 + cases.length + 4)
})

test('workspace fetches carry their tab route on initial and retry requests', async (t) => {
  browser(t)
  const location = (window as unknown as { location: URL }).location
  location.pathname = '/w/team-a/work'
  const targets: Array<string | null> = []
  let attempts = 0
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/auth/session') return authenticated()
    targets.push(new Headers(init?.headers).get('x-overlay-route-workspace'))
    return new Response(null, { status: attempts++ === 0 ? 401 : 200 })
  })
  await fetchWithSessionRecovery('/api/v1/files', {
    headers: { 'x-overlay-workspace-id': 'persisted-team-b' },
  })
  assert.deepEqual(targets, ['handle:team-a', 'handle:team-a'])
})

test('account, resolver, explicit-management, cross-origin, and bearer requests are not route-scoped', async (t) => {
  browser(t)
  ;(window as unknown as { location: URL }).location.pathname = '/w/team-a/work'
  const targets: Array<string | null> = []
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    targets.push(new Headers(init?.headers).get('x-overlay-route-workspace'))
    return Response.json({})
  })
  await fetchWithSessionRecovery('/api/v1/account/workspaces')
  await fetchWithSessionRecovery('/api/v1/workspace-handles/team-a')
  await fetchWithSessionRecovery('/api/v1/workspaces/workspace-a/handle')
  await fetchWithSessionRecovery('https://other.example/api/v1/files')
  await fetchWithSessionRecovery('/api/v1/files', { headers: { Authorization: 'Bearer native' } })
  assert.deepEqual(targets, [null, null, null, null, null])
})

test('an explicit cache workspace survives an old browser route and session recovery', async (t) => {
  browser(t)
  ;(window as unknown as { location: URL }).location.pathname = '/w/old-org/workspace/chat'
  const targets: Array<string | null> = []
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/auth/session') return authenticated()
    targets.push(new Headers(init?.headers).get('x-overlay-route-workspace'))
    return new Response(null, { status: targets.length === 1 ? 401 : 200 })
  })
  await fetchWithSessionRecovery('/api/v1/conversations', {
    headers: { 'x-overlay-route-workspace': 'id:personal-id' },
  })
  assert.deepEqual(targets, ['id:personal-id', 'id:personal-id'])
})

test('aborting one caller during shared refresh never replays its mutation', async (t) => {
  browser(t)
  const controller = new AbortController()
  let writes = 0
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/session') {
      controller.abort()
      return authenticated()
    }
    writes++
    return new Response(null, { status: 401 })
  })
  await assert.rejects(fetchWithSessionRecovery('/api/v1/conversations', {
    method: 'PATCH', body: '{}', signal: controller.signal,
  }), { name: 'AbortError' })
  assert.equal(writes, 1)
})

test('session checks keep the cross-tab Web Lock and clear in-flight state after failure', async (t) => {
  const locks = Object.getOwnPropertyDescriptor(navigator, 'locks')
  const names: string[] = []
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (name: string, run: () => unknown) => { names.push(name); return run() } },
  })
  t.after(() => {
    if (locks) Object.defineProperty(navigator, 'locks', locks)
    else Reflect.deleteProperty(navigator, 'locks')
  })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    if (calls++ === 0) throw new Error('offline')
    return authenticated()
  })
  assert.equal((await requestSessionState()).status, 'transient-error')
  assert.equal((await requestSessionState()).status, 'authenticated')
  assert.deepEqual(names, ['overlay:auth-session-refresh', 'overlay:auth-session-refresh'])
})
