/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const loaded = { exports: {} }
  vm.runInNewContext('(function(require,module,exports){' + outputText + '\n})', { Error, console, ...globals })((id) => {
    if (id === '../lib/activity') return load('lib/activity.ts')
    assert.ok(Object.hasOwn(dependencies, id), 'Unexpected dependency: ' + id)
    return dependencies[id]
  }, loaded, loaded.exports)
  return loaded.exports
}

const session = (id = 'user-1', token = 'native-token') => ({ user: { id, email: 'test@example.com' }, accessToken: token, refreshToken: 'refresh-token' })
const broker = () => load('services/nativeConvexTokenBroker.ts')

test('generated API imports are erased and runtime references only use anyApi', () => {
  const sentinel = {}
  const native = load('services/convexApi.ts', { 'convex/server': { anyApi: sentinel } })
  assert.equal(native.api, sentinel)
})

test('token broker reads stored token and coalesces requests per mode', async () => {
  let reads = 0
  const fetch = broker().createNativeConvexTokenFetcher('user-1', {
    load: async () => { reads++; return session() }, refresh: async () => assert.fail('unexpected refresh'), save: async () => assert.fail('unexpected save'), isCurrent: () => true,
  })
  const first = fetch({ forceRefreshToken: false })
  assert.equal(first, fetch({ forceRefreshToken: false }))
  assert.equal(await first, 'native-token')
  assert.equal(reads, 2)
})

test('forced refresh is single flight, persists new session and does not block normal mode', async () => {
  let stored = session()
  let release
  let refreshes = 0
  const pending = new Promise(resolve => { release = resolve })
  const fetch = broker().createNativeConvexTokenFetcher('user-1', {
    load: async () => stored, refresh: async () => { refreshes++; await pending; return session('user-1', 'new-token') },
    save: async value => { stored = value }, isCurrent: () => true,
  })
  const forced = fetch({ forceRefreshToken: true })
  assert.equal(forced, fetch({ forceRefreshToken: true }))
  assert.equal(await fetch({ forceRefreshToken: false }), 'native-token')
  release()
  assert.equal(await forced, 'new-token')
  assert.equal(refreshes, 1)
  assert.equal(stored.accessToken, 'new-token')
})

test('missing, empty and mismatched sessions return null without persisting', async () => {
  for (const stored of [null, session('another-user'), session('user-1', '  ')]) {
    let failures = 0
    const fetch = broker().createNativeConvexTokenFetcher('user-1', {
      load: async () => stored, refresh: async () => assert.fail('unexpected refresh'), save: async () => assert.fail('unexpected save'),
      isCurrent: () => true, onFailure: () => failures++,
    })
    assert.equal(await fetch({ forceRefreshToken: false }), null)
    assert.equal(failures, 1)
  }
})

test('identity change during refresh drops the result before save', async () => {
  let stored = session()
  const fetch = broker().createNativeConvexTokenFetcher('user-1', {
    load: async () => stored, refresh: async () => { stored = session('user-2'); return session('user-1', 'new-token') },
    save: async () => assert.fail('stale refresh must not persist'), isCurrent: () => true,
  })
  assert.equal(await fetch({ forceRefreshToken: true }), null)
})

test('refresh returning another identity is rejected', async () => {
  const fetch = broker().createNativeConvexTokenFetcher('user-1', {
    load: async () => session(), refresh: async () => session('user-2'), save: async () => assert.fail('wrong identity'), isCurrent: () => true,
  })
  assert.equal(await fetch({ forceRefreshToken: true }), null)
})

test('sign out during a flight returns null and never retries or saves', async () => {
  let current = true
  const fetch = broker().createNativeConvexTokenFetcher('user-1', {
    load: async () => session(), refresh: async () => { current = false; return session() },
    save: async () => assert.fail('signed out'), isCurrent: () => current, onFailure: () => assert.fail('stale retry'),
  })
  assert.equal(await fetch({ forceRefreshToken: true }), null)
  assert.equal(await fetch({ forceRefreshToken: false }), null)
})

