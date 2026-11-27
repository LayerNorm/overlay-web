/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(source, mocks, globals = {}) {
  const loaded = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { console: { log() {}, warn() {}, error() {} }, Error, Date, Headers, URL, Request, AbortController, setTimeout, clearTimeout, ...globals })(id => {
    assert.ok(Object.hasOwn(mocks, id), 'Unexpected import ' + id)
    return mocks[id]
  }, loaded, loaded.exports)
  return loaded.exports
}
const session = (token = 'old', id = 'user') => ({ accessToken: token, refreshToken: `refresh-${token}`, user: { id }, expiresAt: Date.now() + 3600000 })
function http(statuses, options = {}) {
  let stored = options.empty ? null : session(), refreshes = 0
  const calls = []
  const service = load(fs.readFileSync(path.join(root, 'services/appApi.ts'), 'utf8'), {
    './appConfig': { AUTH_BASE_URL: 'https://example.test' },
    './authService': {
      loadAuthSession: async () => stored,
      refreshAuthSession: async () => { refreshes++; if (options.failRefresh) throw new Error('Unavailable'); options.onRefresh?.(service); return session('new') },
      saveRefreshedAuthSession: async (next, previous) => { if (stored?.user.id !== previous.user.id) throw new Error('Session changed'); stored = next },
      clearAuthSession: async () => { stored = null },
    },
  }, { fetch: async (url, init) => {
    calls.push({ url, init })
    options.onResponse?.(value => { stored = value })
    return new Response('{}', { status: statuses[Math.min(calls.length - 1, statuses.length - 1)] })
  } })
  return { service, calls, refreshes: () => refreshes, stored: () => stored }
}

test('bootstrap transport refreshes once after a 401, preserving request scope and headers', async () => {
  const state = http([401, 200], { onRefresh: service => service.setRequestWorkspaceId('other-workspace') })
  state.service.setRequestWorkspaceId('original-workspace')
  const result = await state.service.appFetch('/api/v1/bootstrap', { headers: { 'X-Request-Test': 'preserve' } })
  assert.equal(result.status, 200)
  assert.equal(state.refreshes(), 1)
  assert.equal(state.calls.length, 2)
  assert.equal(state.calls[0].init.headers.get('Authorization'), 'Bearer old')
  assert.equal(state.calls[1].init.headers.get('Authorization'), 'Bearer new')
  assert.equal(state.calls[1].init.headers.get('x-overlay-workspace-id'), 'original-workspace')
  assert.equal(state.calls[1].init.headers.get('X-Request-Test'), 'preserve')
})

test('JSON requests retry once with refreshed credentials and the same idempotency key', async () => {
  const state = http([401, 200])
  const response = await state.service.appRequest('/api/v1/example', { method: 'POST', json: { turnId: 'turn' }, headers: { 'Idempotency-Key': 'stable-turn' } })
  assert.equal(response.status, 200)
  assert.equal(state.calls.length, 2)
  // The refreshed token rides in the Authorization header; the body is the caller's JSON only.
  assert.equal(state.calls[1].init.headers.get('Authorization'), 'Bearer new')
  assert.deepEqual(JSON.parse(state.calls[1].init.body), { turnId: 'turn' })
  assert.equal(state.calls[1].init.headers.get('Idempotency-Key'), 'stable-turn')
})

