/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file, mocks = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
    URL,
    setTimeout,
    clearTimeout,
    console: { warn() {} },
    Error,
    AbortController,
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
const routes = load('lib/pushRoutes.ts')
function fixture(globals = {}) {
  const store = new Map(),
    calls = [],
    listeners = {},
    filters = []
  let user = 'alice',
    granted = true,
    token = 'ExpoPushToken[initial]',
    capture,
    failure = null
  const service = load(
    'services/pushRegistrationService.ts',
    {
      '@react-native-async-storage/async-storage': {
        default: {
          getItem: async (key) => store.get(key) ?? null,
          setItem: async (key, value) => store.set(key, value),
          removeItem: async (key) => store.delete(key),
        },
      },
      'expo-crypto': { randomUUID: () => 'installation-id' },
      'expo-notifications': {
        getPermissionsAsync: async () => ({ granted }),
        addPushTokenListener: (callback) => {
          listeners.token = callback
          return { remove: () => delete listeners.token }
        },
        clearLastNotificationResponseAsync: async () => calls.push(['clearResponse']),
        dismissAllNotificationsAsync: async () => calls.push(['dismiss']),
      },
      'react-native': {
        Platform: { OS: 'ios' },
        AppState: {
          addEventListener: (_event, callback) => {
            listeners.app = callback
            return { remove: () => delete listeners.app }
          },
        },
      },
      './convexClient': {
        api: { notifications: { tokens: { register: 'register', unregister: 'unregister' } } },
        mutateConvex: async (ref, args) => {
          calls.push([ref, args, user])
          if (failure) throw failure
        },
      },
      './authService': { loadAuthSession: async () => (user ? { user: { id: user } } : null) },
      './notificationsService': {
        setRemoteNotificationFilter: (filter) => filters.push(filter),
        preparePushRegistration: async (id, allowPrompt, shouldPersist) => {
          calls.push(['capture', id, allowPrompt])
          return capture
            ? capture(shouldPersist)
            : { type: 'expo', token, platform: 'ios', userId: id }
        },
      },
      './bannerPreferencesService': {
        loadBannerPreferences: async () => ({ mention: false }),
        allowsBanner: (preferences, type) => preferences[type] !== false,
      },
      '../lib/pushRoutes': routes,
    },
    globals,
  )
  return {
    service,
    store,
    calls,
    listeners,
    filters,
    user: (value) => {
      user = value
    },
    permission: (value) => {
      granted = value
    },
    token: (value) => {
      token = value
    },
    capture: (value) => {
      capture = value
    },
    fail: (value) => {
      failure = value
    },
  }
}
test('permission-granted startup registers a stable installation, token rotation re-registers, unchanged tokens are single-flight', async () => {
  const f = fixture()
  const stop = f.service.startPushRegistration('alice')
  await Promise.all([
    f.service.syncPushRegistration('alice'),
    f.service.syncPushRegistration('alice'),
  ])
  assert.equal(f.calls.filter((call) => call[0] === 'register').length, 1)
  assert.equal(f.calls.find((call) => call[0] === 'capture')[2], false)
  const first = f.calls.find((call) => call[0] === 'register')[1]
  assert.equal(first.deviceId, 'installation-id')
  f.token('ExpoPushToken[rotated]')
  f.listeners.token()
  await f.service.syncPushRegistration('alice')
  assert.equal(f.calls.filter((call) => call[0] === 'register').length, 2)
  assert.equal(f.calls.filter((call) => call[0] === 'register')[1][1].deviceId, first.deviceId)
  assert.equal(f.service.hasRegisteredPushToken('alice'), true)
  stop()
  assert.equal(f.listeners.token, undefined)
  assert.equal(f.service.hasRegisteredPushToken('alice'), false)
})
test('startup does not prompt for permission; permission grant can register and revocation unregisters', async () => {
  const f = fixture()
  f.permission(false)
  f.service.startPushRegistration('alice')
  await f.service.syncPushRegistration('alice')
  assert.equal(f.calls.length, 0)
  f.permission(true)
  f.listeners.app('active')
  await f.service.syncPushRegistration('alice')
  assert.ok(f.calls.some((call) => call[0] === 'register'))
  f.permission(false)
  f.listeners.app('active')
  await f.service.syncPushRegistration('alice')
  assert.ok(f.calls.some((call) => call[0] === 'unregister'))
  assert.equal(f.service.hasRegisteredPushToken('alice'), false)
})
test('sign-out revokes before identity removal, clears local token/notification history and cannot be blocked by backend failure', async () => {
  const f = fixture()
  f.service.startPushRegistration('alice')
  await f.service.syncPushRegistration('alice')
  f.store.set('overlay-push-token:alice', 'cached')
  await f.service.unregisterPushRegistration('alice')
  const revoke = f.calls.find((call) => call[0] === 'unregister')
  assert.equal(revoke[2], 'alice')
  assert.equal(revoke[1].deviceId, 'installation-id')
  assert.equal(f.store.has('overlay-push-token:alice'), false)
  assert.ok(f.calls.some((call) => call[0] === 'dismiss'))
  f.fail(new Error('offline'))
  await assert.doesNotReject(f.service.unregisterPushRegistration('alice'))
  const auth = fs.readFileSync(path.join(root, 'contexts/AuthContext.tsx'), 'utf8')
  assert.match(
    auth,
    /await unregisterPushRegistration\(current.user.id\)[\s\S]*?await clearAuthSession\(\)/,
  )
})
test('old-account token capture cannot register after an identity change, and raw device fallback never goes to Expo backend', async () => {
  const f = fixture()
  let release
  const deferred = new Promise((resolve) => {
    release = resolve
  })
  f.capture(() => deferred)
  const stop = f.service.startPushRegistration('alice')
  const pending = f.service.syncPushRegistration('alice')
  await new Promise(setImmediate)
  stop()
  f.user('bob')
  release({ type: 'expo', token: 'ExpoPushToken[old]', platform: 'ios', userId: 'alice' })
  await pending
  assert.equal(f.calls.filter((call) => call[0] === 'register').length, 0)
  f.capture(() => ({ type: 'device', token: 'raw-apns', platform: 'ios' }))
  f.service.startPushRegistration('bob')
  await assert.rejects(f.service.syncPushRegistration('bob'), /Expo push token is unavailable/)
  assert.equal(f.calls.filter((call) => call[0] === 'register').length, 0)
})
test('backend registration failures stay retryable, and foreground remote banners respect local category preferences', async () => {
  const f = fixture()
  f.fail(new Error('Denied'))
  f.service.startPushRegistration('alice')
  await assert.rejects(f.service.syncPushRegistration('alice'), /Denied/)
  assert.equal(f.service.hasRegisteredPushToken('alice'), false)
  f.fail(null)
  await f.service.syncPushRegistration('alice')
  const filter = f.filters.at(-1)
  assert.equal(await filter('/dm/id?workspaceId=w&notificationType=mention'), false)
  assert.equal(await filter('/dm/id?workspaceId=w&notificationType=message'), true)
  assert.equal(await filter('https://external.invalid'), false)
})
test('hung SDK capture is bounded and a late signed-out capture cannot restore the token cache', async () => {
  const f = fixture({
    setTimeout: (callback) => {
      queueMicrotask(callback)
      return 0
    },
    clearTimeout() {},
  })
  let release
  const deferred = new Promise((resolve) => {
    release = resolve
  })
  f.capture(async (shouldPersist) => {
    const token = await deferred
    if (shouldPersist()) f.store.set('overlay-push-token:alice', 'late')
    return token
  })
  const stop = f.service.startPushRegistration('alice')
  await assert.rejects(
    f.service.syncPushRegistration('alice'),
    /Could not update device notifications/,
  )
  stop()
  release({ type: 'expo', token: 'ExpoPushToken[late]', platform: 'ios' })
  await new Promise(setImmediate)
  assert.equal(f.store.has('overlay-push-token:alice'), false)
  assert.equal(f.calls.filter((call) => call[0] === 'register').length, 0)
})
test('push URLs are local room/thread destinations only; workspace switches precede existing conversation routing', async () => {
  for (const value of [
    null,
    '',
    '//external.invalid',
    'https://external.invalid/channel/id',
    '/auth/callback?workspaceId=w',
    '/dm/id',
    '/dm/id?workspaceId=w#injection',
    '/thread/id?workspaceId=w&conversation=bad/slash',
  ])
    assert.equal(routes.parsePushUrl(value), null)
  assert.equal(routes.parsePushUrl('/dm/id?workspaceId=w').conversationId, 'id')
  const calls = [],
    router = { push: (value) => calls.push(['push', value]) }
  let workspace = 'old'
  const navigation = load('lib/notificationRouting.ts', {
    'react-native': { Alert: { alert: (...args) => calls.push(['alert', ...args]) } },
    './pushRoutes': routes,
    '../services/convexClient': {
      api: {
        collaboration: { rooms: { scope: 'scope' } },
        chat: { personal: { getSummary: 'summary' } },
      },
      convexWorkspaceId: () => workspace,
      queryConvex: async (_ref, args) => {
        calls.push(['query', args])
        return { conversationType: 'channel' }
      },
    },
  })
  await navigation.openPushNotificationDestination(
    router,
    '/thread/root?workspaceId=new&conversation=room',
    async (id) => {
      workspace = id
      calls.push(['switch', id])
    },
  )
  assert.equal(calls[0][0], 'switch')
  assert.equal(calls[1][1].workspaceId, 'new')
  assert.equal(calls[2][1].pathname, '/thread/[id]')
  calls.length = 0
  await navigation.openPushNotificationDestination(
    router,
    '/dm/id?workspaceId=new',
    async () => {},
    () => false,
  )
  assert.equal(calls.length, 0)
  const hook = fs.readFileSync(path.join(root, 'hooks/usePushNotifications.ts'), 'utf8')
  assert.match(hook, /getLastNotificationResponseAsync/)
  assert.match(hook, /addNotificationResponseReceivedListener/)
})
