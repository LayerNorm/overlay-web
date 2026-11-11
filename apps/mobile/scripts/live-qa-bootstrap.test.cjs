/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file, mocks) {
  const loaded = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { console, Error })(id => {
    assert.ok(Object.hasOwn(mocks, id), `Unexpected import ${id}`)
    return mocks[id]
  }, loaded, loaded.exports)
  return loaded.exports
}
function hooks() {
  const slots = []
  let index = 0, effects = []
  const changed = (a, b) => !a || a.some((value, i) => value !== b[i])
  const react = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    createContext: () => ({ Provider: 'Provider' }),
    useState(initial) {
      const i = index++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }]
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial } },
    useMemo(fn, deps) { const i = index++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) {
      const i = index++
      if (changed(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.()
        slots[i] = { deps, cleanup: fn() }
      })
    },
  }
  react.default = react
  return { react, render(fn) { index = 0; effects = []; const value = fn(); effects.forEach(effect => effect()); return value } }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const pending = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function session() {
  const hook = hooks(), calls = [], requests = []
  let user = { id: 'native-user' }, authLoading = false
  const cached = { user, uiSettings: {}, destinations: [] }
  const api = load('contexts/AppSessionContext.tsx', {
    react: hook.react,
    '@overlay/app-core': { CANONICAL_APP_DESTINATIONS: [], deriveOverlayCapabilities: () => ({}) },
    './AuthContext': { useAuth: () => ({ user, isAuthenticated: !!user, isLoading: authLoading }) },
    '../services/bootstrapService': {
      getCachedBootstrap: () => cached, setCachedBootstrap: async () => {}, clearBootstrapCache: async () => {},
      getAppBootstrap: options => { calls.push(options); const request = pending(); requests.push(request); return request.promise },
    },
    '../services/settingsService': { DEFAULT_UI_SETTINGS: {}, subscribeUiSettings: () => () => {}, loadCachedUiSettings: async () => null, persistUiSettings: async () => {} },
  })
  return { calls, requests, user: next => { user = next }, loading: value => { authLoading = value }, render: () => hook.render(() => api.AppSessionProvider({ children: 'shell' })).props.value }
}

test('initial bootstrap waits while stored authentication is hydrating and refreshing', () => {
  const state = session()
  state.loading(true)
  assert.equal(state.render().isInitialized, false)
  assert.equal(state.calls.length, 0)
  state.loading(false)
  assert.equal(state.render().isInitialized, false)
  assert.equal(state.calls.length, 1)
})

test('cached bootstrap cannot open native shell; sign-in and workspace refresh each await fresh bootstrap', async () => {
  const state = session()
  assert.equal(state.render().isInitialized, false)
  assert.equal(state.calls.length, 1)
  assert.equal(state.calls[0].forceRefresh, true)
  state.requests[0].resolve({ user: { id: 'native-user' }, uiSettings: {} })
  await tick()
  let value = state.render()
  assert.equal(value.isInitialized, true)
  assert.equal(state.calls.length, 1)
  const refresh = value.refresh({ forceRefresh: true })
  value = state.render()
  assert.equal(value.isInitialized, false)
  assert.equal(state.calls.length, 2)
  state.requests[1].resolve({ user: { id: 'native-user' }, uiSettings: {} })
  await refresh
  assert.equal(state.render().isInitialized, true)
})

test('bootstrap failure preserves the error state and retry waits for a successful native initialization', async () => {
  const state = session()
  state.render()
  state.requests[0].reject(new Error('Initialization unavailable'))
  await tick()
  let value = state.render()
  assert.equal(value.isInitialized, false)
  assert.equal(value.error, 'Initialization unavailable')
  const retry = value.refresh({ forceRefresh: true })
  assert.equal(state.render().error, null)
  state.requests[1].resolve({ user: { id: 'native-user' }, uiSettings: {} })
  await retry
  value = state.render()
  assert.equal(value.isInitialized, true)
  assert.equal(value.error, null)
})

test('late bootstrap from the previous sign-in cannot open a new user shell', async () => {
  const state = session()
  state.render()
  state.user(null)
  assert.equal(state.render().isInitialized, false)
  state.user({ id: 'another-user' })
  assert.equal(state.render().isInitialized, false)
  state.requests[0].resolve({ user: { id: 'native-user' }, uiSettings: {} })
  await tick()
  assert.equal(state.render().isInitialized, false)
  state.requests[1].resolve({ user: { id: 'another-user' }, uiSettings: {} })
  await tick()
  assert.equal(state.render().isInitialized, true)
})