test('timeout zero keeps owner cancellation without scheduling a timeout; positive timeout still aborts', async () => {
  const timers = []
  const calls = []
  let releaseFetch
  let fetchStarted
  const started = new Promise(resolve => { fetchStarted = resolve })
  const fetchGate = new Promise(resolve => { releaseFetch = resolve })
  const source = fs.readFileSync(path.join(root, 'services/appApi.ts'), 'utf8')
  const state = load(source, {
    './appConfig': { AUTH_BASE_URL: 'https://example.test' },
    './authService': {
      loadAuthSession: async () => session(), refreshAuthSession: async () => session('new'),
      saveRefreshedAuthSession: async () => {}, clearAuthSession: async () => {},
    },
  }, {
    fetch: async (...args) => { calls.push(args); fetchStarted(); return fetchGate },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout() {},
  })
  const owner = new AbortController()
  const request = state.appRequest('/api/v1/media', { timeoutMs: 0, signal: owner.signal })
  await started
  assert.equal(timers.length, 0)
  const fetchSignal = calls[0][1].signal
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(fetchSignal.aborted, false)
  owner.abort()
  assert.equal(fetchSignal.aborted, true)
  releaseFetch(new Response('{}', { status: 200 }))
  await request

  const finiteTimers = []
  let finiteFetchSignal
  const finite = load(source, {
    './appConfig': { AUTH_BASE_URL: 'https://example.test' },
    './authService': {
      loadAuthSession: async () => session(), refreshAuthSession: async () => session('new'),
      saveRefreshedAuthSession: async () => {}, clearAuthSession: async () => {},
    },
  }, {
    fetch: async (_url, init) => { finiteFetchSignal = init.signal; return new Promise(() => {}) },
    setTimeout: (fn, ms) => { finiteTimers.push({ fn, ms }); return finiteTimers.length },
    clearTimeout() {},
  })
  void finite.appRequest('/api/v1/media', { timeoutMs: 25 })
  for (let i = 0; i < 10 && !finiteFetchSignal; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(finiteTimers[0].ms, 25)
  finiteTimers[0].fn()
  assert.equal(finiteFetchSignal.aborted, true)
})

test('a pre-aborted owner signal skips stream authentication and dispatch', async () => {
  let authLoads = 0
  let fetchCalls = 0
  const xhrInstances = []
  class FakeXhr {
    constructor() { xhrInstances.push(this) }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() {}
  }
  const service = load(fs.readFileSync(path.join(root, 'services/appApi.ts'), 'utf8'), {
    './appConfig': { AUTH_BASE_URL: 'https://example.test' },
    './authService': {
      loadAuthSession: async () => { authLoads++; return session() },
      refreshAuthSession: async () => session('new'),
      saveRefreshedAuthSession: async () => {},
      clearAuthSession: async () => {},
    },
  }, { XMLHttpRequest: FakeXhr, fetch: async () => { fetchCalls++; return new Response('{}', { status: 200 }) } })
  const owner = new AbortController()
  owner.abort()
  const stream = service.appXhrStreamSse('/api/v1/stream', { signal: owner.signal })
  await assert.rejects(stream.next(), error => error.name === 'AbortError')
  assert.equal(authLoads, 0)
  assert.equal(fetchCalls, 0)
  assert.equal(xhrInstances.length, 0)
})

test('return and throw from a waiting XHR SSE iterator abort unfinished requests', async () => {
  const instances = []
  class FakeXhr {
    readyState = 1
    status = 200
    responseText = ''
    aborted = false
    open() {}
    setRequestHeader() {}
    send() {}
    abort() { this.aborted = true; this.readyState = 4; this.onabort?.() }
    onprogress = null
    onload = null
    onerror = null
    onabort = null
    ontimeout = null
    constructor() { instances.push(this) }
  }
  const state = load(fs.readFileSync(path.join(root, 'services/appApi.ts'), 'utf8'), {
    './appConfig': { AUTH_BASE_URL: 'https://example.test' },
    './authService': {
      loadAuthSession: async () => session(), refreshAuthSession: async () => session('new'),
      saveRefreshedAuthSession: async () => {}, clearAuthSession: async () => {},
    },
  }, { XMLHttpRequest: FakeXhr, fetch: async () => new Response('{}', { status: 200 }) })
  const iterator = state.appXhrStreamSse('/api/v1/stream', { timeoutMs: 0 })
  const pending = iterator.next()
  for (let i = 0; i < 10 && !instances.length; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(instances.length, 1)
  await iterator.return()
  await pending.catch(() => {})
  assert.equal(instances[0].aborted, true)

  const throwingIterator = state.appXhrStreamSse('/api/v1/stream', { timeoutMs: 0 })
  const pendingThrow = throwingIterator.next()
  for (let i = 0; i < 10 && instances.length < 2; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(instances.length, 2)
  const throwing = throwingIterator.throw(new Error('consumer stopped'))
  let timer
  const settled = await Promise.race([
    Promise.allSettled([pendingThrow, throwing]).then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 1000) }),
  ])
  clearTimeout(timer)
  assert.equal(settled, true)
  assert.equal(instances[1].aborted, true)
})