test('network failure clears single flight so retry can succeed', async () => {
  let failures = 0
  let fail = true
  const fetch = broker().createNativeConvexTokenFetcher('user-1', {
    load: async () => { if (fail) throw new Error('offline'); return session() }, refresh: async () => session(), save: async () => {},
    isCurrent: () => true, onFailure: () => failures++,
  })
  assert.equal(await fetch({ forceRefreshToken: false }), null)
  assert.equal(failures, 1)
  fail = false
  assert.equal(await fetch({ forceRefreshToken: false }), 'native-token')
  assert.equal(failures, 1)
})

test('retry backoff follows web 1s through 30s cap', () => {
  const { convexTokenRetryDelay: delay } = broker()
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(delay), [1000, 1000, 2000, 4000, 8000, 16000, 30000, 30000])
})

test('retry scheduling uses increasing delays and cancels on identity unmount', () => {
  const pending = new Map()
  let id = 0
  let retries = 0
  const { scheduleConvexTokenRetry } = load('services/nativeConvexTokenBroker.ts', {}, {
    setTimeout: (callback, delay) => { pending.set(++id, { callback, delay }); return id },
    clearTimeout: timer => pending.delete(timer),
  })
  const cancel = scheduleConvexTokenRetry(0, () => retries++)
  assert.equal(pending.get(1).delay, 1000)
  pending.get(1).callback()
  assert.equal(retries, 1)
  cancel()
  scheduleConvexTokenRetry(1, () => retries++)()
  assert.equal(pending.size, 0)
  scheduleConvexTokenRetry(8, () => retries++)
  assert.equal(pending.get(3).delay, 30000)
})

test('persisting a refresh cannot resurrect a signed-out or switched session', async () => {
  let stored = JSON.stringify(session())
  const native = load('services/authService.ts', {
    'expo-crypto': {},
    'expo-secure-store': {
      getItemAsync: async () => stored,
      setItemAsync: async (_key, value) => { stored = value },
      deleteItemAsync: async () => { stored = null },
    },
    './appConfig': { AUTH_BASE_URL: 'https://isolated.invalid' },
  }, { console: { log() {}, warn() {} } })
  const previous = session()
  const refreshed = { ...session('user-1', 'fresh'), refreshToken: 'new-refresh' }
  await native.saveRefreshedAuthSession(refreshed, previous)
  assert.equal(JSON.parse(stored).accessToken, 'fresh')
  await native.saveRefreshedAuthSession(refreshed, previous)
  await native.clearAuthSession()
  await assert.rejects(native.saveRefreshedAuthSession(refreshed, previous), /session changed/)
  assert.equal(stored, null)
  await native.saveAuthSession(session('user-2'))
  await assert.rejects(native.saveRefreshedAuthSession(refreshed, previous), /session changed/)
  assert.equal(JSON.parse(stored).user.id, 'user-2')
})

test('pagination subscribes past empty filtered pages, replaces shifted cursors and cleans up', () => {
  const subscriptions = new Map()
  let stopped = 0
  const native = {
    subscribeConvex: (_ref, args, onValue) => {
      const key = args.paginationOpts.cursor
      subscriptions.set(key, onValue)
      return () => { stopped++; subscriptions.delete(key) }
    },
  }
  const { subscribeAllPages } = load('services/convexPagination.ts', { './convexClient': native })
  const received = []
  const stop = subscribeAllPages('personalList', { workspaceId: 'workspace-1', archived: false }, value => received.push(value))
  subscriptions.get(null)({ page: [], isDone: false, continueCursor: 'page-2' })
  assert.ok(subscriptions.has('page-2'))
  subscriptions.get('page-2')({ page: [{ id: 'chat-1' }], isDone: true, continueCursor: '' })
  assert.equal(received.at(-1)[0].id, 'chat-1')
  subscriptions.get(null)({ page: [{ id: 'new-chat' }], isDone: false, continueCursor: 'shifted-page' })
  assert.equal(subscriptions.has('page-2'), false)
  assert.equal(stopped, 1)
  assert.ok(subscriptions.has('shifted-page'))
  stop()
  assert.equal(subscriptions.size, 0)
  assert.equal(stopped, 3)
})

