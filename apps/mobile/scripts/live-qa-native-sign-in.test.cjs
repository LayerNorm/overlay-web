/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const BASE = 'https://pr-469.preview.getoverlay.io'
function load(file, mocks, globals = {}) {
  const loaded = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { console: { log() {}, warn() {}, error() {} }, Error, URL, Date, Uint8Array, AbortController, setTimeout, clearTimeout, ...globals })(id => {
    assert.ok(Object.hasOwn(mocks, id), 'Unexpected import ' + id)
    return mocks[id]
  }, loaded, loaded.exports)
  return loaded.exports
}
function fixture(options = {}) {
  const store = new Map(), requests = [], browser = [], listeners = new Set()
  let removed = 0, dismissed = 0, authorizationBody, next = 0
  const session = { accessToken: 'access', refreshToken: 'refresh', user: { id: 'user' }, expiresAt: Date.now() + 3600000 }
  const auth = load('services/authService.ts', {
    './appConfig': { AUTH_BASE_URL: BASE },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'SHA256' }, CryptoEncoding: { BASE64: 'BASE64' }, getRandomBytesAsync: async n => new Uint8Array(n).fill(9), digestStringAsync: async () => `digest-${++next}-` + 'a'.repeat(48) },
    'expo-secure-store': { getItemAsync: async key => store.get(key) ?? null, setItemAsync: async (key, value) => store.set(key, value), deleteItemAsync: async key => store.delete(key) },
  }, {
    fetch: async (url, init) => {
      requests.push([url, init])
      if (url.endsWith('/api/auth/native/authorize')) {
        authorizationBody = JSON.parse(init.body)
        if (options.protected) return new Response(JSON.stringify({ error: { message: 'Protected deployment' } }), { status: 401 })
        return new Response(JSON.stringify({ authorizationUrl: options.authorizationUrl ?? `https://api.workos.com/user_management/authorize?state=${authorizationBody.state}` }))
      }
      if (url.endsWith('/api/auth/native/exchange')) {
        if (options.exchangeError) throw new Error('Network unavailable')
        if (options.interrupt) store.set('overlay-native-auth-pending', JSON.stringify({ state: 'another-sign-in' }))
        return new Response(JSON.stringify({ session }))
      }
      if (options.legacyHtml && url.includes('/api/auth/desktop-link')) return new Response('<html>Vercel login</html>')
      assert.fail('Legacy authentication endpoint requested: ' + url)
    },
  })
  const callback = (overrides = {}) => {
    const params = new URLSearchParams({ state: authorizationBody.state, code: 'native-code', ...overrides })
    return `${options.https ? BASE + '/auth/native/callback' : 'overlay://auth/callback'}?${params}`
  }
  const service = load('services/nativeSignInService.ts', {
    './appConfig': { AUTH_BASE_URL: BASE }, './authService': auth,
    'react-native': { Linking: { addEventListener: (_event, listener) => { listeners.add(listener); return { remove: () => { listeners.delete(listener); removed++ } } } } },
    'expo-web-browser': {
      maybeCompleteAuthSession() {}, dismissAuthSession() { dismissed++ },
      async openAuthSessionAsync(...args) {
        browser.push(args)
        if (options.cancel) return { type: 'cancel' }
        if (options.browserError) throw new Error('Browser unavailable')
        if (options.empty) return { type: 'success' }
        const url = callback(options.wrongState ? { state: 'wrong' } : options.oauthError ? { error: 'access_denied' } : {})
        if (options.linking) {
          for (const listener of listeners) listener({ url })
          if (options.duplicate) await auth.completeNativeAuthCallback(url)
          return { type: 'cancel' }
        }
        return { type: 'success', url }
      },
    },
  })
  return { auth, service, store, requests, browser, session, callback, listenerCount: () => listeners.size, removed: () => removed, dismissed: () => dismissed }
}