test('owner cancellation during deferred session preparation prevents stale fetch and XHR dispatch', async () => {
  let releaseSession
  let sessionStarted
  const started = new Promise(resolve => { sessionStarted = resolve })
  const pendingSession = new Promise(resolve => { releaseSession = resolve })
  const calls = []
  const service = load(fs.readFileSync(path.join(root, 'services/appApi.ts'), 'utf8'), {
    './appConfig': { AUTH_BASE_URL: 'https://example.test' },
    './authService': {
      loadAuthSession: async () => { sessionStarted(); return pendingSession },
      refreshAuthSession: async () => { throw new Error('Unexpected refresh') },
      saveRefreshedAuthSession: async () => {},
      clearAuthSession: async () => {},
    },
  }, { fetch: async (...args) => { calls.push(args); return new Response('{}', { status: 200 }) } })
  service.setRequestWorkspaceId('workspace-old')
  const owner = new AbortController()
  const request = service.appRequest('/api/v1/skills', {
    method: 'POST', json: { name: 'old-user skill' }, workspaceId: 'workspace-old', signal: owner.signal,
  })
  await started
  service.setRequestWorkspaceId('workspace-new')
  owner.abort()
  releaseSession(session('old-token', 'old-user'))
  await assert.rejects(request, error => error.name === 'AbortError')
  assert.equal(calls.length, 0)

  let releaseStreamSession
  let streamStarted
  const streamGateStarted = new Promise(resolve => { streamStarted = resolve })
  const streamGate = new Promise(resolve => { releaseStreamSession = resolve })
  const streamXhrs = []
 class StreamXhr {
   constructor() { streamXhrs.push(this) }
   open() {}
   setRequestHeader() {}
    send() { this.onload?.() }
    abort() { this.onabort?.() }
    onload = null
    onabort = null
  }
  const streamService = load(fs.readFileSync(path.join(root, 'services/appApi.ts'), 'utf8'), {
    './appConfig': { AUTH_BASE_URL: 'https://example.test' },
    './authService': {
      loadAuthSession: async () => { streamStarted(); return streamGate },
      refreshAuthSession: async () => { throw new Error('Unexpected refresh') },
      saveRefreshedAuthSession: async () => {},
      clearAuthSession: async () => {},
    },
  }, { XMLHttpRequest: StreamXhr, fetch: async (...args) => { calls.push(args); return new Response('{}', { status: 200 }) } })
  const streamOwner = new AbortController()
  const stream = streamService.appXhrStreamSse('/api/v1/conversations/act', {
    method: 'POST', json: { conversationId: 'old-chat' }, workspaceId: 'workspace-old', signal: streamOwner.signal,
  })
  const firstChunk = stream.next()
  await streamGateStarted
  streamService.setRequestWorkspaceId('workspace-new')
  streamOwner.abort()
  releaseStreamSession(session('old-token', 'old-user'))
  await assert.rejects(firstChunk, error => error.name === 'AbortError')
  assert.equal(calls.length, 0)
  assert.equal(streamXhrs.length, 0)
})

test('successful reads and forbidden responses do not refresh; repeated 401 stops after one retry', async () => {
  for (const status of [200, 403]) {
    const state = http([status])
    assert.equal((await state.service.appFetch('/api/v1/bootstrap')).status, status)
    assert.equal(state.refreshes(), 0)
    assert.equal(state.calls.length, 1)
  }
  const state = http([401])
  assert.equal((await state.service.appFetch('/api/v1/bootstrap')).status, 401)
  assert.equal(state.refreshes(), 1)
  assert.equal(state.calls.length, 2)
})

