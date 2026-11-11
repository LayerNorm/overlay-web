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
  assert.equal(JSON.parse(state.calls[1].init.body).accessToken, 'new')
  assert.equal(state.calls[1].init.headers.get('Idempotency-Key'), 'stable-turn')
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
  return load(`exports.restore = ${callback}`, {}, globals).restore
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