function fixture() {
  const rooms = Object.fromEntries(['state', 'access', 'scope', 'messages', 'message', 'activePublicStreams', 'setReaction', 'setPinned', 'setSaved', 'setThreadFollow', 'editMessage', 'deleteMessage', 'heartbeat', 'updateMyState', 'addParticipant', 'removeParticipant'].map(key => [key, key]))
  const api = {
    collaboration: { rooms, roomList: { list: 'roomList' }, activity: { notifications: 'notifications', markRead: 'markRead' }, management: { view: 'management' } },
    chat: { personal: Object.fromEntries(['getSummary', 'getMessages', 'activePublicStreams', 'setRead'].map(key => [key, 'personal.' + key])) },
  }
  const calls = []
  const watches = new Map()
  const values = new Map()
  const client = {
    query: async (ref, args) => { calls.push(['query', ref, args]); const value = values.get(ref); if (value instanceof Error) throw value; return value ?? null },
    mutation: async (ref, args) => { calls.push(['mutation', ref, args]); return null },
    watchQuery: (ref, args) => {
      calls.push(['watch', ref, args])
      return {
        localQueryResult: () => { const value = values.get(ref); if (value instanceof Error) throw value; return value },
        onUpdate: listener => { watches.set(ref, listener); return () => watches.delete(ref) },
      }
    },
  }
  const convex = load('services/convexClient.ts', { './appApi': { getRequestWorkspaceId: () => 'workspace-1' }, './convexApi': { api } })
  convex.setMobileConvexClient(client)
  const projection = load('../src/shared/chat/public-stream-projection.ts', { './transcript-part-identity': load('../src/shared/chat/transcript-part-identity.ts') })
  const service = load('services/collaborationService.ts', { './overlayClient': { mobileOverlayAppClient: {} }, './convexClient': convex, '../../src/shared/chat/public-stream-projection': projection })
  const personal = () => load('services/chatStorage.ts', {
    '../lib/agentThread': load('lib/agentThread.ts', { '@overlay/chat-core': {}, '../../src/shared/agents/native-agent-approval': {}, '../../src/shared/agents/native-agent-input': {}, '../../src/shared/agents/run-questions': {} }),
    '@react-native-async-storage/async-storage': { default: { getItem: async () => null, setItem: async () => {} } },
    '@overlay/chat-core': { normalizeTranscriptAssistantParts: () => ({ blocks: [], sources: [] }) },
    './convexClient': convex,
    './convexPagination': load('services/convexPagination.ts', { './convexClient': convex }),
    './appApi': {}, './chatTypes': { generateChatId: () => 'draft-1' },
    '../../src/shared/chat/public-stream-projection': projection,
  })
  const emit = (ref, value) => { values.set(ref, value); watches.get(ref)?.() }
  return { service, personal, convex, calls, watches, values, emit }
}

test('personal transcript receives native updates, streams, timestamps and read-through id', async () => {
  const { personal, emit, calls, watches } = fixture()
  const storage = personal()
  const received = []
  const stop = storage.subscribePersonalChat('chat-1', chat => received.push(chat))
  emit('personal.getSummary', { _id: 'chat-1', workspaceId: 'workspace-1', title: 'Hello', createdAt: 1, lastModified: 5, askModelIds: [], actModelId: 'model-1', lastMode: 'act' })
  emit('personal.getMessages', { page: [{ message: { _id: 'assistant-1', role: 'assistant', content: '', parts: [], createdAt: 123, status: 'generating' }, contextUser: null, outputs: [] }], isDone: true, continueCursor: '' })
  emit('personal.activePublicStreams', [{ assistantMessageId: 'assistant-1', runId: 'run-1', receiptId: 'receipt-1', executionGeneration: 1, invocation: 1, sequence: 1, text: 'Live reply' }])
  assert.equal(received.at(-1).messages[0].content, 'Live reply')
  assert.equal(received.at(-1).messages[0].timestamp, 123)
  await storage.setPersonalChatRead('chat-1', false, 'assistant-1')
  assert.equal(calls.at(-1)[2].throughMessageId, 'assistant-1')
  emit('personal.getSummary', null)
  assert.equal(received.at(-1), null)
  assert.equal(watches.has('personal.getMessages'), false)
  assert.equal(watches.has('personal.activePublicStreams'), false)
  stop()
  assert.equal(watches.size, 0)
})

