/* eslint-disable @typescript-eslint/no-require-imports */
require('./register-native-transcript-test-runtime.cjs')
require('tsx/cjs')

const assert = require('node:assert/strict')
const Module = require('node:module')
const test = require('node:test')
const React = require('../../node_modules/react')
const { act, create } = require('../../node_modules/react-test-renderer')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const AUTH_STORAGE_KEY = 'overlay-auth-session'
const state = {
  secureValues: new Map(),
  secureReads: 0,
  initialUrl: null,
  initialUrlPromise: null,
  initialUrlRequested: null,
  transferPlans: [],
  transferCalls: [],
  secureWriteGate: null,
  appStateListeners: new Set(),
  linkListeners: new Set(),
  bootstrapRequests: [],
  refreshPlans: [],
  refreshCalls: [],
  cachedBootstrap: null,
  authView: null,
  appSessionView: null,
  nativeReady: false,
  transitions: [],
  pickerMounts: 0,
  activePickerMounts: new Set(),
  pickerProbe: null,
  pickerSelection: null,
}

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const tick = async () => {
  for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve))
}

async function waitFor(predicate, label) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for ${label}; authRefreshes=${state.refreshCalls.length}, secureReads=${state.secureReads}, bootstrapRequests=${state.bootstrapRequests.length}, authLoading=${state.authView?.isLoading ?? 'unrendered'}, authenticated=${state.authView?.isAuthenticated ?? 'unrendered'}`)
}

function session(userId, version) {
  return {
    accessToken: `access-${userId}-${version}`,
    refreshToken: `refresh-${userId}-${version}`,
    expiresAt: Date.now() + 3_600_000,
    user: { id: userId, email: `${userId}@example.test` },
  }
}

function authResponse(nextSession, status = 200, error) {
  return new Response(JSON.stringify(status >= 200 && status < 300
    ? { success: true, session: nextSession }
    : { success: false, error }), { status })
}

const secureStore = {
  async getItemAsync(key) {
    state.secureReads++
    return state.secureValues.get(key) ?? null
  },
  async setItemAsync(key, value) {
    if (key === AUTH_STORAGE_KEY && state.secureWriteGate) {
      const gate = state.secureWriteGate
      state.secureWriteGate = null
      gate.started.resolve()
      await gate.release.promise
    }
    state.secureValues.set(key, value)
  },
  async deleteItemAsync(key) {
    state.secureValues.delete(key)
  },
}

const appState = {
  currentState: 'active',
  addEventListener(_event, listener) {
    state.appStateListeners.add(listener)
    return { remove: () => state.appStateListeners.delete(listener) }
  },
}

const linking = {
  getInitialURL: async () => {
    state.initialUrlRequested?.resolve()
    return state.initialUrlPromise ?? state.initialUrl
  },
  addEventListener(_event, listener) {
    state.linkListeners.add(listener)
    return { remove: () => state.linkListeners.delete(listener) }
  },
}

const reactNative = {
  ActivityIndicator: 'ActivityIndicator',
  AppState: appState,
  Linking: linking,
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}

const originalLoad = Module._load
Module._load = function loadProviderTestDependencies(request, parent, isMain) {
  const filename = parent?.filename ?? ''
  if (request === 'react-native') return reactNative
  if (request === 'expo-secure-store') return secureStore
  if (request === 'expo-crypto') {
    return {
      CryptoDigestAlgorithm: { SHA256: 'SHA256' },
      CryptoEncoding: { BASE64: 'base64' },
      digestStringAsync: async () => 'test-digest',
      getRandomBytesAsync: async length => new Uint8Array(length),
    }
  }
  if (filename.endsWith('/services/authService.ts') && request === './appConfig') {
    return { AUTH_BASE_URL: 'https://auth.example.test' }
  }
  if (filename.endsWith('/contexts/AuthContext.tsx')) {
    const mocks = {
      '../services/bootstrapService': bootstrapService,
      '../services/pushRegistrationService': { unregisterPushRegistration: async () => {} },
      '../services/accountDeletionService': {
        getAccountDeletionState: () => ({ busy: false }),
        isAccountDeletionCallback: () => false,
      },
      '../services/settingsService': { clearUiSettingsCache: async () => {} },
      '../services/voiceService': {
        clearVoiceAuthSessionFromAppGroup: async () => {},
        disableBackgroundVoice: async () => {},
      },
    }
    if (Object.hasOwn(mocks, request)) return mocks[request]
  }
  if (filename.endsWith('/contexts/AppSessionContext.tsx')) {
    const mocks = {
      '../services/bootstrapService': bootstrapService,
      '../services/settingsService': settingsService,
    }
    if (Object.hasOwn(mocks, request)) return mocks[request]
  }
  if (filename.endsWith('/components/shell/SessionGate.tsx')) {
    const mocks = {
      '../../hooks/useTheme': { useTheme: () => ({ theme: { background: '#111', foreground: '#eee', muted: '#aaa' } }) },
      './primitives': {
        Button: props => React.createElement('Button', props),
        T: props => React.createElement('Text', props),
      },
      './EntryScreens': { WorkspaceGate: () => React.createElement('WorkspaceGate') },
    }
    if (Object.hasOwn(mocks, request)) return mocks[request]
  }
  return originalLoad.call(this, request, parent, isMain)
}

const bootstrapService = {
  clearBootstrapCache: async () => { state.cachedBootstrap = null },
  getAppBootstrap: options => {
    const request = { ...deferred(), options }
    state.bootstrapRequests.push(request)
    return request.promise
  },
  getCachedBootstrap: () => state.cachedBootstrap,
  setCachedBootstrap: async value => { state.cachedBootstrap = value },
}

const settingsService = {
  DEFAULT_UI_SETTINGS: {},
  loadCachedUiSettings: async () => null,
  persistUiSettings: async () => {},
  subscribeUiSettings: () => () => {},
  updateUiSettings: async () => {},
}

const { AuthProvider, useAuth } = require('../contexts/AuthContext.tsx')
const { AppSessionProvider, useAppSession } = require('../contexts/AppSessionContext.tsx')
const { SessionGate } = require('../components/shell/SessionGate.tsx')

globalThis.fetch = async (url, init) => {
  if (String(url).includes('/api/auth/desktop-link?')) {
    state.transferCalls.push(String(url))
    const plan = state.transferPlans.shift()
    if (!plan) throw new Error('No transfer response was arranged')
    return plan()
  }
  if (!String(url).endsWith('/api/auth/native/refresh')) throw new Error(`Unexpected fetch: ${url}`)
  const body = JSON.parse(String(init?.body ?? '{}'))
  state.refreshCalls.push(body)
  const plan = state.refreshPlans.shift()
  if (!plan) throw new Error('No auth refresh response was arranged')
  return plan(body)
}

function PickerProbe() {
  const [mountId] = React.useState(() => ++state.pickerMounts)
  const [selectedName, setSelectedName] = React.useState(null)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    state.activePickerMounts.add(mountId)
    return () => {
      mounted.current = false
      state.activePickerMounts.delete(mountId)
    }
  }, [mountId])

  const onPickFile = async () => {
    const selected = await state.pickerSelection.promise
    if (!mounted.current) return
    setSelectedName(selected.name)
  }

  state.pickerProbe = { mountId, selectedName, onPickFile }
  return React.createElement('PickerProbe', { mountId, selectedName })
}

function ProviderStackContent() {
  const auth = useAuth()
  const appSession = useAppSession()
  const nativeReady = !auth.isLoading && auth.isAuthenticated
  state.authView = auth
  state.appSessionView = appSession
  state.nativeReady = nativeReady
  state.transitions.push({
    authLoading: auth.isLoading,
    authenticated: auth.isAuthenticated,
    nativeReady,
    appSessionInitialized: appSession.isInitialized,
    bootstrapCount: state.bootstrapRequests.length,
  })

  return React.createElement(SessionGate, null,
    nativeReady ? React.createElement(PickerProbe) : React.createElement('NativeLoading'))
}

function providerStack() {
  return React.createElement(AuthProvider, null,
    React.createElement(AppSessionProvider, null,
      React.createElement(ProviderStackContent)))
}

function reset(initialSession, firstRefreshPlan) {
  state.secureValues.clear()
  state.secureReads = 0
  state.initialUrl = null
  state.initialUrlPromise = null
  state.initialUrlRequested = null
  state.transferPlans = []
  state.transferCalls = []
  state.secureWriteGate = null
  state.appStateListeners.clear()
  state.linkListeners.clear()
  state.bootstrapRequests = []
  state.refreshPlans = [firstRefreshPlan]
  state.refreshCalls = []
  state.cachedBootstrap = null
  state.authView = null
  state.appSessionView = null
  state.nativeReady = false
  state.transitions = []
  state.pickerMounts = 0
  state.activePickerMounts.clear()
  state.pickerProbe = null
  state.pickerSelection = null
  if (initialSession) state.secureValues.set(AUTH_STORAGE_KEY, JSON.stringify(initialSession))
}

async function mountReadyStack(initialSession = session('user-a', 'initial')) {
  reset(initialSession, async () => authResponse(session(initialSession.user.id, 'restored')))
  let renderer
  try {
    await act(async () => { renderer = create(providerStack()) })
    await act(async () => { await tick() })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 1, 'initial app bootstrap') })
    await act(async () => {
      state.bootstrapRequests[0].resolve({ user: initialSession.user })
      await tick()
    })
    assert.equal(state.appSessionView?.isInitialized, true, 'initial bootstrap should initialize the real AppSessionProvider')
  } catch (error) {
    if (renderer) await act(async () => renderer.unmount())
    throw error
  }
  assert.equal(state.nativeReady, true)
  assert.equal(state.pickerMounts, 1)
  return renderer
}

async function emitActive() {
  await act(async () => {
    for (const listener of [...state.appStateListeners]) listener('active')
    await tick()
  })
}

test('same-owner foreground renewal preserves native readiness and pending picker state; resumes coalesce', async () => {
  const renderer = await mountReadyStack()
  const initialMountId = state.pickerProbe.mountId
  const selection = deferred()
  const refreshStarted = deferred()
  const refreshResponse = deferred()
  state.pickerSelection = selection
  state.refreshPlans.push(async () => {
    refreshStarted.resolve()
    return refreshResponse.promise
  })

  try {
    await act(async () => {
      void state.pickerProbe.onPickFile()
      await tick()
    })
    const readsBeforeResume = state.secureReads
    await act(async () => {
      for (const listener of [...state.appStateListeners]) listener('active')
      for (const listener of [...state.appStateListeners]) listener('active')
      await refreshStarted.promise
      await tick()
    })

    const observed = {
      authLoading: state.authView.isLoading,
      nativeReady: state.nativeReady,
      appSessionInitialized: state.appSessionView.isInitialized,
      bootstrapCount: state.bootstrapRequests.length,
      pickerMounted: state.activePickerMounts.has(initialMountId),
      secureReads: state.secureReads - readsBeforeResume,
    }
    assert.deepEqual(observed, {
      authLoading: false,
      nativeReady: true,
      appSessionInitialized: true,
      bootstrapCount: 1,
      pickerMounted: true,
      secureReads: 1,
    }, `same-owner renewal should preserve readiness, bootstrap, and picker identity; observed=${JSON.stringify(observed)}; transitions=${JSON.stringify(state.transitions)}`)

    await act(async () => {
      refreshResponse.resolve(authResponse(session('user-a', 'renewed')))
      await tick()
    })
    assert.equal(state.authView.session?.accessToken, 'access-user-a-renewed')
    assert.equal(state.authView.isLoading, false)
    assert.equal(state.nativeReady, true)
    assert.equal(state.appSessionView.isInitialized, true)
    assert.equal(state.bootstrapRequests.length, 1)
    assert.equal(state.pickerProbe.mountId, initialMountId)

    await act(async () => {
      selection.resolve({ name: 'qa-native-attachment.txt' })
      await tick()
    })
    assert.equal(state.pickerProbe.selectedName, 'qa-native-attachment.txt')
    assert.equal(state.pickerMounts, 1)
  } finally {
    refreshResponse.resolve(authResponse(session('user-a', 'renewed')))
    selection.resolve({ name: 'qa-native-attachment.txt' })
    await act(async () => renderer.unmount())
  }
})

test('cold restore keeps auth loading and Convex-equivalent readiness blocking until restore and bootstrap finish', async () => {
  const initial = session('cold-user', 'initial')
  reset(initial, () => {
    const response = deferred()
    state.coldRestoreResponse = response
    return response.promise
  })
  let renderer
  try {
    await act(async () => { renderer = create(providerStack()) })
    await act(async () => { await tick() })
    await act(async () => { await waitFor(() => state.refreshCalls.length === 1, 'initial stored-session refresh') })
    assert.equal(state.authView.isLoading, true)
    assert.equal(state.nativeReady, false)
    assert.equal(state.bootstrapRequests.length, 0)
    assert.equal(state.pickerMounts, 0)

    await act(async () => {
      state.coldRestoreResponse.resolve(authResponse(session('cold-user', 'restored')))
      await tick()
    })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 1, 'bootstrap after auth restore') })
    assert.equal(state.authView.isLoading, false)
    assert.equal(state.nativeReady, true)
    assert.equal(state.appSessionView.isInitialized, false)
    await act(async () => {
      state.bootstrapRequests[0].resolve({ user: initial.user })
      await tick()
    })
    assert.equal(state.appSessionView.isInitialized, true)
    assert.equal(state.pickerMounts, 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('explicit AppSession workspace refresh still gates and remounts screen content after bootstrap', async () => {
  const renderer = await mountReadyStack()
  const initialMountId = state.pickerProbe.mountId
  try {
    state.bootstrapRequests.length = 0
    await act(async () => { void state.appSessionView.refresh({ forceRefresh: true }) })
    await act(async () => { await tick() })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 1, 'explicit bootstrap request') })
    const request = state.bootstrapRequests[0]
    assert.equal(state.appSessionView.isInitialized, false)
    assert.equal(state.activePickerMounts.has(initialMountId), false)

    await act(async () => {
      request.resolve({ user: session('user-a', 'workspace-refresh').user })
      await tick()
    })
    assert.equal(state.appSessionView.isInitialized, true)
    assert.equal(state.pickerMounts, 2)
    assert.notEqual(state.pickerProbe.mountId, initialMountId)
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('expired foreground renewal invalidates only the matching stored session', async () => {
  const renderer = await mountReadyStack()
  try {
    state.refreshPlans.push(async () => authResponse(null, 401, 'Session expired'))
    await emitActive()
    await waitFor(() => state.authView.isAuthenticated === false, 'expired session invalidation')
    assert.equal(state.authView.session, null)
    assert.equal(state.authView.isLoading, false)
    assert.equal(state.nativeReady, false)
    assert.equal(state.secureValues.has(AUTH_STORAGE_KEY), false)
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('missing stored session before foreground renewal invalidates the in-memory owner', async () => {
  const renderer = await mountReadyStack()
  try {
    state.secureValues.delete(AUTH_STORAGE_KEY)
    await emitActive()
    await waitFor(() => !state.authView.isAuthenticated, 'missing stored session invalidation')

    assert.equal(state.authView.session, null)
    assert.equal(state.nativeReady, false)
    assert.equal(state.secureValues.has(AUTH_STORAGE_KEY), false)
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('owner switched during foreground renewal invalidates memory without deleting or adopting the new owner', async () => {
  const renderer = await mountReadyStack()
  const started = deferred()
  const response = deferred()
  const replacement = session('user-b', 'replacement')
  try {
    state.refreshPlans.push(async () => { started.resolve(); return response.promise })
    await act(async () => {
      for (const listener of [...state.appStateListeners]) listener('active')
      await started.promise
      await tick()
    })

    state.secureValues.set(AUTH_STORAGE_KEY, JSON.stringify(replacement))
    response.resolve(authResponse(session('user-a', 'late-renewal')))
    await act(async () => { await tick() })
    await waitFor(() => !state.authView.isAuthenticated, 'switched stored owner invalidation')

    assert.equal(state.authView.session, null)
    assert.equal(state.nativeReady, false)
    assert.deepEqual(JSON.parse(state.secureValues.get(AUTH_STORAGE_KEY)), replacement)
  } finally {
    response.resolve(authResponse(session('user-a', 'late-renewal')))
    await act(async () => renderer.unmount())
  }
})

test('foreground renewal for a new owner is not blocked by the old owner flight', async () => {
  const renderer = await mountReadyStack()
  const oldStarted = deferred()
  const oldResponse = deferred()
  try {
    state.refreshPlans.push(async () => { oldStarted.resolve(); return oldResponse.promise })
    await act(async () => {
      for (const listener of [...state.appStateListeners]) listener('active')
      await oldStarted.promise
      await tick()
    })

    const newSession = session('user-b', 'flight-signin')
    await act(async () => {
      await state.authView.completeNativeSignIn(newSession)
      await tick()
    })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 2, 'new owner bootstrap') })
    await act(async () => {
      state.bootstrapRequests[1].resolve({ user: newSession.user })
      await tick()
    })

    state.refreshPlans.push(async () => authResponse(session('user-b', 'renewed')))
    await emitActive()
    await waitFor(() => state.refreshCalls.length === 3, 'new owner foreground renewal')
    await waitFor(() => state.authView.session?.accessToken === 'access-user-b-renewed', 'new owner renewal hydration')

    assert.equal(state.refreshCalls[2].refreshToken, 'refresh-user-b-flight-signin')
    assert.equal(state.authView.isLoading, false)
    assert.equal(state.nativeReady, true)
    assert.equal(state.bootstrapRequests.length, 2)

    oldResponse.resolve(authResponse(session('user-a', 'late')))
    await act(async () => { await tick() })
    assert.equal(state.authView.session?.accessToken, 'access-user-b-renewed')
    assert.equal(JSON.parse(state.secureValues.get(AUTH_STORAGE_KEY)).accessToken, 'access-user-b-renewed')
  } finally {
    oldResponse.resolve(authResponse(session('user-a', 'late')))
    await act(async () => renderer.unmount())
  }
})

test('current initial transfer callback failure is surfaced', async () => {
  reset(null, async () => authResponse(session('unused', 'unused')))
  state.initialUrl = 'overlay://auth/transfer?token=invalid'
  state.secureValues.set('overlay-native-pkce-verifier', 'test-verifier')
  state.transferPlans.push(async () => new Response('invalid transfer', { status: 401 }))
  let renderer
  try {
    await act(async () => { renderer = create(providerStack()); await tick() })
    await waitFor(() => Boolean(state.authView?.authError), 'initial URL auth error')

    assert.match(state.authView.authError, /Session transfer failed: 401 invalid transfer/)
    assert.equal(state.authView.isLoading, false)
    assert.equal(state.authView.session, null)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('initial URL returned after a newer sign-in is ignored', async () => {
  reset(null, async () => authResponse(session('unused', 'unused')))
  const initialUrl = deferred()
  const initialUrlRequested = deferred()
  state.initialUrlPromise = initialUrl.promise
  state.initialUrlRequested = initialUrlRequested
  state.secureValues.set('overlay-native-pkce-verifier', 'test-verifier')
  state.transferPlans.push(async () => new Response(JSON.stringify({
    accessToken: 'access-old-launch',
    refreshToken: 'refresh-old-launch',
    userId: 'old-launch-user',
  }), { status: 200 }))
  let renderer
  try {
    await act(async () => { renderer = create(providerStack()) })
    await act(async () => { await initialUrlRequested.promise; await tick() })

    const newSession = session('user-b', 'deferred-initial-url')
    await act(async () => { await state.authView.completeNativeSignIn(newSession); await tick() })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 1, 'new sign-in bootstrap') })
    await act(async () => {
      state.bootstrapRequests[0].resolve({ user: newSession.user })
      await tick()
    })

    initialUrl.resolve('overlay://auth/transfer?token=old-launch')
    await act(async () => { await tick() })

    assert.equal(state.transferCalls.length, 0)
    assert.equal(state.authView.session?.user.id, 'user-b')
    assert.equal(state.authView.authError, null)
    assert.equal(JSON.parse(state.secureValues.get(AUTH_STORAGE_KEY)).user.id, 'user-b')
  } finally {
    initialUrl.resolve('overlay://auth/transfer?token=old-launch')
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('obsolete initial callback failure cannot affect a newer owner or clear its loading state', async () => {
  reset(null, async () => authResponse(session('unused', 'unused')))
  state.initialUrl = 'overlay://auth/transfer?token=stale'
  state.secureValues.set('overlay-native-pkce-verifier', 'test-verifier')
  const transferStarted = deferred()
  const transferResponse = deferred()
  state.transferPlans.push(async () => { transferStarted.resolve(); return transferResponse.promise })
  let renderer
  let signIn
  const writeStarted = deferred()
  const releaseWrite = deferred()
  try {
    await act(async () => { renderer = create(providerStack()); await tick() })
    await act(async () => { await waitFor(() => state.transferCalls.length === 1, 'initial transfer request') })
    state.secureWriteGate = { started: writeStarted, release: releaseWrite }
    await act(async () => {
      signIn = state.authView.completeNativeSignIn(session('user-b', 'callback-signin'))
      await waitFor(() => state.secureWriteGate === null, 'new owner storage write')
      await tick()
    })

    transferResponse.resolve(new Response('obsolete transfer failure', { status: 401 }))
    await act(async () => { await tick() })
    assert.equal(state.authView.authError, null)
    assert.equal(state.authView.isLoading, true)

    releaseWrite.resolve()
    await act(async () => { await signIn; await tick() })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 1, 'new owner bootstrap after callback') })
    await act(async () => {
      state.bootstrapRequests[0].resolve({ user: { id: 'user-b' } })
      await tick()
    })
    assert.equal(state.authView.session?.user.id, 'user-b')
    assert.equal(state.authView.authError, null)
  } finally {
    releaseWrite.resolve()
    transferResponse.resolve(new Response('obsolete transfer failure', { status: 401 }))
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('stale explicit refresh finalizer does not clear newer sign-in loading', async () => {
  const renderer = await mountReadyStack()
  const refreshStarted = deferred()
  const refreshResponse = deferred()
  const writeStarted = deferred()
  const releaseWrite = deferred()
  let signIn
  try {
    state.refreshPlans.push(async () => { refreshStarted.resolve(); return refreshResponse.promise })
    let refresh
    await act(async () => {
      refresh = state.authView.refreshSession()
      await refreshStarted.promise
      await tick()
    })
    state.secureWriteGate = { started: writeStarted, release: releaseWrite }
    await act(async () => {
      signIn = state.authView.completeNativeSignIn(session('user-b', 'explicit-signin'))
      await waitFor(() => state.secureWriteGate === null, 'new owner storage write')
      await tick()
    })

    refreshResponse.resolve(authResponse(session('user-a', 'late')))
    await act(async () => { await refresh; await tick() })
    assert.equal(state.authView.isLoading, true)

    releaseWrite.resolve()
    await act(async () => { await signIn; await tick() })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 2, 'new owner bootstrap after refresh') })
    await act(async () => {
      state.bootstrapRequests[1].resolve({ user: { id: 'user-b' } })
      await tick()
    })
    assert.equal(state.authView.session?.user.id, 'user-b')
    assert.equal(state.authView.isLoading, false)
  } finally {
    releaseWrite.resolve()
    refreshResponse.resolve(authResponse(session('user-a', 'late')))
    await act(async () => renderer.unmount())
  }
})

test('unmounted provider ignores a pending foreground renewal completion', async () => {
  const renderer = await mountReadyStack()
  const started = deferred()
  const response = deferred()
  const storedBefore = state.secureValues.get(AUTH_STORAGE_KEY)
  let unmounted = false
  try {
    state.refreshPlans.push(async () => { started.resolve(); return response.promise })
    await act(async () => {
      for (const listener of [...state.appStateListeners]) listener('active')
      await started.promise
      await tick()
    })
    await act(async () => renderer.unmount())
    unmounted = true
    response.resolve(authResponse(session('user-a', 'after-unmount')))
    await act(async () => { await tick() })

    assert.equal(state.secureValues.get(AUTH_STORAGE_KEY), storedBefore)
  } finally {
    response.resolve(authResponse(session('user-a', 'after-unmount')))
    if (renderer && !unmounted) await act(async () => renderer.unmount())
  }
})

test('late successful renewal cannot overwrite a newly signed-in owner', async () => {
  const renderer = await mountReadyStack()
  const started = deferred()
  const response = deferred()
  try {
    state.refreshPlans.push(async () => { started.resolve(); return response.promise })
    await act(async () => {
      for (const listener of [...state.appStateListeners]) listener('active')
      await started.promise
      await tick()
    })
    await act(async () => {
      await state.authView.completeNativeSignIn(session('user-b', 'signed-in'))
    })
    await act(async () => { await tick() })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 2, 'replacement owner bootstrap') })
    await act(async () => {
      state.bootstrapRequests[1].resolve({ user: session('user-b', 'signed-in').user })
      await tick()
    })
    response.resolve(authResponse(session('user-a', 'late-renewal')))
    await act(async () => {
      await waitFor(() => state.refreshCalls.length === 2, 'late refresh completion')
      await tick()
    })
    const stored = JSON.parse(state.secureValues.get(AUTH_STORAGE_KEY))
    assert.equal(state.authView.user.id, 'user-b')
    assert.equal(state.authView.session.accessToken, 'access-user-b-signed-in')
    assert.equal(stored.user.id, 'user-b')
    assert.equal(stored.accessToken, 'access-user-b-signed-in')
  } finally {
    response.resolve(authResponse(session('user-a', 'late-renewal')))
    await act(async () => renderer.unmount())
  }
})

test('late expired renewal cannot clear a newly signed-in owner', async () => {
  const renderer = await mountReadyStack()
  const started = deferred()
  const response = deferred()
  try {
    state.refreshPlans.push(async () => { started.resolve(); return response.promise })
    await act(async () => {
      for (const listener of [...state.appStateListeners]) listener('active')
      await started.promise
      await tick()
    })
    await act(async () => {
      await state.authView.completeNativeSignIn(session('user-b', 'late-expiry-sign-in'))
    })
    await act(async () => { await tick() })
    await act(async () => { await waitFor(() => state.bootstrapRequests.length === 2, 'replacement owner bootstrap') })
    await act(async () => {
      state.bootstrapRequests[1].resolve({ user: session('user-b', 'late-expiry-sign-in').user })
      await tick()
    })
    response.resolve(authResponse(null, 401, 'Session expired'))
    await act(async () => {
      await waitFor(() => state.refreshCalls.length === 2, 'late expired response')
      await tick()
    })
    const stored = JSON.parse(state.secureValues.get(AUTH_STORAGE_KEY))
    assert.equal(state.authView.user.id, 'user-b')
    assert.equal(state.authView.isAuthenticated, true)
    assert.equal(stored.user.id, 'user-b')
    assert.equal(stored.accessToken, 'access-user-b-late-expiry-sign-in')
  } finally {
    response.resolve(authResponse(null, 401, 'Session expired'))
    await act(async () => renderer.unmount())
  }
})

test('transient foreground renewal failure retains the established session and readiness', async () => {
  const renderer = await mountReadyStack()
  try {
    state.refreshPlans.push(async () => authResponse(null, 503, 'Service unavailable'))
    await emitActive()
    await waitFor(() => state.refreshCalls.length === 2, 'transient renewal failure')
    await act(async () => { await tick() })
    const stored = JSON.parse(state.secureValues.get(AUTH_STORAGE_KEY))
    assert.equal(state.authView.user.id, 'user-a')
    assert.equal(state.authView.session.accessToken, 'access-user-a-restored')
    assert.equal(state.authView.isLoading, false)
    assert.equal(state.nativeReady, true)
    assert.equal(state.appSessionView.isInitialized, true)
    assert.equal(state.bootstrapRequests.length, 1)
    assert.equal(stored.accessToken, 'access-user-a-restored')
  } finally {
    await act(async () => renderer.unmount())
  }
})

test.after(() => {
  Module._load = originalLoad
})