test('missing sessions, failed refresh and account changes retain the original error without replaying under another user', async () => {
  for (const options of [{ empty: true }, { failRefresh: true }, { onResponse: set => set(session('other', 'another-user')) }]) {
    const state = http([401], options)
    assert.equal((await state.service.appFetch('/api/v1/bootstrap')).status, 401)
    assert.equal(state.calls.length, 1)
  }
})

test('a token rotated by another request is reused without refreshing twice', async () => {
  const state = http([401, 200], { onResponse: set => set(session('already-refreshed')) })
  assert.equal((await state.service.appFetch('/api/v1/bootstrap')).status, 200)
  assert.equal(state.refreshes(), 0)
  assert.equal(state.calls[1].init.headers.get('Authorization'), 'Bearer already-refreshed')
})

function restore(globals) {
  const file = ts.createSourceFile('AuthContext.tsx', fs.readFileSync(path.join(root, 'contexts/AuthContext.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText() === 'restoreStoredSession') callback = node.initializer.arguments[0].getText(); ts.forEachChild(node, visit) }
  visit(file)
  assert.ok(callback)
  const authGenerationRef = { current: 0 }
  const saveRefreshedAuthSessionIfCurrent = globals.saveRefreshedAuthSessionIfCurrent ?? (async (next, previous) => {
    await globals.saveRefreshedAuthSession?.(next, previous)
    return next
  })
  const clearAuthSessionIfCurrent = globals.clearAuthSessionIfCurrent ?? (async expected => {
    const current = await globals.loadAuthSession()
    if (
      !current || current.user.id !== expected.user.id ||
      current.accessToken !== expected.accessToken || current.refreshToken !== expected.refreshToken
    ) return false
    await globals.clearAuthSession?.()
    return true
  })
  const isInvalidOrExpiredSessionError = globals.isInvalidOrExpiredSessionError ?? (error => {
    const message = globals.getErrorMessage?.(error) ?? (error instanceof Error ? error.message : '')
    return message.toLowerCase().includes('invalid') || message.toLowerCase().includes('expired')
  })
  const action = load(`exports.restore = ${callback}`, {}, {
    ...globals,
    authGenerationRef,
    saveRefreshedAuthSessionIfCurrent,
    clearAuthSessionIfCurrent,
    isInvalidOrExpiredSessionError,
  }).restore
  return () => action(authGenerationRef.current)
}

test('cold-start restore waits for refresh and durable storage before exposing authentication', async () => {
  const events = []
  let release
  const pending = new Promise(resolve => { release = resolve })
  const action = restore({
    loadAuthSession: async () => session(), refreshAuthSession: () => pending,
    saveRefreshedAuthSession: async () => events.push('saved'), hydrateSession: async value => events.push(value.accessToken),
  })
  const finished = action()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, [])
  release(session('new'))
  await finished
  assert.deepEqual(events, ['saved', 'new'])
})

test('restore handles empty storage, offline fallback and expired credentials without clearing a newer account', async () => {
  for (const scenario of ['empty', 'offline', 'expired', 'changed']) {
    const events = []
    let reads = 0
    const action = restore({
      loadAuthSession: async () => { reads++; return scenario === 'empty' ? null : scenario === 'changed' && reads > 1 ? session('other', 'another-user') : session() },
      refreshAuthSession: async () => { throw new Error(scenario === 'offline' ? 'Network unavailable' : 'Session expired') },
      getErrorMessage: error => error.message,
      clearAuthSession: async () => events.push('clear'), applySignedOutState: () => events.push('signed-out'),
      setAuthError: () => events.push('error'), hydrateSession: async value => events.push(value.accessToken),
    })
    await action()
    assert.deepEqual(events, scenario === 'empty' ? ['signed-out'] : scenario === 'offline' ? ['old'] : scenario === 'expired' ? ['clear', 'signed-out', 'error'] : [])
  }
})
