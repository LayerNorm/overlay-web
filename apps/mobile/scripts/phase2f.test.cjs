/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const clean = (value) => JSON.parse(JSON.stringify(value))
function load(file, mocks = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext('(function(require,module,exports){' + output + '\n})', {
    URL,
    AbortController,
    Error,
    console,
    setTimeout,
    clearTimeout,
    ...globals,
  })(
    (id) => {
      assert.ok(Object.hasOwn(mocks, id), 'Unexpected import ' + id)
      return mocks[id]
    },
    loaded,
    loaded.exports,
  )
  return loaded.exports
}
function deletion(options = {}) {
  const calls = [],
    listeners = new Set()
  let stored = 'viewer'
  const service = load(
    'services/accountDeletionService.ts',
    {
      './appConfig': { AUTH_BASE_URL: 'https://isolated.invalid' },
      'react-native': {
        Linking: {
          addEventListener: (_type, callback) => {
            listeners.add(callback)
            return { remove: () => listeners.delete(callback) }
          },
        },
      },
      'expo-web-browser': {
        openAuthSessionAsync: async (...args) => {
          calls.push(['browser', ...args])
          if (options.callbackEvent) {
            for (const callback of listeners)
              callback({
                url: 'https://isolated.invalid/auth/native/callback?state=state&code=code',
              })
            return new Promise(() => {})
          }
          return (
            options.browser ?? {
              type: 'success',
              url: options.url ?? 'overlay://auth/callback?state=state&code=code',
            }
          )
        },
        dismissAuthSession: () => calls.push(['dismiss']),
      },
      './authService': {
        loadAuthSession: async () => (stored ? { user: { id: stored } } : null),
        buildNativeAuthRequest: async (args) => {
          calls.push(['authorize', args])
          return {
            authorizationUrl: 'https://api.workos.com/user_management/authorize',
            state: 'state',
            codeVerifier: 'verifier',
          }
        },
        exchangeNativeAuthCode: async (args) => {
          calls.push(['exchange', args])
          if (options.changed) stored = 'other'
          return { user: { id: options.freshUser ?? 'viewer' }, accessToken: 'fresh-token' }
        },
        clearPkceVerifier: async () => calls.push(['clear']),
      },
    },
    {
      fetch: async (url, init) => {
        calls.push(['delete', url, init])
        if (options.networkError) throw new Error('Network unavailable')
        return { ok: options.ok !== false, json: async () => options.response ?? { success: true } }
      },
    },
  )
  return {
    service,
    calls,
    listeners,
    run: () =>
      service.deleteAccountWithReauthentication('viewer', async () => {
        calls.push(['signout'])
        stored = null
      }),
  }
}
test('deletion forces hosted WorkOS PKCE, sends only fresh credentials without cookies, then signs out', async () => {
  const fixture = deletion()
  await fixture.run()
  const { calls, service } = fixture
  assert.equal(calls[0][1].forceSignIn, true)
  assert.equal(calls[0][1].purpose, 'account-deletion')
  const browser = calls.find((row) => row[0] === 'browser')
  assert.equal(new URL(browser[1]).searchParams.get('prompt'), 'login')
  assert.equal(new URL(browser[1]).searchParams.get('max_age'), '0')
  assert.equal(browser[2], 'overlay://auth/callback')
  assert.equal(browser[3].preferEphemeralSession, true)
  const request = calls.find((row) => row[0] === 'delete')
  assert.equal(request[1], 'https://isolated.invalid/api/account/delete')
  assert.equal(request[2].credentials, 'omit')
  assert.equal(request[2].headers.Authorization, 'Bearer fresh-token')
  assert.equal(request[2].headers.Cookie, undefined)
  assert.deepEqual(JSON.parse(request[2].body), {
    confirmation: 'DELETE',
    userId: 'viewer',
    accessToken: 'fresh-token',
  })
  assert.ok(
    calls.findIndex((row) => row[0] === 'delete') < calls.findIndex((row) => row[0] === 'signout'),
  )
  assert.equal(service.getAccountDeletionState().busy, false)
  assert.equal(service.getAccountDeletionState().error, null)
  assert.equal(service.isAccountDeletionCallback('overlay://auth/callback?state=state'), true)
  assert.equal(fixture.listeners.size, 0)
})
test('Android HTTPS app-link interception completes the same native deletion flow', async () => {
  const fixture = deletion({ callbackEvent: true })
  await fixture.run()
  assert.equal(fixture.calls.filter((row) => row[0] === 'signout').length, 1)
  assert.equal(fixture.listeners.size, 0)
})
test('cancel, invalid origin/state, empty code and a different account never delete or sign out', async () => {
  for (const options of [
    { browser: { type: 'cancel' } },
    { url: 'overlay://auth/callback?state=wrong&code=code' },
    { url: 'https://untrusted.invalid/auth/native/callback?state=state&code=code' },
    { url: 'overlay://other/callback?state=state&code=code' },
    { url: 'overlay://auth/callback?state=state' },
    { freshUser: 'different' },
    { changed: true },
  ]) {
    const fixture = deletion(options)
    await assert.rejects(fixture.run())
    assert.equal(
      fixture.calls.some((row) => ['delete', 'signout'].includes(row[0])),
      false,
    )
    assert.equal(fixture.service.getAccountDeletionState().busy, false)
    assert.ok(fixture.service.getAccountDeletionState().error)
    assert.equal(fixture.calls.at(-1)[0], 'clear')
  }
})
test('a second deletion cannot race the pending hosted sign-in', async () => {
  let release
  const browser = new Promise((resolve) => {
    release = resolve
  })
  const fixture = deletion({ browser })
  const first = fixture.run()
  await assert.rejects(fixture.run(), /already/)
  release({ type: 'success', url: 'overlay://auth/callback?state=state&code=code' })
  await first
  assert.equal(fixture.calls.filter((row) => row[0] === 'delete').length, 1)
})
test('stale/rejected tokens, malformed responses and network errors do not clear the local account', async () => {
  for (const options of [
    { ok: false, response: { error: 'Sign in again to delete your account.' } },
    { response: {} },
    { networkError: true },
  ]) {
    const fixture = deletion(options)
    await assert.rejects(fixture.run())
    assert.equal(
      fixture.calls.some((row) => row[0] === 'signout'),
      false,
    )
    assert.equal(fixture.service.getAccountDeletionState().busy, false)
  }
})
test('deletion callback routing and process-restart protection do not establish a replacement account', async () => {
  let deleted = 0
  const native = load('services/authService.ts', {
    'expo-crypto': {},
    './appConfig': { AUTH_BASE_URL: 'https://isolated.invalid' },
    'expo-secure-store': {
      getItemAsync: async () =>
        JSON.stringify({ state: 'state', codeVerifier: 'verifier', purpose: 'account-deletion' }),
      deleteItemAsync: async () => {
        deleted++
      },
    },
  })
  assert.equal(
    await native.completeNativeAuthCallback(
      'https://isolated.invalid/auth/native/callback?state=state&code=code',
    ),
    null,
  )
  assert.equal(deleted, 1)
  const auth = fs.readFileSync(path.join(root, 'contexts/AuthContext.tsx'), 'utf8')
  assert.match(
    auth,
    /if \(getAccountDeletionState\(\)\.busy \|\| isAccountDeletionCallback\(event.url\)\) return/,
  )
  assert.match(
    fs.readFileSync(path.join(root, '../src/app/auth/native/callback/route.ts'), 'utf8'),
    /overlay:\/\/auth\/callback/,
  )
})
function storage() {
  const values = new Map()
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value)
    },
    values,
  }
}
test('banner preferences are device-local, user-scoped, validated and applied to actual activity types', async () => {
  const store = storage()
  const api = load('services/bannerPreferencesService.ts', {
    '@react-native-async-storage/async-storage': { default: store },
  })
  const prefs = await api.loadBannerPreferences('one')
  await api.saveBannerPreferences('one', { ...prefs, dm: false, mention: false, thread: false })
  assert.equal((await api.loadBannerPreferences('one')).mention, false)
  assert.equal((await api.loadBannerPreferences('two')).mention, true)
  const saved = await api.loadBannerPreferences('one')
  assert.equal(api.allowsBanner(saved, 'message', 'dm'), false)
  assert.equal(api.allowsBanner(saved, 'message', 'channel'), true)
  assert.equal(api.allowsBanner(saved, 'mention'), false)
  assert.equal(api.allowsBanner(saved, 'thread'), false)
  assert.equal(api.allowsBanner(saved, 'reaction'), true)
  store.values.set('overlay-banner-preferences:one', '{bad')
  assert.equal((await api.loadBannerPreferences('one')).mention, true)
  store.values.set('overlay-banner-preferences:one', '{"mention":"false"}')
  assert.equal((await api.loadBannerPreferences('one')).mention, true)
})
test('push permission is not requested at launch; explicit permission captures only a local token', async () => {
  const store = storage(),
    calls = []
  const notifications = {
    AndroidImportance: { DEFAULT: 3 },
    setNotificationChannelAsync: async () => calls.push('channel'),
    getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
    requestPermissionsAsync: async () => {
      calls.push('permission')
      return { granted: true }
    },
    getExpoPushTokenAsync: async () => ({ data: 'local-expo-token' }),
  }
  const service = load('services/notificationsService.ts', {
    '@react-native-async-storage/async-storage': { default: store },
    'expo-device': { isDevice: true },
    'expo-notifications': notifications,
    'react-native': { Platform: { OS: 'android' } },
  })
  const result = await service.preparePushRegistration('viewer')
  assert.equal(result.type, 'expo')
  assert.equal(calls[0], 'channel')
  assert.equal(calls.filter((value) => value === 'permission').length, 1)
  assert.equal(JSON.parse(store.values.get('overlay-push-token:viewer')).token, 'local-expo-token')
  store.values.delete('overlay-push-token:viewer')
  assert.equal(await service.preparePushRegistration('viewer', false, () => false), null)
  assert.equal(store.values.has('overlay-push-token:viewer'), false)
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8'),
    /preparePushRegistration/,
  )
  notifications.getPermissionsAsync = async () => ({ granted: false, canAskAgain: false })
  assert.equal(await service.requestNotificationPermission(), false)
  assert.equal(calls.filter((value) => value === 'permission').length, 1)
})
test('native Settings adapters use generated native reads, propagate empty/errors and scope HTTP OAuth', async () => {
  const refs = new Proxy(
    {},
    {
      get: (_target, key) =>
        new Proxy(
          {},
          {
            get: (_target2, nested) =>
              new Proxy(
                {},
                { get: (_target3, fn) => `${String(key)}.${String(nested)}.${String(fn)}` },
              ),
          },
        ),
    },
  )
  let workspace = 'workspace',
    result = [],
    error = null
  const calls = []
  const native = load('services/settingsNativeService.ts', {
    '@overlay/app-core': {
      DEFAULT_APP_SETTINGS: { lightThemePreset: 'default', darkThemePreset: 'default' },
      isThemePresetId: (value) => value === 'default',
    },
    'expo-crypto': { randomUUID: () => 'request-key' },
    './convexClient': {
      api: refs,
      convexWorkspaceId: () => workspace,
      queryConvex: async (...args) => {
        calls.push(args)
        if (error) throw error
        return result
      },
      subscribeConvex() {},
    },
    './appApi': {
      getRequestWorkspaceId: () => workspace,
      appJson: async (...args) => {
        calls.push(args)
        return { data: { status: 'pending' } }
      },
    },
  })
  assert.deepEqual(clean(await native.readMemories()), [])
  await native.readMembers(workspace)
  await native.readBilling(workspace)
  await native.readProviders()
  await native.readNativeSettings()
  assert.deepEqual(
    calls.slice(0, 5).map((call) => call[0]),
    [
      'knowledge.memoryBrowse.list',
      'collaboration.management.view',
      'billing.browse.workspaceSummary',
      'providers.browse.connections',
      'platform.uiSettings.mine',
    ],
  )
  error = new Error('Native access disabled')
  await assert.rejects(native.readMemories(), (value) => value === error)
  error = null
  result = null
  assert.equal(await native.readBilling(workspace), null)
  await native.subscriptionRequest(workspace, { providerId: 'claude', scope: 'personal' }, 'POST')
  const request = calls.at(-1)
  assert.equal(request[0], '/api/v1/providers/subscriptions')
  assert.equal(request[1].workspaceId, workspace)
  assert.equal(request[1].headers['Idempotency-Key'], 'request-key')
  assert.equal(request[1].json.scope, 'personal')
  await native.subscriptionRequest(
    workspace,
    { providerId: 'claude', scope: 'personal' },
    'POST',
    undefined,
    'stable-retry-key',
  )
  assert.equal(calls.at(-1)[1].headers['Idempotency-Key'], 'stable-retry-key')
  workspace = 'different'
  await assert.rejects(
    native.subscriptionRequest('workspace', { action: 'poll' }),
    /Workspace changed/,
  )
  await assert.rejects(native.saveAccountName('  '), /Enter a name/)
})
test('API-key compatibility list excludes subscription credentials and preserves empty/error behavior', async () => {
  let rows = [
    { _id: 'oauth', authKind: 'subscription', status: 'pending' },
    { _id: 'key', authKind: 'api_key', status: 'pending' },
  ]
  let error = null
  const service = load('services/providersService.ts', {
    './appApi': {},
    './settingsNativeService': {
      readProviders: async () => {
        if (error) throw error
        return rows
      },
    },
  })
  assert.deepEqual(clean(await service.listProviderConnections()), [
    { _id: 'key', authKind: 'api_key', status: 'untested' },
  ])
  rows = []
  assert.deepEqual(clean(await service.listProviderConnections()), [])
  rows = null
  await assert.rejects(service.listProviderConnections(), /unavailable/)
  error = new Error('Denied')
  await assert.rejects(service.listProviderConnections(), (value) => value === error)
})
test('account photos never forward credentials to external or non-photo destinations', () => {
  const { accountPhotoSource } = load('lib/settingsPhoto.ts')
  const base = 'https://isolated.invalid'
  assert.equal(accountPhotoSource('http://untrusted.invalid/pic', base, 'token'), null)
  assert.equal(accountPhotoSource('https://cdn.invalid/pic', base, 'token').headers, undefined)
  assert.equal(accountPhotoSource('/api/other', base, 'token').headers, undefined)
  assert.equal(
    accountPhotoSource('/api/v1/account/profile/photo?v=1', base, 'token').headers.Authorization,
    'Bearer token',
  )
  assert.equal(accountPhotoSource(null, base, 'token'), null)
})
function hooks() {
  const state = []
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [
        state[index],
        (value) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value
        },
      ]
    },
  }
  react.default = react
  return {
    react,
    render(component, props) {
      cursor = 0
      return component(props)
    },
  }
}
function nodes(tree) {
  return !tree || typeof tree !== 'object'
    ? []
    : [tree, ...(tree.props?.children ?? []).flat(Infinity).flatMap(nodes)]
}
function views(h) {
  const names = new Proxy({}, { get: (_, key) => key })
  return load('components/settings/SettingsViews.tsx', {
    react: h.react,
    'react-native': names,
    'expo-router': { Stack: { Screen: 'Screen' } },
    '@expo/ui/swift-ui': names,
    '@expo/ui/swift-ui/modifiers': new Proxy({}, { get: (_, key) => (...args) => ({ modifier: key, args }) }),
    '../knowledge/ResourceViews': { ResourceState: 'State' },
    '../shell/AgentAvatar': { AgentAvatar: 'AgentAvatar' },
    './SettingsPrompts': { PushPrePrompt: 'PushPrePrompt' },
    '../../lib/nativeControls': { useSwitchTint: () => [] },
  })
}
const text = (tree) => JSON.stringify(tree)
test('Settings views cover all ten pages, empty/error states and billing has no purchasing actions', () => {
  const h = hooks(),
    { SettingsView, SETTINGS_PAGES } = views(h)
  const actions = {},
    props = { theme: {}, data: {}, actions }
  for (const page of ['settings', ...SETTINGS_PAGES.map((row) => row[0]), 'push-permission']) {
    const tree = h.render(SettingsView, { ...props, page })
    // Every page names itself in the native navigation bar.
    assert.ok(nodes(tree).some((node) => node.type === 'Screen' && node.props.options?.title))
  }
  const empty = h.render(SettingsView, { ...props, page: 'memories' })
  assert.match(text(empty), /No memories yet/)
  const failure = h.render(SettingsView, {
    ...props,
    page: 'models',
    blocked: true,
    error: 'Unavailable',
  })
  assert.ok(nodes(failure).some((node) => node.props.error === 'Unavailable'))
  assert.equal(
    nodes(failure).some((node) => node.type === 'Button'),
    false,
  )
  const billing = h.render(SettingsView, {
    ...props,
    page: 'billing',
    data: {
      billing: {
        initialized: true,
        subscription: { planKind: 'paid' },
        credits: { remaining: 42, used: 2 },
      },
    },
  })
  assert.equal(
    nodes(billing).some((node) => node.type === 'Button' || node.props.onPress),
    false,
  )
  assert.doesNotMatch(JSON.stringify(billing), /checkout|portal|purchase|Manage on/)
})
const swiftUi = new Proxy({}, { get: (_, key) => key })
const swiftModifiers = new Proxy({}, { get: (_, key) => (...args) => ({ modifier: key, args }) })
test('conversation notifications read live native state, save the web mutation and block stale workspace writes', async () => {
  const h = hooks(),
    calls = []
  let workspace = 'ws'
  const resource = {
    data: {
      currentPrincipalId: 'you',
      participants: [{ principalId: 'you', notificationLevel: 'all' }],
    },
    loading: false,
    error: null,
  }
  const { RoomNotifications } = load('components/settings/RoomNotifications.tsx', {
    react: h.react,
    '@expo/ui/swift-ui': swiftUi,
    '@expo/ui/swift-ui/modifiers': swiftModifiers,
    '../../services/convexClient': {
      api: { collaboration: { rooms: { state: 'room-state', updateMyState: 'room-save' } } },
      mutateConvex: async (...args) => {
        calls.push(args)
      },
    },
    '../../services/appApi': { getRequestWorkspaceId: () => workspace },
    '../../hooks/useLiveResource': { useLiveResource: () => resource },
  })
  const render = () => h.render(RoomNotifications, { workspaceId: 'ws', conversationId: 'room' })
  const picker = () => nodes(render()).find((node) => node.type === 'Picker')
  assert.equal(picker().props.selection, 'all')
  picker().props.onSelectionChange('mentions')
  await new Promise(setImmediate)
  assert.deepEqual(clean(calls), [
    ['room-save', { workspaceId: 'ws', conversationId: 'room', notificationLevel: 'mentions' }],
  ])
  workspace = 'other'
  picker().props.onSelectionChange('muted')
  assert.equal(calls.length, 1)
  assert.match(JSON.stringify(render()), /Workspace changed/)
  resource.data = null
  resource.error = 'Native policy disabled'
  const denied = render()
  assert.equal(nodes(denied).filter((node) => node.type === 'Picker').length, 0)
  assert.match(JSON.stringify(denied), /Native policy disabled/)
})
test('deletion confirmation requires the exact word, blocks busy/disabled submits and keeps the typed word', () => {
  const h = hooks()
  const { AccountDeletionConfirmation, PushPrePrompt } = load(
    'components/settings/SettingsPrompts.tsx',
    {
      react: h.react,
      'react-native': { View: 'View' },
      '@expo/ui/swift-ui': swiftUi,
      '@expo/ui/swift-ui/modifiers': swiftModifiers,
      'lucide-react-native': { Bell: 'Bell' },
      '../knowledge/ResourceViews': { ResourceState: 'State' },
      '../shell/primitives': { Button: 'Button', T: 'T' },
    },
  )
  let confirmed = 0,
    permitted = 0,
    dismissed = 0
  const props = { confirmation: '', onChange() {}, onConfirm: () => confirmed++ }
  const deleteButton = (tree) => nodes(tree).find((node) => node.props?.role === 'destructive')
  for (const state of [
    {},
    { confirmation: 'delete' },
    { confirmation: 'DELETE', busy: true },
    { confirmation: 'DELETE', disabled: true },
  ]) {
    const button = deleteButton(h.render(AccountDeletionConfirmation, { ...props, ...state }))
    assert.deepEqual(clean(button.props.modifiers), [{ modifier: 'disabled', args: [true] }])
    button.props.onPress()
    assert.equal(confirmed, 0)
  }
  const valid = h.render(AccountDeletionConfirmation, {
    ...props,
    confirmation: 'DELETE',
    error: 'Sign in again.',
  })
  const button = deleteButton(valid)
  assert.deepEqual(clean(button.props.modifiers), [{ modifier: 'disabled', args: [false] }])
  button.props.onPress()
  assert.equal(confirmed, 1)
  assert.equal(nodes(valid).find((node) => node.type === 'TextField').props.defaultValue, 'DELETE')
  assert.match(JSON.stringify(valid), /Sign in again\./)
  const push = h.render(PushPrePrompt, {
    theme: {},
    permission: 'Denied',
    onContinue: () => permitted++,
    onLater: () => dismissed++,
  })
  nodes(push)
    .find((node) => node.props.children?.includes?.('Open device settings'))
    .props.onPress()
  nodes(push)
    .find((node) => node.props.children?.includes?.('Not now'))
    .props.onPress()
  assert.equal(permitted, 1)
  assert.equal(dismissed, 1)
})
test('failed profile saves keep the edited name; retry can succeed without changing email', async () => {
  const h = hooks(),
    { SettingsView } = views(h)
  let fail = true,
    saved
  const props = {
    theme: {},
    page: 'account',
    data: { profile: { displayName: 'Original', email: 'viewer@example.com' } },
    actions: {
      saveName: async (value) => {
        saved = value
        if (fail) throw new Error('Offline')
      },
    },
  }
  const render = () => h.render(SettingsView, props)
  const save = () => nodes(render()).find((node) => node.type === 'Button' && node.props.label === 'Save name')
  assert.equal(save(), undefined)
  nodes(render())
    .find((node) => node.type === 'TextField')
    .props.onValueChange('Changed')
  save().props.onPress()
  await new Promise(setImmediate)
  // The edit survives a failed save (the field is rebuilt from it) and can be retried.
  assert.equal(nodes(render()).find((node) => node.type === 'TextField').props.defaultValue, 'Changed')
  assert.match(text(render()), /Offline/)
  fail = false
  save().props.onPress()
  await new Promise(setImmediate)
  assert.equal(saved, 'Changed')
})