test('Work waits for native authentication and detaches subscriptions when authentication is lost', () => {
  const hook = hooks(), calls = []
  let ready = false
  const api = load('hooks/useWork.ts', {
    react: hook.react,
    '../contexts/ConvexAuthProvider': { useNativeDataReady: () => ready },
    '../services/workService': {
      subscribeWorkList: (_workspace, _view, onItems, onContext) => {
        calls.push('subscribe'); onItems([]); onContext({ members: [] }); return () => calls.push('stop')
      },
    },
  })
  const render = () => hook.render(() => api.useWork('workspace', 'all'))
  render()
  assert.deepEqual(calls, [])
  ready = true
  render()
  assert.equal(render().items.length, 0)
  ready = false
  assert.equal(render().items, undefined)
  assert.deepEqual(calls, ['subscribe', 'stop'])
})

test('session gate hides query children while bootstrapping and retains Retry and sign-out on errors', async () => {
  const hook = hooks(), calls = []
  let initialized = false, error = null
  const api = load('components/shell/SessionGate.tsx', {
    react: hook.react, 'react-native': { View: 'View', ActivityIndicator: 'ActivityIndicator' },
    '../../contexts/AuthContext': { useAuth: () => ({ isAuthenticated: true, signOut: async () => calls.push('sign-out') }) },
    '../../contexts/AppSessionContext': { useAppSession: () => ({ isInitialized: initialized, error, refresh: async options => calls.push(options.forceRefresh) }) },
    '../../hooks/useTheme': { useTheme: () => ({ theme: {} }) },
    './primitives': { Button: 'Button', T: 'Text' },
  })
  const render = () => hook.render(() => api.SessionGate({ children: 'native-queries' }))
  assert.equal(JSON.stringify(render()).includes('native-queries'), false)
  error = 'Bootstrap failed'
  const tree = render()
  assert.equal(JSON.stringify(tree).includes('Bootstrap failed'), true)
  const buttons = tree.props.children.flatMap(item => item?.props?.children ?? []).filter(item => item?.type === 'Button')
  buttons[0].props.onPress(); buttons[1].props.onPress(); await tick()
  assert.deepEqual(calls, [true, 'sign-out'])
  initialized = true
  assert.equal(JSON.stringify(render()).includes('native-queries'), true)
})

test('workspace shell subscriptions wait for bootstrap and its existing error retry reinitializes bootstrap', async () => {
  const hook = hooks(), calls = []
  let initialized = false, error = null
  const api = load('contexts/WorkspaceContext.tsx', {
    react: hook.react,
    './AuthContext': { useAuth: () => ({ isAuthenticated: true, isLoading: false }) },
    './AppSessionContext': { useAppSession: () => ({ isInitialized: initialized, error, isLoading: false, refresh: async options => calls.push(['bootstrap', options.forceRefresh]) }) },
    './ConvexAuthProvider': { useNativeDataReady: () => true },
    '../services/appApi': { setRequestWorkspaceId: () => {} },
    '../services/workspaceService': { loadPersistedWorkspaceId: async () => null,
      subscribeWorkspaces: () => { calls.push('subscribe'); return () => {} },
      fetchWorkspaces: async () => { calls.push('fetch'); return { workspaces: [], activeWorkspaceId: '' } },
      isPersonalWorkspace: () => false, applyWorkspaceLocally: () => {},
    },
    '../services/workspaceManagementService': {},
  })
  const render = () => hook.render(() => api.WorkspaceProvider({ children: 'navigator' })).props.value
  render()
  assert.deepEqual(calls, [])
  error = 'Initialization unavailable'
  let value = render()
  assert.equal(value.isLoading, false)
  assert.equal(value.error, error)
  await value.refresh()
  assert.deepEqual(calls, [['bootstrap', true]])
  initialized = true; error = null
  render(); await tick(); value = render()
  assert.equal(value.error, null)
  assert.ok(calls.includes('subscribe'))
  assert.ok(calls.includes('fetch'))
})

test('bootstrap gates screen contents without unmounting the root navigator needed by auth callbacks', () => {
  const source = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8')
  assert.match(source, /screenLayout=\{SessionScreenLayout\}/)
  assert.match(source, /function SessionScreenLayout[^]*return <SessionGate>\{children\}<\/SessionGate>/)
  assert.doesNotMatch(source.slice(source.indexOf('export default function RootLayout')), /<SessionGate>/)
})