test('personal chat returns null for unavailable scope and propagates query failures', async () => {
  const { personal, values } = fixture()
  const storage = personal()
  assert.equal(await storage.loadChat('unavailable'), null)
  const error = new Error('offline')
  values.set('personal.getSummary', error)
  await assert.rejects(storage.loadChat('chat-1'), value => value === error)
})

test('search and notifications resolve personal chats, rooms and threads without REST', async () => {
  for (const type of ['personal', 'channel', 'dm', 'unavailable']) {
    const { convex, values } = fixture()
    const routes = []
    const alerts = []
    const router = { push: route => routes.push(route) }
    const routing = load('lib/notificationRouting.ts', {
      'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
      '../services/convexClient': convex,
    })
    if (type === 'personal') values.set('personal.getSummary', { _id: 'chat-1' })
    else if (type !== 'unavailable') values.set('scope', { conversationType: type })
    await routing.openConversationDestination(router, 'chat-1')
    if (type === 'unavailable') { assert.equal(alerts.length, 1); assert.equal(routes.length, 0); continue }
    assert.equal(routes[0].pathname, '/' + (type === 'personal' ? 'chat' : type) + '/[id]')
    if (type !== 'personal') {
      await routing.openNotificationDestination(router, { conversationId: 'chat-1', threadRootMessageId: 'root-1' })
      assert.equal(routes.at(-1).pathname, '/thread/[id]')
      assert.equal(routes.at(-1).params.id, 'root-1')
    }
    const count = routes.length
    await routing.openNotificationDestination(router, { conversationId: 'chat-1', conversationState: 'deleted' })
    assert.equal(routes.length, count)
  }
})

test('room public streams project text then settle without duplicate subscription state', () => {
  const { service, emit, watches } = fixture()
  const pages = []
  const stop = service.subscribeRoomMessages('room-1', {}, page => pages.push(page))
  emit('access', { title: 'Product', conversationType: 'channel' })
  emit('messages', { page: [{ id: 'assistant-1', content: '', parts: [], status: 'generating' }], isDone: true, continueCursor: '' })
  emit('activePublicStreams', [{ assistantMessageId: 'assistant-1', runId: 'run-1', receiptId: 'receipt-1', executionGeneration: 1, invocation: 1, sequence: 1, text: 'Live reply' }])
  assert.equal(pages.at(-1).messages[0].content, 'Live reply')
  emit('messages', { page: [{ id: 'assistant-1', content: 'Settled reply', parts: [], status: 'completed' }], isDone: true, continueCursor: '' })
  assert.equal(pages.at(-1).messages[0].content, 'Settled reply')
  assert.equal(watches.has('activePublicStreams'), false)
  stop()
  assert.equal(watches.size, 0)
})

test('room mutations match web workspace, message, follow and heartbeat arguments', async () => {
  const { service, calls } = fixture()
  await service.setRoomPinned('room-1', 'message-1', true)
  await service.setMessageSaved('room-1', 'message-1', false)
  await service.setThreadFollowed('room-1', 'root-1', true)
  await service.editRoomMessage('room-1', 'message-1', 'Edited')
  await service.deleteRoomMessage('room-1', 'message-1')
  await service.sendRoomPresence('room-1', { status: 'online', typing: true, sessionId: 'mobile-session' })
  const json = JSON.parse(JSON.stringify(calls))
  assert.deepEqual(json[0], ['mutation', 'setPinned', { workspaceId: 'workspace-1', conversationId: 'room-1', messageId: 'message-1', pinned: true }])
  assert.deepEqual(json[2][2], { workspaceId: 'workspace-1', conversationId: 'room-1', threadRootMessageId: 'root-1', followed: true })
  assert.equal(json[5][2].sessionId, 'mobile-session')
  assert.equal(json[5][2].typing, true)
  assert.ok(json.every(call => call[2].workspaceId === 'workspace-1'))
})