test('fresh sign-in authorizes and exchanges native PKCE against the selected Preview without desktop-link', async () => {
  const state = fixture()
  assert.deepEqual(await state.service.signInWithNativeAuth({ forceSignIn: true }), state.session)
  assert.deepEqual(state.requests.map(([url]) => url), [`${BASE}/api/auth/native/authorize`, `${BASE}/api/auth/native/exchange`])
  const authorize = JSON.parse(state.requests[0][1].body), exchange = JSON.parse(state.requests[1][1].body)
  assert.equal(authorize.provider, 'authkit')
  assert.equal(authorize.redirectUri, `${BASE}/auth/native/callback`)
  assert.equal(authorize.forceSignIn, true)
  assert.ok(authorize.codeChallenge.length >= 43)
  assert.ok(authorize.state.length >= 32)
  assert.equal(exchange.code, 'native-code')
  assert.equal(exchange.codeVerifier.length, 64)
  assert.equal(state.browser[0][1], 'overlay://auth/callback')
  assert.equal(new URL(state.browser[0][0]).hostname, 'api.workos.com')
  assert.equal(state.store.has('overlay-native-auth-pending'), false)
  assert.equal(state.listenerCount(), 0)
  assert.equal(state.removed(), 1)
  assert.equal(state.dismissed(), 1)
})

test('universal-link and browser/Linking duplicate delivery share one native exchange, including late delivery', async () => {
  for (const https of [false, true]) {
    const state = fixture({ https, linking: true, duplicate: true })
    assert.deepEqual(await state.service.signInWithNativeAuth(), state.session)
    assert.deepEqual(await state.auth.completeNativeAuthCallback(state.callback()), state.session)
    assert.equal(state.requests.filter(([url]) => url.endsWith('/exchange')).length, 1)
    await state.auth.clearPkceVerifier()
    await assert.rejects(state.auth.completeNativeAuthCallback(state.callback()), /No pending sign-in/)
  }
})

test('cold-start callback uses persisted PKCE; callbacks from another server or legacy paths cannot exchange it', async () => {
  const state = fixture()
  await state.auth.buildNativeAuthRequest({ provider: 'authkit', redirectUri: `${BASE}/auth/native/callback` })
  assert.deepEqual(await state.auth.completeNativeAuthCallback(state.callback()), state.session)
  for (const url of ['https://untrusted.invalid/auth/native/callback?code=x&state=y', 'https://www.getoverlay.io/auth/native/callback', 'overlay://auth/transfer?token=token', 'overlay://other/callback?code=x&state=y']) {
    assert.equal(await state.auth.completeNativeAuthCallback(url), null)
  }
  assert.equal(state.requests.filter(([url]) => url.endsWith('/exchange')).length, 1)
})

test('duplicate native completion cannot overwrite credentials rotated after the first sign-in', async () => {
  const state = fixture()
  const session = await state.service.signInWithNativeAuth()
  await state.auth.saveNativeAuthSession(session)
  const rotated = { ...session, accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }
  state.store.set('overlay-auth-session', JSON.stringify(rotated))
  const duplicate = await state.auth.completeNativeAuthCallback(state.callback())
  assert.deepEqual(JSON.parse(JSON.stringify(await state.auth.saveNativeAuthSession(duplicate))), rotated)
  assert.equal(JSON.parse(state.store.get('overlay-auth-session')).accessToken, 'rotated-access')
})

test('cancel, empty result, state mismatch, OAuth failure and network failure finish without leaking browser listeners', async () => {
  const cancelled = fixture({ cancel: true })
  assert.equal(await cancelled.service.signInWithNativeAuth(), null)
  assert.equal(cancelled.listenerCount(), 0)
  for (const options of [{ empty: true }, { wrongState: true }, { oauthError: true }, { exchangeError: true }, { browserError: true }]) {
    const state = fixture(options)
    await assert.rejects(state.service.signInWithNativeAuth())
    assert.equal(state.listenerCount(), 0)
  }
})

test('untrusted destinations and protected authorization APIs fail before opening a browser', async () => {
  for (const options of [{ authorizationUrl: 'https://untrusted.invalid/sign-in' }, { protected: true }]) {
    const state = fixture(options)
    await assert.rejects(state.service.signInWithNativeAuth(), /Unexpected sign-in destination|Check access to this server/)
    assert.equal(state.browser.length, 0)
  }
})