test('room subscription updates and access revocation do not retain stale state', () => {
  const { service, watches, emit } = fixture()
  const received = []
  const stop = service.subscribeRoomState('room-1', value => received.push(value))
  emit('state', { participants: [{ principalId: 'me' }], reactions: [], pins: [], saved: [], follows: [], presence: [] })
  emit('state', null)
  assert.equal(received.length, 2)
  assert.equal(received[1], null)
  stop()
  assert.equal(watches.size, 0)
})

test('room message subscription includes thread root and uses cursor pagination', async () => {
  const { service, calls, values, emit, watches } = fixture()
  const pages = []
  const stop = service.subscribeRoomMessages('room-1', { threadRootMessageId: 'root-1' }, page => pages.push(page))
  emit('access', { title: 'Product', conversationType: 'channel' })
  emit('scope', { conversationType: 'channel', scope: 'workspace' })
  emit('messages', { page: [{ id: 'reply-1' }], isDone: false, continueCursor: 'next-page' })
  emit('message', { id: 'root-1' })
  assert.equal(pages.at(-1).messages.length, 2)
  assert.equal(pages.at(-1).cursor, 'next-page')
  assert.equal(pages.at(-1).hasMore, true)
  values.set('messages', { page: [], isDone: true, continueCursor: '' })
  await service.loadRoomMessages('room-1', { cursor: 'next-page' })
  assert.equal(calls.findLast(call => call[0] === 'query' && call[1] === 'messages')[2].paginationOpts.cursor, 'next-page')
  emit('access', null)
  assert.equal(pages.at(-1).messages.length, 0)
  stop()
  assert.equal(watches.size, 0)
})

test('notifications are live, empty/null safe, filtered by web type and unsubscribed', () => {
  const { service, emit, watches } = fixture()
  const received = []
  const stop = service.subscribeNotifications(items => received.push(items))
  emit('notifications', null)
  assert.equal(received.at(-1).length, 0)
  const items = [{ id: 'n1', type: 'mention' }, { id: 'n2', type: 'thread', readAt: 10 }, { id: 'n3', type: 'reaction' }]
  emit('notifications', items)
  assert.equal(received.at(-1), items)
  assert.equal(service.filterNotifications(items, 'unread').length, 2)
  assert.equal(service.filterNotifications(items, 'threads')[0].id, 'n2')
  assert.equal(service.filterNotifications(items, 'mentions')[0].id, 'n1')
  stop()
  assert.equal(watches.size, 0)
})

test('notification markRead uses explicit ids or one conversation; empty ids do not mark anything', async () => {
  const { service, calls } = fixture()
  await service.markNotificationsRead([])
  assert.equal(calls.length, 0)
  await service.markNotificationsRead(['n1'])
  await service.markConversationNotificationsRead('room-1')
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['mutation', 'markRead', { workspaceId: 'workspace-1', notificationIds: ['n1'] }],
    ['mutation', 'markRead', { workspaceId: 'workspace-1', conversationId: 'room-1' }],
  ])
})

test('query errors propagate and policy errors notify the app-level availability state', async () => {
  const { service, convex, values, emit } = fixture()
  let changes = 0
  const stopPolicy = convex.subscribeNativePolicy(() => changes++)
  const error = new Error('DEPLOYMENT_FEATURE_ACCESS_DENIED')
  values.set('notifications', error)
  await assert.rejects(service.fetchNotifications(), value => value === error)
  assert.equal(convex.getNativePolicyBlocked(), true)
  assert.equal(changes, 1)
  convex.setMobileConvexClient(null)
  assert.equal(convex.getNativePolicyBlocked(), false)
  stopPolicy()
  assert.equal(convex.isNativePolicyError(new Error('offline')), false)
  assert.equal(convex.isNativePolicyError(new Error('NATIVE_AUTH_DISABLED')), true)
})

test('subscription errors are caught rather than thrown into rendering', () => {
  const { service, convex, emit } = fixture()
  const stop = service.subscribeRoomState('room-1', () => assert.fail('should not emit an error as state'))
  assert.doesNotThrow(() => emit('state', new Error('DEPLOYMENT_FEATURE_ACCESS_DENIED')))
  assert.equal(convex.getNativePolicyBlocked(), true)
  stop()
})