test('a stale exchange cannot remove a newer pending sign-in; legacy HTML cannot consume its verifier', async () => {
  const interrupted = fixture({ interrupt: true })
  await assert.rejects(interrupted.service.signInWithNativeAuth(), /Sign-in changed/)
  assert.equal(JSON.parse(interrupted.store.get('overlay-native-auth-pending')).state, 'another-sign-in')
  const legacy = fixture({ legacyHtml: true })
  legacy.store.set('overlay-native-pkce-verifier', 'verifier')
  await assert.rejects(legacy.auth.consumeTransferToken('bogus'), /did not return a session/)
  assert.equal(legacy.store.get('overlay-native-pkce-verifier'), 'verifier')
})

test('auth base honors explicit Preview, config fallback and canonical default and is visible to Expo env inlining', () => {
  for (const [env, extra, expected] of [[BASE, {}, BASE], ['', { authBaseUrl: BASE }, BASE], [undefined, {}, 'https://overlay.works'], ['https://getoverlay.io', {}, 'https://overlay.works'], ['https://www.getoverlay.io', {}, 'https://overlay.works']]) {
    const config = load('services/appConfig.ts', { 'expo-constants': { expoConfig: { extra } } }, { process: { env: { EXPO_PUBLIC_AUTH_BASE_URL: env } } })
    assert.equal(config.AUTH_BASE_URL, expected)
  }
  const babel = require('@babel/core')
  const { expoInlineEnvVars } = require('babel-preset-expo/build/inline-env-vars')
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'services/appConfig.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  const result = babel.transformSync(source, { babelrc: false, configFile: false, plugins: [expoInlineEnvVars], caller: { name: 'metro', isDev: true } })
  assert.ok(result.metadata.publicEnvVars.includes('EXPO_PUBLIC_AUTH_BASE_URL'))
  assert.match(result.code, /expo\/virtual\/env/)
})

test('sign-in entry uses native service and callback error states offer retry without an error spinner', async () => {
  const calls = [], states = []
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useEffect() {}, useState: value => [value, next => states.push(next)], useMemo: fn => fn() }
  react.default = react
  const router = { replace: value => calls.push(value) }
  const screen = load('app/auth-flow.tsx', {
    react, 'react-native-safe-area-context': { SafeAreaView: 'SafeArea' }, 'expo-router': { useRouter: () => router, useLocalSearchParams: () => ({ force: 'true' }) },
    '../hooks/useTheme': { useTheme: () => ({ theme: {} }) }, '../contexts/AuthContext': { useAuth: () => ({ isAuthenticated: false, completeNativeSignIn: async value => calls.push(value) }) },
    '../components/shell/EntryScreens': { SignInScreen: 'SignIn' }, '../services/nativeSignInService': { signInWithNativeAuth: async options => { calls.push(options.forceSignIn); return { user: { id: 'user' } } } },
  })
  screen.default().props.children[0].props.onSignIn()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [true, { user: { id: 'user' } }, '/'])
  assert.equal(states.at(-1), false)
  for (const file of ['app/auth/native/callback.tsx', 'app/auth/transfer.tsx']) {
    const prefix = file.includes('/native/') ? '../../../' : '../../'
    const callback = load(file, {
      react, 'react-native': { ActivityIndicator: 'Spinner', StyleSheet: { create: value => value }, Text: 'Text', View: 'View' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
      'expo-router': { useRouter: () => router, useLocalSearchParams: () => ({}) },
      [prefix + 'hooks/useTheme']: { useTheme: () => ({ theme: {} }) }, [prefix + 'contexts/AuthContext']: { useAuth: () => ({ isAuthenticated: false, isLoading: false, authError: 'Sign-in failed' }) },
      [prefix + 'services/accountDeletionService']: {}, [prefix + 'components/shell/primitives']: { Button: 'Button' },
    })
    const tree = callback.default()
    const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props.children ?? []).flatMap(flatten)]
    const nodes = flatten(tree)
    assert.equal(nodes.some(node => node.type === 'Spinner'), false)
    const retry = nodes.find(node => node.type === 'Button')
    assert.ok(retry)
    retry.props.onPress()
    assert.equal(calls.at(-1), '/auth-flow')
  }
})
