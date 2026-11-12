/* eslint-disable @typescript-eslint/no-require-imports */
require('./register-native-transcript-test-runtime.cjs')
require('tsx/cjs')
const assert = require('node:assert/strict')
const Module = require('node:module')
const test = require('node:test')
const React = require('../../node_modules/react')
const { act, create } = require('../../node_modules/react-test-renderer')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const ThemeContext = React.createContext({ background: '#111', text: '#eee', textSecondary: '#aaa', foreground: '#eee', surfaceElevated: '#222', surfaceSubtle: '#333', border: '#444' })
const state = {
  workspaceId: 'workspace-a', user: { id: 'user-a' }, nativeReady: true, models: [], loads: [], pendingLoad: null, createGate: null, createError: null, history: [], stream: null, streamArgs: null,
  picker: null, documentPicker: null, uploadGate: null, uploadCalls: [], mediaGate: null, mediaCalls: [],
 preferenceGate: null, modelPreferences: [], saveCalls: [], createCalls: [], lastOpenedWrites: [], lastOpenedGate: null, lastOpenedError: null, skillCalls: [],
 skillGate: null, approvalGate: null, approvalCalls: [], runListeners: [], runStops: 0, snapshots: [], domRenders: 0,
  composer: null, modelPicker: null, nativeProps: null, draftReviewProps: null, domProps: null, search: null, appState: new Set(), actionsProps: null, headerProps: null,
  stopCalls: [], stopGate: null, routeParams: null, globalRouteParams: null, foregroundRouteParams: null, historyLoads: 0, replaceCalls: [],
  focusSubscriptions: new Set(), focused: true, listRows: new Map(), personalChatListeners: [],
}
let uuid = 0
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const model = (id, name) => ({ id, name, provider: 'test', cost: 0 })
const imageModelCatalog = [model('image-model', 'Image Model')]
const videoModelCatalog = [model('video-model', 'Video Model')]
const CHAT_A = 'aaaaaaaaaaaaaaaaaaaa'
const CHAT_B = 'bbbbbbbbbbbbbbbbbbbb'
const SERVER_NEW = 'cccccccccccccccccccc'
const fixture = id => ({ id, title: id, createdAt: 1, updatedAt: 2, modelId: 'model-a', actModelId: 'model-a', askModelIds: ['model-a'], messages: [
  { id: id + '-u', turnId: id + '-turn', role: 'user', content: 'Question', timestamp: 1 },
  { id: id + '-a', turnId: id + '-turn', role: 'assistant', content: 'Answer', timestamp: 2, selectedModelId: 'model-a', responses: [{ id: id + '-r', modelId: 'model-a', modelName: 'Model A', provider: 'test', content: 'Answer', isLoading: false }] },
] })
const appState = { currentState: 'active', addEventListener: (_e, fn) => { state.appState.add(fn); return { remove: () => state.appState.delete(fn) } } }
const rn = { ActivityIndicator: 'ActivityIndicator', Alert: { alert() {} }, AppState: appState, Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, StyleSheet: { absoluteFillObject: {}, hairlineWidth: 1, create: x => x }, Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView' }
const focus = callback => React.useEffect(() => {
  const subscription = { callback, cleanup: null }
  state.focusSubscriptions.add(subscription)
  if (state.focused) subscription.cleanup = callback()
  return () => { subscription.cleanup?.(); state.focusSubscriptions.delete(subscription) }
}, [callback])
function setNavigationFocus(focused) {
  state.focused = focused
  for (const subscription of state.focusSubscriptions) {
    if (focused && !subscription.cleanup) subscription.cleanup = subscription.callback()
    if (!focused && subscription.cleanup) { subscription.cleanup(); subscription.cleanup = null }
  }
}
const useTheme = () => ({ theme: React.useContext(ThemeContext), isDark: false })
function MockDom(props) { state.domRenders++; state.domProps = props; state.snapshots.push(props.snapshot); React.useEffect(() => props.onReady(props.snapshot), [props.snapshot, props.onReady]); return React.createElement('TranscriptProbe', { snapshot: props.snapshot }) }
function MockComposer(props) { state.composer = props; return React.createElement('ComposerProbe', { value: props.inputValue, imageBase64: props.imageBase64, onChangeInput: props.onChangeInput, onSend: props.onSend, onPickImage: props.onPickImage, onPickCamera: props.onPickCamera, onPickFile: props.onPickFile }) }
function MockChatHeader(props) { state.headerProps = props; return null }
function MockActionsSheet(props) { state.actionsProps = props; return null }
function MockModelPicker(props) { state.modelPicker = props; return null }
function MockSearch(props) { state.search = props; return null }
const storage = {
  createNewChat: async (modelId, options) => { state.createCalls.push({ modelId, options }); if (state.createGate) await state.createGate.promise; if (state.createError) throw state.createError; return fixture(SERVER_NEW) },
  getLastOpenedChatId: async () => null,
  loadChat: async (id, workspaceId) => { state.loads.push({ id, workspaceId }); return state.pendingLoad ? state.pendingLoad(id, workspaceId) : fixture(id) },
  loadChatsMeta: async () => { state.historyLoads++; return state.history }, saveChat: async (chat, workspaceId) => { state.saveCalls.push({ chat, workspaceId }) }, subscribeChats: () => () => {},
  subscribePersonalChat: (conversationId, onValue) => {
    const listener = { conversationId, onValue, active: true }
    state.personalChatListeners.push(listener)
    return () => { listener.active = false }
  }, setPersonalChatRead: async () => {}, setLastOpenedChatId: async (id, workspaceId) => {
    state.lastOpenedWrites.push({ id, workspaceId })
    if (state.lastOpenedGate) await state.lastOpenedGate.promise
    if (state.lastOpenedError) throw state.lastOpenedError
  },
}
const ai = {
  chatStream: async function* (...args) { state.streamArgs = args; if (state.stream) yield* state.stream() },
  getAvailableModels: async () => state.models, getLastSelectedModelId: async () => null,
  setLastSelectedModelId: async (id, workspaceId) => { state.modelPreferences.push({ id, workspaceId }); if (state.preferenceGate) await state.preferenceGate.promise },
  stopConversation: async (conversationId, messageId, options) => {
    state.stopCalls.push({ conversationId, messageId, options })
    if (state.stopGate) await state.stopGate.promise
  },
  uploadDocument: async (uri, name, mimeType, options) => {
    state.uploadCalls.push({ uri, name, mimeType, options })
    return state.uploadGate ? state.uploadGate.promise : { ids: ['file-1'], name }
  },
}
const router = { push() {}, replace(params) { state.replaceCalls.push(params) }, setParams(params) { state.globalRouteParams = params; state.foregroundRouteParams = { ...state.foregroundRouteParams, ...params } } }
const navigation = { setParams(params) { state.routeParams = params } }
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  const filename = parent?.filename || ''
  if (request === 'react') return React
  if (request === 'react/jsx-runtime') return require('../../node_modules/react/jsx-runtime')
  if (request === 'react-native') return rn
  if (request === 'expo-router') return { useFocusEffect: focus, useRouter: () => router, useNavigation: () => navigation }
  if (filename.endsWith('/components/chat/ChatScreen.tsx')) {
    if (request === './NativePersonalChatTranscript') {
      const nativeHost = originalLoad.call(this, request, parent, isMain)
      return { NativePersonalChatTranscript: props => { state.nativeProps = props; return React.createElement(nativeHost.NativePersonalChatTranscript, props) } }
    }
    const mocks = {
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }, '@expo/vector-icons': { Feather: 'Feather' },
      'expo-image-picker': { requestMediaLibraryPermissionsAsync: async () => ({ status: 'granted' }), requestCameraPermissionsAsync: async () => ({ status: 'granted' }), launchImageLibraryAsync: async () => state.picker?.promise ?? ({ canceled: true, assets: [] }), launchCameraAsync: async () => ({ canceled: true, assets: [] }) },
      'expo-document-picker': { getDocumentAsync: async () => state.documentPicker?.promise ?? ({ canceled: true, assets: [] }) }, '../../lib/haptics': { hapticImpact() {} },
      '../../services/chatTypes': { generateChatId: () => 'chat-client-' + (++uuid), generateMessageId: () => 'message-' + (++uuid), generateTempTitle: x => x },
      '../../services/chatStorage': storage, '../../services/aiService': ai, '../../services/conversationActionsService': {
        generateImage: async input => { state.mediaCalls.push(input); return state.mediaGate ? state.mediaGate.promise : {} },
        generateVideo: async input => { state.mediaCalls.push(input); return state.mediaGate ? state.mediaGate.promise : {} },
        submitRunApproval: async (input, options) => { state.approvalCalls.push({ input, options }); return state.approvalGate ? state.approvalGate.promise : undefined },
      },
      '../../lib/chatMentions': { mentionToRequestBody: x => x }, '../../services/personalChatService': {
        submitPersonalTurn: async ({ conversationId }) => ({ conversationId: conversationId ?? SERVER_NEW }),
        watchPersonalExecution: (workspaceId, conversationId, onValue) => { state.runListeners.push({ workspaceId, conversationId, onValue }); return () => { state.runStops += 1 } },
      },
      '../../services/appApi': { getRequestWorkspaceId: () => state.workspaceId }, '../../hooks/useFavoriteModels': { useFavoriteModels: () => ({ favoriteIds: [], toggleFavorite() {} }) },
      '../../hooks/useAndroidKeyboardVisible': { useAndroidKeyboardVisible: () => false }, '../../lib/chatModels': { resolveAutoModel: x => x[0], sortChatModels: x => x }, '../../lib/keyboardLayout': { getComposerBottomInset: () => 0 },
      './ModelPicker': { ModelPicker: MockModelPicker }, './ChatViews': { ChatHeader: MockChatHeader, ChatSheet: p => p.children || null, EmptyPersonalChat: () => null },
      '../../lib/personalStream': { appendPersonalBlock: (blocks, chunk) => {
        const next = [...(blocks ?? [])]
        const last = next.at(-1)
        if (chunk.type === 'text') {
          if (last?.kind === 'text') next[next.length - 1] = { ...last, text: last.text + chunk.content }
          else next.push({ kind: 'text', text: chunk.content })
        } else if (chunk.type === 'tool') {
          next.push({ kind: 'tool', key: chunk.toolCallId, name: chunk.toolName, state: chunk.state, toolInput: chunk.input, toolOutput: chunk.output })
        }
        return next
      } }, '../../hooks/useTheme': { useTheme }, '../../constants/theme': { borderRadius: { lg: 8, full: 99 }, fontSize: { sm: 12, md: 16 }, spacing: { sm: 8, md: 12, lg: 16, xl: 24 } },
      './Composer': { Composer: MockComposer }, './ChatActionsSheet': { ChatActionsSheet: MockActionsSheet }, '../../services/integrationsService': {
        createSkill: async (...args) => { state.skillCalls.push(args); if (state.skillGate) await state.skillGate.promise },
      }, './DrawerSidebar': { DrawerSidebar: () => null },
      '../ui/ScreenWithDrawer': { ScreenWithDrawer: p => p.children }, '../ui/FeatureGate': { FeatureGate: () => null }, '../../contexts/DrawerContext': { useDrawer: () => ({ openDrawer() {}, drawerVisible: false }) },
      '../ui/FloatingSearchBar': { FloatingSearchBar: MockSearch }, '../ui/primitives': { ListRow: p => { state.listRows.set(p.title, p); return null }, Section: p => p.children },
      '../../contexts/AppSessionContext': { useAppSession: () => ({ chatModels: state.models, imageModels: imageModelCatalog, videoModels: videoModelCatalog, uiSettings: {}, entitlements: { tier: 'free' }, capabilities: { chat: true }, memoryEnabled: false, setMemoryEnabled() {} }) },
      '../auth/UpgradePrompt': { UpgradePrompt: () => null }, '../../contexts/AuthContext': { useAuth: () => ({ user: state.user, isAuthenticated: true, isLoading: false }) },
      '../../contexts/ConvexAuthProvider': { useNativeDataReady: () => state.nativeReady }, '../../contexts/WorkspaceContext': { useWorkspace: () => ({ activeWorkspaceId: state.workspaceId }) },
    }
    if (Object.hasOwn(mocks, request)) return mocks[request]
  }
  if (filename.endsWith('/components/chat/NativePersonalChatTranscript.tsx')) {
    const mocks = { 'expo-clipboard': { setStringAsync: async () => {} }, 'expo-crypto': { randomUUID: () => 'native-transcript-' + String(++uuid).padStart(16, '0') }, 'expo-web-browser': { openBrowserAsync: async () => {} }, '../../hooks/useTheme': { useTheme }, '../../lib/nativeTranscriptShareCache': { nativeTranscriptShareAdapters: { isAvailable: async () => false }, shareNativeTranscriptText: async () => false }, './NativeSharedTranscript.dom': MockDom, './DraftReviewSheet': { DraftReviewSheet: props => { state.draftReviewProps = props; return null } } }
    if (Object.hasOwn(mocks, request)) return mocks[request]
  }
  return originalLoad.call(this, request, parent, isMain)
}
const { ChatScreen, buildStopPartialPayload } = require('../components/chat/ChatScreen.tsx')
Module._load = originalLoad
function reset() {
  Object.assign(state, {
    workspaceId: 'workspace-a', user: { id: 'user-a' }, nativeReady: true, models: [model('model-a', 'Model A'), model('secret-model', 'Private')],
    createGate: null, createError: null, history: [],
    loads: [], pendingLoad: null, stream: null, streamArgs: null, picker: null, documentPicker: null, uploadGate: null,
    uploadCalls: [], mediaGate: null, mediaCalls: [], preferenceGate: null, modelPreferences: [], saveCalls: [], createCalls: [],
    lastOpenedWrites: [], lastOpenedGate: null, lastOpenedError: null, skillCalls: [], skillGate: null, approvalGate: null, approvalCalls: [], runListeners: [], runStops: 0,
   snapshots: [], domRenders: 0, composer: null, modelPicker: null, nativeProps: null, draftReviewProps: null, search: null, routeParams: null, globalRouteParams: null, foregroundRouteParams: null, actionsProps: null, headerProps: null,
    historyLoads: 0, replaceCalls: [],
    domProps: null, stopCalls: [], stopGate: null, personalChatListeners: [],
    focused: true, listRows: new Map(),
  })
  state.appState.clear()
  state.focusSubscriptions.clear()
}
async function mount(id) { let renderer; await act(async () => { renderer = create(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: id, routeKind: 'detail' }))); await tick() }); return renderer }
async function mountWithAutomationDraft(id, draft) {
  state.pendingLoad = conversationId => {
    const chat = fixture(conversationId)
    chat.messages[1].responses[0].toolInvocations = [{
      toolCallId: 'automation-tool', toolName: 'draft_automation_from_chat', state: 'output-available',
      toolOutput: { success: true, draft: draft.draft },
    }]
    return chat
  }
  const renderer = await mount(id)
  state.pendingLoad = () => null
  return renderer
}
async function openAutomationDraft() {
  const snapshot = state.snapshots.at(-1)
  const exchange = snapshot.view.exchanges[0]
  const response = exchange.responses[0]
  const tool = response.blocks.find(block => block.kind === 'tool' && block.name === 'draft_automation_from_chat')
  assert.ok(tool)
  await state.domProps.onAction({
    kind: 'open-draft', workspaceId: snapshot.workspaceId, conversationId: snapshot.conversationId,
    mountNonce: snapshot.mountNonce, focusNonce: snapshot.focusNonce, exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id }, toolKey: tool.key,
  })
}
test('mounted ChatScreen maps a populated personal transcript into the memoized native host', async () => {
  reset()
  const renderer = await mount(CHAT_A)
  assert.equal(renderer.root.findAllByType('TranscriptProbe').length, 1)
  const snapshot = state.snapshots.at(-1)
  assert.equal(snapshot.view.exchanges[0].responses[0].blocks.find(block => block.kind === 'text').text, 'Answer')
  assert.deepEqual(snapshot.publicModelLabels, [{ id: 'model-a', name: 'Model A' }])
  assert.equal(state.nativeProps.scrollIntent.kind, 'initial-end')
  const initialScrollIntent = state.nativeProps.scrollIntent
  await act(async () => { await tick() })
  const renders = state.domRenders
  const input = renderer.root.findByType('ComposerProbe')
  assert.equal(typeof input.props.onPickImage, 'function')
  assert.equal(typeof input.props.onPickCamera, 'function')
  assert.equal(typeof input.props.onPickFile, 'function')
  await act(async () => { input.props.onChangeInput('composer only'); await tick() })
  assert.equal(state.domRenders, renders)
  assert.equal(state.nativeProps.scrollIntent, initialScrollIntent)
  await act(async () => { state.search.onChangeText('query'); await tick() })
  assert.equal(state.snapshots.at(-1).query, 'query')
  assert.equal(state.nativeProps.scrollIntent, initialScrollIntent)
  state.models = [model('model-a', 'Model A updated'), model('secret-model', 'Private')]
  await act(async () => { renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' }))); await tick() })
  assert.equal(state.loads.length, 1)
  assert.equal(state.snapshots.at(-1).publicModelLabels[0].name, 'Model A updated')
  assert.equal(state.nativeProps.scrollIntent, initialScrollIntent)
  await act(async () => renderer.unmount())
})
test('late route and workspace hydration cannot overwrite or reveal an older mounted conversation', async () => {
  reset()
  const first = deferred(), second = deferred()
  state.pendingLoad = id => id === CHAT_A ? first.promise : second.promise
  let renderer
  await act(async () => { renderer = create(React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' })); await tick() })
  state.workspaceId = 'workspace-b'
  state.user = { id: 'user-b' }
  await act(async () => { renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_B, routeKind: 'detail' }))); await tick() })
  assert.equal(renderer.root.findAllByType('TranscriptProbe').length, 0)
  await act(async () => { second.resolve(fixture(CHAT_B)); await tick() })
  assert.equal(state.snapshots.at(-1).view.exchanges[0].turnId, CHAT_B + '-turn')
  assert.equal(state.loads.find(load => load.id === CHAT_B).workspaceId, 'workspace-b')
  await act(async () => { first.resolve(fixture(CHAT_A)); await tick() })
  assert.equal(state.snapshots.at(-1).view.exchanges[0].turnId, CHAT_B + '-turn')
  await act(async () => renderer.unmount())
})

test('new composer edits survive a failed send and a system picker result survives app backgrounding', async () => {
  reset()
  const sendGate = deferred(), pickerGate = deferred()
  state.stream = async function* () { await sendGate.promise; yield { type: 'error', content: 'Network unavailable' } }
  state.picker = pickerGate
  const renderer = await mount(CHAT_A)
  let controls = renderer.root.findByType('ComposerProbe')
  await act(async () => { controls.props.onChangeInput('captured') })
  await act(async () => { controls.props.onSend(); await tick() })
  controls = renderer.root.findByType('ComposerProbe')
  assert.equal(controls.props.value, '')
  await act(async () => { controls.props.onChangeInput('newer edit') })
  controls = renderer.root.findByType('ComposerProbe')
  let pickerResult
  await act(async () => { pickerResult = controls.props.onPickImage(); await tick() })
  await act(async () => { for (const listener of state.appState) listener('background'); for (const listener of state.appState) listener('active'); await tick() })
  await act(async () => { pickerGate.resolve({ canceled: false, assets: [{ base64: 'image-data', mimeType: 'image/png' }] }); await pickerResult })
  assert.equal(renderer.root.findByType('ComposerProbe').props.value, 'newer edit')
  assert.equal(renderer.root.findByType('ComposerProbe').props.imageBase64, 'data:image/png;base64,image-data')
  await act(async () => { sendGate.resolve(); await tick() })
  assert.equal(renderer.root.findByType('ComposerProbe').props.value, 'newer edit')
  await act(async () => renderer.unmount())
})

test('new-chat first send promotes only its own draft and stays current through route adoption', async () => {
  reset()
  const sendGate = deferred()
  state.stream = async function* () { await sendGate.promise; yield { type: 'text', content: 'Reply' } }
  const renderer = await mount('new')
  await act(async () => { state.composer.onChangeInput('first draft send'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  assert.equal(state.createCalls.length, 1)
  assert.equal(state.createCalls[0].options.workspaceId, 'workspace-a')
  assert.equal(state.createCalls[0].options.clientId.startsWith('chat-'), true)
  assert.equal(state.streamArgs[2].conversationId, SERVER_NEW)
  const signal = state.streamArgs[2].signal
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: SERVER_NEW, routeKind: 'detail' })))
    await tick()
  })
  assert.deepEqual(state.routeParams, { id: SERVER_NEW })
  assert.equal(signal.aborted, false)
  assert.equal(state.loads.length, 0, 'own promotion must not trigger a second initial hydration')
  await act(async () => { sendGate.resolve(); await tick() })
  assert.equal(state.loads.at(-1).id, SERVER_NEW)
  assert.equal(state.loads.at(-1).workspaceId, 'workspace-a')
  await act(async () => renderer.unmount())
})

test('same mounted provider rehydrates A/B/A and model catalog changes do not rehydrate', async () => {
  reset()
  const renderer = await mount(CHAT_A)
  const focusSubscription = [...state.focusSubscriptions][0]
  assert.ok(focusSubscription)
  assert.equal(state.loads.filter(load => load.id === CHAT_A).length, 1)
  const pendingB = deferred()
  state.pendingLoad = id => id === CHAT_B ? pendingB.promise : fixture(id)
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_B, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(state.focusSubscriptions.has(focusSubscription), true, 'route parameter update keeps the mounted focus owner')
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(state.loads.filter(load => load.id === CHAT_A).length, 2)
  assert.equal(state.focusSubscriptions.has(focusSubscription), true)
  assert.equal(state.nativeProps.view.exchanges[0].turnId, CHAT_A + '-turn')
  pendingB.resolve(fixture(CHAT_B))
  await act(async () => { await tick() })
  assert.equal(state.nativeProps.view.exchanges[0].turnId, CHAT_A + '-turn')
  const loadsBeforeCatalogUpdate = state.loads.length
  state.models = [model('model-a', 'Model A catalog update')]
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(state.loads.length, loadsBeforeCatalogUpdate)
  await act(async () => renderer.unmount())
})

test('stale ChatActionsSheet callbacks cannot close or mutate a later route sheet', async () => {
  reset()
  state.history = [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }]
  const renderer = await mount(CHAT_A)
  await act(async () => { state.headerProps.onOptions(); await tick() })
  await act(async () => { state.listRows.get('Conversation actions').onPress(); await tick() })
  assert.equal(state.actionsProps.chat.id, CHAT_A)
  const callbacksA = {
    close: state.actionsProps.onClose,
    changed: state.actionsProps.onChanged,
    deleted: state.actionsProps.onDeleted,
    archived: state.actionsProps.onArchived,
  }

  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_B, routeKind: 'detail' })))
    await tick()
  })
  await act(async () => { state.headerProps.onOptions(); await tick() })
  await act(async () => { state.listRows.get('Conversation actions').onPress(); await tick() })
  assert.equal(state.actionsProps.chat.id, CHAT_B)
  const closeB = state.actionsProps.onClose
  const historyLoads = state.historyLoads
  const replaceCount = state.replaceCalls.length
  await act(async () => {
    callbacksA.changed()
    callbacksA.deleted()
    callbacksA.archived()
    callbacksA.close()
    await tick()
  })
  assert.equal(state.historyLoads, historyLoads)
  assert.equal(state.replaceCalls.length, replaceCount)
  assert.equal(state.actionsProps.visible, true)
  assert.equal(state.actionsProps.chat.id, CHAT_B)
  await act(async () => { closeB(); await tick() })
  assert.equal(state.actionsProps.visible, false)
  await act(async () => renderer.unmount())
})

test('owned promotion uses bound route params and does not wait for last-opened storage', async () => {
  reset()
  const createGate = deferred(), storageGate = deferred()
  state.createGate = createGate
  state.lastOpenedGate = storageGate
  state.foregroundRouteParams = { id: 'foreground-file' }
  state.stream = async function* () {
    yield { type: 'start', metadata: { conversationId: SERVER_NEW } }
    yield { type: 'text', content: 'Promoted reply' }
  }
  const renderer = await mount('new')
  await act(async () => { state.composer.onChangeInput('first send'); await tick() })
  let send
  await act(async () => { send = state.composer.onSend(); await tick() })
  assert.equal(state.createCalls.length, 1)
  await act(async () => { setNavigationFocus(false); await tick() })
  await act(async () => { createGate.resolve(); await send; await tick() })
  assert.deepEqual(state.routeParams, { id: SERVER_NEW })
  assert.equal(state.globalRouteParams, null)
  assert.deepEqual(state.foregroundRouteParams, { id: 'foreground-file' })
  assert.equal(state.nativeProps.workspaceId, 'workspace-a')
  assert.equal(state.nativeProps.conversationId, SERVER_NEW)
  assert.equal(state.nativeProps.authorityActive, true)
  assert.equal(state.composer.isSending, false)
  assert.equal(state.loads.some(load => load.id === SERVER_NEW), true)
  assert.equal(state.lastOpenedWrites.some(write => write.id === SERVER_NEW), false)
  await act(async () => { setNavigationFocus(true); await tick() })
  assert.equal(state.lastOpenedWrites.some(write => write.id === SERVER_NEW), true)
  const focusSubscription = [...state.focusSubscriptions][0]
  const loadedCount = state.loads.length
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: SERVER_NEW, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(state.loads.length, loadedCount)
  assert.equal(state.focusSubscriptions.has(focusSubscription), true)
  assert.equal(state.nativeProps.authorityActive, true)
  storageGate.resolve()
  await act(async () => { await tick() })
  await act(async () => renderer.unmount())
})

test('hydration cache rejection leaves the loaded conversation available for sends', async () => {
  reset()
  state.lastOpenedError = new Error('storage failure')
  state.stream = async function* () { yield { type: 'text', content: 'Still sendable' } }
  const renderer = await mount(CHAT_A)
  assert.equal(state.nativeProps.view.exchanges[0].responses[0].blocks.some(block => block.kind === 'text' && block.text === 'Answer'), true)
  await act(async () => { state.composer.onChangeInput('send after cache error'); await tick() })
  await act(async () => { await state.composer.onSend(); await tick() })
  assert.ok(state.streamArgs)
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('storage failure'), false)
  await act(async () => renderer.unmount())
})

test('media and stream-start fallback promotions cannot mutate the foreground route', async () => {
  for (const path of ['media', 'start-fallback']) {
    reset()
    state.foregroundRouteParams = { id: 'foreground-file' }
    if (path === 'media') {
      state.mediaGate = { promise: Promise.resolve({ outputId: 'media-output', url: '/image.png' }) }
    } else {
      state.createError = new Error('server create unavailable')
      state.stream = async function* () {
        yield { type: 'start', metadata: { conversationId: SERVER_NEW } }
        yield { type: 'text', content: 'Fallback reply' }
      }
    }
    const renderer = await mount('new')
    await act(async () => {
      state.composer.onChangeInput(path === 'media' ? 'media prompt' : 'fallback prompt')
      if (path === 'media') state.composer.onSelectGeneration('image', 'image-model')
      await tick()
    })
    await act(async () => { await state.composer.onSend(); await tick() })
    assert.deepEqual(state.routeParams, { id: SERVER_NEW }, path)
    assert.equal(state.globalRouteParams, null, path)
    assert.deepEqual(state.foregroundRouteParams, { id: 'foreground-file' }, path)
    await act(async () => renderer.unmount())
  }
})

test('preset start promotion is route-bound and leaves another foreground entry untouched', async () => {
  reset()
  state.createError = new Error('server create unavailable')
  state.foregroundRouteParams = { id: 'foreground-file' }
  state.pendingLoad = id => {
    const chat = fixture(id)
    chat.messages[1].responses[0].toolInvocations = [{
      toolCallId: 'automation-tool', toolName: 'draft_automation_from_chat', state: 'output-available',
      toolOutput: { success: true, draft: { name: 'Weekly digest', description: 'Summarize updates', instructions: 'Collect updates', confidence: 'high', detectedIntegrations: [], missingFields: [], reason: 'Approved', schedule: { kind: 'interval', intervalMinutes: 60 }, timezone: 'UTC' } },
    }]
    return chat
  }
  state.stream = async function* () { yield { type: 'text', content: 'Draft transcript' } }
  const renderer = await mount('new')
  await act(async () => { state.composer.onChangeInput('draft-producing send'); await tick() })
  await act(async () => { await state.composer.onSend(); await tick() })
  await act(async () => { await openAutomationDraft(); await tick() })
  const draft = { kind: 'automation', draft: { name: 'Weekly digest', description: 'Summarize updates', instructions: 'Collect updates', confidence: 'high', detectedIntegrations: [], missingFields: [], reason: 'Approved', schedule: { kind: 'interval', intervalMinutes: 60 }, timezone: 'UTC' } }
  state.stream = async function* () {
    yield { type: 'start', metadata: { conversationId: SERVER_NEW } }
    yield { type: 'text', content: 'Preset accepted' }
  }
  await act(async () => { await state.draftReviewProps.onSave(draft); await tick() })
  assert.deepEqual(state.routeParams, { id: SERVER_NEW })
  assert.equal(state.globalRouteParams, null)
  assert.deepEqual(state.foregroundRouteParams, { id: 'foreground-file' })
  await act(async () => renderer.unmount())
})

test('normal stream completion clears busy, projects terminal state, and immediately permits a second send', async () => {
  reset()
  const firstReply = deferred()
  let streamCount = 0
  state.stream = async function* () {
    streamCount += 1
    if (streamCount === 1) await firstReply.promise
    yield { type: 'text', content: 'Reply ' + streamCount }
  }
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  await act(async () => { state.composer.onChangeInput('first question'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  const firstTurnId = state.nativeProps.view.exchanges.at(-1).turnId
  assert.equal(state.composer.isSending, true)
  assert.equal(state.nativeProps.scrollIntent.kind, 'submission')
  assert.equal(state.nativeProps.view.exchanges.at(-1).status, 'streaming')
  await act(async () => { firstReply.resolve(); await tick() })
  assert.equal(state.composer.isSending, false)
  assert.equal(state.nativeProps.view.exchanges.at(-1).turnId, firstTurnId)
  assert.equal(state.nativeProps.view.exchanges.at(-1).status, 'completed')
  await act(async () => { state.composer.onChangeInput('second question'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  assert.equal(streamCount, 2)
  assert.notEqual(state.nativeProps.view.exchanges.at(-1).turnId, firstTurnId)
  assert.equal(state.nativeProps.view.exchanges.at(-1).status, 'completed')
  assert.equal(state.composer.isSending, false)
  await act(async () => renderer.unmount())
})

test('failed sends restore unchanged drafts, clear busy, and hide opaque transport errors', async () => {
  reset()
  state.stream = async function* () { yield { type: 'error', content: 'xy' } }
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  await act(async () => { state.composer.onChangeInput('retry this draft'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  const failed = state.nativeProps.view.exchanges.at(-1)
  assert.equal(state.composer.isSending, false)
  assert.equal(state.composer.inputValue, 'retry this draft')
  assert.equal(failed.status, 'error')
  assert.equal(failed.responses[0].errorMessage, 'This response could not be completed.')
  assert.equal(failed.responses[0].blocks.some(block => block.kind === 'text' && block.text === 'This response could not be completed.'), false)
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('xy'), false)
  await act(async () => renderer.unmount())
})

test('opaque, bearer, JWT-shaped, and backend transport errors never reach transcript output', async () => {
  for (const raw of ['xy', 'Bearer hidden-credential-value', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature', 'backend body sentinel hidden-response']) {
    reset()
    state.stream = async function* () { yield { type: 'error', content: raw } }
    const renderer = await mount(CHAT_A)
    state.pendingLoad = () => null
    await act(async () => { state.composer.onChangeInput('sensitive failure'); await tick() })
    await act(async () => { await state.composer.onSend(); await tick() })
    const snapshot = JSON.stringify(state.snapshots.at(-1))
    assert.equal(snapshot.includes(raw), false, raw)
    const exchange = state.nativeProps.view.exchanges.find(item => item.user.text === 'sensitive failure')
    assert.equal(exchange.responses[0].errorMessage, 'This response could not be completed.')
    assert.equal(exchange.responses[0].blocks.some(block => block.kind === 'text' && block.text.includes('could not be completed')), false)
    await act(async () => renderer.unmount())
  }
})

test('completed video Reply keeps trusted prompt context without a preview adapter', async () => {
  reset()
  const prompt = 'A detailed video prompt that continues beyond the one hundred twenty character reply snippet. '.repeat(3)
  const videoGate = deferred()
  state.mediaGate = videoGate
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  await act(async () => { state.composer.onChangeInput(prompt); state.composer.onSelectGeneration('video', 'video-model'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  videoGate.resolve({ url: '/generated-video.mp4', outputId: 'ffffffffffffffffffff' })
  await act(async () => { await tick() })
  const exchange = state.nativeProps.view.exchanges.at(-1)
  const mediaResult = exchange.media.results[0]
  assert.equal(mediaResult.type, 'video')
  assert.equal(mediaResult.status, 'completed')
  assert.equal(mediaResult.outputId, 'ffffffffffffffffffff')
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('ffffffffffffffffffff'), false)
  const scrollIntentBeforeReply = state.nativeProps.scrollIntent
  const scope = { workspaceId: 'workspace-a', conversationId: CHAT_A, mountNonce: 'video-reply-mount', focusNonce: 'video-reply-focus', isCurrent: () => true }
  await act(async () => {
    state.nativeProps.onReply({
      exchange,
      target: { kind: 'media', outputId: mediaResult.outputId },
      user: exchange.user,
      response: null,
      mediaResult,
    }, scope)
    await tick()
  })
  assert.equal(state.composer.replyContext.replyToTurnId, exchange.turnId)
  assert.equal(state.composer.replyContext.snippet, prompt.slice(0, 120))
  assert.equal(state.composer.replyContext.bodyForModel, '[Prior video generation request]\n' + prompt.trim().slice(0, 12000))
  assert.equal(state.nativeProps.scrollIntent, scrollIntentBeforeReply)
  assert.ok(state.snapshots.at(-1).publicModelLabels.some(label => label.id === 'video-model' && label.name === 'Video Model'))
  await act(async () => renderer.unmount())
})

test('temporary sends finish busy state without creating a persisted conversation', async () => {
  reset()
  state.stream = async function* () { yield { type: 'text', content: 'Temporary answer' } }
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  const temporaryRow = state.listRows.get('Temporary chat')
  assert.ok(temporaryRow)
  await act(async () => { temporaryRow.onPress(); await tick() })
  assert.equal(state.composer.isTemporary, true)
  await act(async () => { state.composer.onChangeInput('temporary question'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  assert.equal(state.composer.isSending, false)
  assert.equal(state.createCalls.length, 0)
  assert.equal(state.streamArgs[2].conversationId, undefined)
  assert.equal(state.streamArgs[2].temporaryChat, true)
  assert.equal(state.nativeProps.view.exchanges.at(-1).status, 'completed')
  await act(async () => renderer.unmount())
})

test('Stop clears composer busy and terminal streaming projection immediately', async () => {
  reset()
  const responseGate = deferred()
  const partialApplied = deferred()
  const partial = 'legitimate partial response\n\n'
  state.stream = async function* () {
    yield { type: 'tool', toolCallId: 'tool-1', toolName: 'Lookup', state: 'output-available', input: { query: 'safe' }, output: { count: 1 } }
    yield { type: 'text', content: partial }
    partialApplied.resolve()
    await responseGate.promise
    yield { type: 'text', content: 'late response' }
  }
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  await act(async () => { state.composer.onChangeInput('stop me'); await tick() })
  await act(async () => { state.composer.onSend(); await partialApplied.promise; await tick() })
  assert.equal(state.composer.isSending, true)
  assert.equal(state.nativeProps.view.exchanges.at(-1).status, 'streaming')
  const turnId = state.streamArgs[2].turnId
  assert.ok(state.nativeProps.view.exchanges.at(-1).responses.some(response =>
    response.blocks.some(block => block.kind === 'text' && block.text.includes(partial)),
  ))
  await act(async () => { state.composer.onStop(); await tick() })
  assert.equal(state.composer.isSending, false)
  assert.equal(state.nativeProps.view.exchanges.at(-1).status, 'interrupted')
  assert.equal(state.stopCalls[0].options.partialContent, partial)
  assert.deepEqual(state.stopCalls[0].options.partialParts, [
    { type: 'tool-invocation', id: 'tool-1', toolInvocation: {
      toolCallId: 'tool-1', toolName: 'Lookup', state: 'output-available', toolInput: { query: 'safe' }, toolOutput: { count: 1 },
    } },
    { type: 'text', text: partial, storageOmittedParts: 0 },
  ])
  const listener = state.personalChatListeners.find(item => item.conversationId === CHAT_A && item.active)
  assert.ok(listener)
  const interruptedContent = `${partial}\n\nThis response was interrupted. Should I continue?`
  await act(async () => {
    listener.onValue({
      ...fixture(CHAT_A),
      messages: [
        { id: `${turnId}-user`, turnId, role: 'user', content: 'stop me', timestamp: 3 },
        {
          id: `${turnId}-assistant`, turnId, role: 'assistant', content: interruptedContent, timestamp: 4,
          selectedModelId: 'model-a', status: 'interrupted',
          responses: [{ id: `${turnId}-response`, modelId: 'model-a', modelName: 'Model A', provider: 'test', content: interruptedContent, isLoading: false, status: 'interrupted' }],
        },
      ],
    })
    await tick()
  })
  assert.equal(state.nativeProps.view.exchanges.at(-1).status, 'interrupted')
  assert.ok(state.nativeProps.view.exchanges.at(-1).responses.some(response =>
    response.blocks.some(block => block.kind === 'text' && block.text.includes(partial)),
  ))
  responseGate.resolve()
  await act(async () => { await tick() })
  assert.equal(state.nativeProps.view.exchanges.at(-1).status, 'interrupted')
  assert.equal(JSON.stringify(state.nativeProps.view).includes('late response'), false)
  await act(async () => renderer.unmount())
})

test('Stop does not borrow another response text or blocks before selected response text', () => {
  const otherText = 'other model aggregate text'
  const payload = buildStopPartialPayload({
    id: 'assistant', turnId: 'turn', role: 'assistant', timestamp: 1,
    content: otherText,
    selectedModelId: 'model-a',
    blocks: [{ kind: 'text', text: otherText }],
    responses: [
      { modelId: 'model-b', content: otherText, blocks: [{ kind: 'text', text: otherText }], isLoading: false },
      { modelId: 'model-a', content: '', isLoading: true },
    ],
  }, 'model-a')
  assert.deepEqual(payload, {})
})

test('Stop preserves reasoning and tool parts when selected response has no text', () => {
  const otherText = 'other model aggregate text'
  const payload = buildStopPartialPayload({
    id: 'assistant', turnId: 'turn', role: 'assistant', timestamp: 1,
    content: otherText,
    selectedModelId: 'model-a',
    blocks: [{ kind: 'text', text: otherText }],
    responses: [
      { modelId: 'model-b', content: otherText, blocks: [{ kind: 'text', text: otherText }], isLoading: false },
      { modelId: 'model-a', content: '', isLoading: true, blocks: [
        { kind: 'reasoning', key: 'reason-1', text: 'reasoning only', state: 'streaming' },
        { kind: 'tool', key: 'tool-2', name: 'Lookup', state: 'output-available', toolInput: { query: 'safe' }, toolOutput: { count: 2 } },
      ] },
    ],
  }, 'model-a')
  assert.deepEqual(payload, { partialParts: [
    { type: 'reasoning', text: 'reasoning only' },
    { type: 'tool-invocation', id: 'tool-2', toolInvocation: {
      toolCallId: 'tool-2', toolName: 'Lookup', state: 'output-available', toolInput: { query: 'safe' }, toolOutput: { count: 2 },
    } },
  ] })
})

test('Stop payload contains only the active chat partial response after a route switch', async () => {
  reset()
  const firstGate = deferred()
  const secondGate = deferred()
  state.stream = async function* () { yield { type: 'text', content: 'chat A partial' }; await firstGate.promise; yield { type: 'text', content: 'stale chat A chunk' } }
  const renderer = await mount(CHAT_A)
  await act(async () => { state.composer.onChangeInput('chat A prompt'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_B, routeKind: 'detail' })))
    await tick()
  })
  state.stream = async function* () { yield { type: 'text', content: 'chat B partial' }; await secondGate.promise }
  await act(async () => { state.composer.onChangeInput('chat B prompt'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  await act(async () => { state.composer.onStop(); await tick() })
  assert.equal(state.stopCalls[0].conversationId, CHAT_B)
  assert.equal(state.stopCalls[0].options.partialContent, 'chat B partial')
  assert.equal(JSON.stringify(state.stopCalls[0].options).includes('chat A partial'), false)
  firstGate.resolve()
  secondGate.resolve()
  await act(async () => { await tick() })
  assert.equal(JSON.stringify(state.nativeProps.view).includes('stale chat A chunk'), false)
  await act(async () => renderer.unmount())
})

test('media generation preserves real outputs and represents failure and temporary no-ID success', async () => {
  reset()
  const imageGate = deferred()
  state.mediaGate = imageGate
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  await act(async () => { state.composer.onChangeInput('make an image'); state.composer.onSelectGeneration('image', 'image-model'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  assert.equal(state.mediaCalls[0].conversationId, CHAT_A)
  assert.equal(state.composer.isSending, true)
  assert.equal(state.nativeProps.view.exchanges.at(-1).media.results[0].status, 'generating')
  imageGate.resolve({ url: '/generated-image.png', outputId: 'dddddddddddddddddddd' })
  await act(async () => { await tick() })
  assert.equal(state.composer.isSending, false)
  const completedImage = state.nativeProps.view.exchanges.at(-1)
  assert.equal(completedImage.media.results[0].outputId, 'dddddddddddddddddddd')
  assert.equal(completedImage.media.results[0].status, 'completed')
  assert.ok(state.snapshots.at(-1).publicModelLabels.some(label => label.id === 'image-model' && label.name === 'Image Model'))

  let rejectVideo
  state.mediaGate = { promise: new Promise((_, reject) => { rejectVideo = reject }) }
  await act(async () => { state.composer.onChangeInput('make a video'); state.composer.onSelectGeneration('video', 'video-model'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  assert.equal(state.mediaCalls[1].conversationId, CHAT_A)
  assert.equal(state.composer.isSending, true)
  rejectVideo(new Error('BACKEND_MEDIA_SENTINEL'))
  await act(async () => { await tick() })
  assert.equal(state.composer.isSending, false)
  assert.equal(state.composer.inputValue, 'make a video')
  const failedVideo = state.nativeProps.view.exchanges.at(-1)
  assert.equal(failedVideo.media.results[0].status, 'failed')
  assert.equal(failedVideo.media.results[0].outputId, undefined)
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('BACKEND_MEDIA_SENTINEL'), false)
  assert.ok(state.snapshots.at(-1).publicModelLabels.some(label => label.id === 'video-model' && label.name === 'Video Model'))

  state.listRows.get('Temporary chat').onPress()
  await act(async () => { await tick() })
  const temporaryGate = deferred()
  state.mediaGate = temporaryGate
  await act(async () => { state.composer.onChangeInput('temporary image'); state.composer.onSelectGeneration('image', 'image-model'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  assert.equal(state.mediaCalls[2].temporaryChat, true)
  assert.equal(state.mediaCalls[2].conversationId, undefined)
  temporaryGate.resolve({ url: '/temporary-image.png' })
  await act(async () => { await tick() })
  const temporaryResult = state.nativeProps.view.exchanges.at(-1).media.results[0]
  assert.equal(temporaryResult.type, 'image')
  assert.equal(temporaryResult.status, 'completed')
  assert.equal(temporaryResult.outputId, undefined)
  assert.equal(state.composer.isSending, false)
  await act(async () => renderer.unmount())
})

test('delayed media completion cannot write into a replacement workspace or route', async () => {
  reset()
  const mediaGate = deferred()
  state.mediaGate = mediaGate
  const renderer = await mount(CHAT_A)
  await act(async () => { state.composer.onChangeInput('stale image'); state.composer.onSelectGeneration('image', 'image-model'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  const signal = state.mediaCalls[0].signal
  state.pendingLoad = id => fixture(id)
  state.workspaceId = 'workspace-b'
  state.user = { id: 'user-b' }
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_B, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(signal.aborted, true)
  mediaGate.resolve({ url: '/stale.png', outputId: 'eeeeeeeeeeeeeeeeeeee' })
  await act(async () => { await tick() })
  assert.equal(state.snapshots.at(-1).view.exchanges[0].turnId, CHAT_B + '-turn')
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('stale image'), false)
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('eeeeeeeeeeeeeeeeeeee'), false)
  await act(async () => renderer.unmount())
})

test('saved execution subscriptions cannot publish after host teardown', async () => {
  reset()
  const renderer = await mount(CHAT_A)
  const listener = state.runListeners.find(item => item.conversationId === CHAT_A)
  assert.ok(listener)
  const rendersBeforeUnmount = state.snapshots.length
  await act(async () => renderer.unmount())
  assert.ok(state.runStops > 0)
  listener.onValue({ id: 'late-run', conversationId: CHAT_A, status: 'completed' })
  await tick()
  assert.equal(state.snapshots.length, rendersBeforeUnmount)
})

test('stale model selection and document upload remain bound to their originating workspace', async () => {
  reset()
  state.models.push(model('model-b', 'Model B'))
  state.preferenceGate = deferred()
  state.uploadGate = deferred()
  state.documentPicker = { promise: Promise.resolve({ canceled: false, assets: [{ uri: 'file:///selected.txt', name: 'selected.txt', mimeType: 'text/plain' }] }) }
  const renderer = await mount(CHAT_A)
  const staleModelSelect = state.modelPicker.onSelect
  await act(async () => { staleModelSelect('text', 'model-b'); await tick() })
  await act(async () => { state.composer.onPickFile(); await tick() })
  assert.equal(state.modelPreferences[0].workspaceId, 'workspace-a')
  assert.equal(state.uploadCalls[0].options.workspaceId, 'workspace-a')
  const uploadSignal = state.uploadCalls[0].options.signal
  state.workspaceId = 'workspace-b'
  state.user = { id: 'user-b' }
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_B, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(uploadSignal.aborted, true)
  state.preferenceGate.resolve()
  state.uploadGate.resolve({ ids: ['file-stale'], name: 'selected.txt' })
  await act(async () => { await tick() })
  assert.equal(state.modelPicker.selectedId, 'model-a')
  assert.equal(state.composer.pendingDocuments.length, 0)
  assert.equal(state.saveCalls.some(call => call.chat.modelId === 'model-b'), false)
  await act(async () => renderer.unmount())
})

test('readiness recovery rejects stale hydration and preserves a same-owner composer draft', async () => {
  reset()
  const firstLoad = deferred()
  const secondLoad = deferred()
  let loadCount = 0
  state.pendingLoad = () => {
    loadCount += 1
    if (loadCount === 1) return firstLoad.promise
    if (loadCount === 2) return secondLoad.promise
    return fixture(CHAT_A)
  }
  let renderer
  await act(async () => {
    renderer = create(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(state.loads.length, 1)
  state.nativeReady = false
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' })))
    await tick()
  })
  state.nativeReady = true
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(state.loads.length, 2)
  const stale = fixture(CHAT_A)
  stale.messages[1].content = 'STALE hydration result'
  stale.messages[1].responses[0].content = 'STALE hydration result'
  firstLoad.resolve(stale)
  await act(async () => { await tick() })
  secondLoad.resolve(fixture(CHAT_A))
  await act(async () => { await tick() })
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('STALE hydration result'), false)
  await act(async () => { state.composer.onChangeInput('same-owner readiness draft'); await tick() })
  state.uploadGate = deferred()
  state.documentPicker = { promise: Promise.resolve({ canceled: false, assets: [{ uri: 'file:///readiness.txt', name: 'readiness.txt', mimeType: 'text/plain' }] }) }
  await act(async () => { state.composer.onPickFile(); await tick() })
  const uploadSignal = state.uploadCalls[0].options.signal
  assert.equal(state.composer.pendingDocuments.some(document => document.status === 'uploading'), true)
  state.nativeReady = false
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' })))
    await tick()
  })
  state.nativeReady = true
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(state.composer.inputValue, 'same-owner readiness draft')
  assert.equal(uploadSignal.aborted, true)
  assert.equal(state.composer.pendingDocuments.some(document => document.status === 'uploading'), false)
  assert.equal(state.loads.length, 3)
  state.uploadGate.resolve({ ids: ['readiness-stale'], name: 'readiness.txt' })
  await act(async () => { await tick() })
  assert.equal(state.composer.pendingDocuments.length, 0)
  await act(async () => renderer.unmount())
})

test('StrictMode initialization replay remains recoverable', async () => {
  reset()
  let renderer
  await act(async () => {
    renderer = create(React.createElement(React.StrictMode, null,
      React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue },
        React.createElement(ChatScreen, { conversationId: CHAT_A, routeKind: 'detail' }))))
    await tick()
  })
  assert.equal(renderer.root.findAllByType('ComposerProbe').length, 1)
  assert.equal(state.loads.length >= 1, true)
  await act(async () => renderer.unmount())
})

test('approval callbacks cannot update a replacement workspace', async () => {
  reset()
  state.approvalGate = deferred()
  const renderer = await mount(CHAT_A)
  const listener = state.runListeners.find(item => item.conversationId === CHAT_A)
  assert.ok(listener)
  await act(async () => {
    listener.onValue({
      id: 'run-a', conversationId: CHAT_A, turnId: CHAT_A + '-turn', status: 'waiting_for_approval',
      approval: { token: 'private-approval-token', requests: [{ toolCallId: 'tool-a', toolName: 'Write' }] },
    })
    await tick()
  })
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('private-approval-token'), false)
  const approve = renderer.root.findAllByType('TouchableOpacity').find(node =>
    node.findAllByType('Text').some(child => child.props.children === 'Approve'))
  assert.ok(approve)
  await act(async () => { approve.props.onPress(); await tick() })
  assert.equal(state.approvalCalls[0].options.workspaceId, 'workspace-a')
  const approvalSignal = state.approvalCalls[0].options.signal
  state.workspaceId = 'workspace-b'
  state.user = { id: 'user-b' }
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_B, routeKind: 'detail' })))
    await tick()
  })
  assert.equal(approvalSignal.aborted, true)
  state.approvalGate.resolve()
  await act(async () => { await tick() })
  assert.equal(state.snapshots.at(-1).view.exchanges[0].turnId, CHAT_B + '-turn')
  await act(async () => renderer.unmount())
})

test('same-chat stream data survives navigation blur and focus returns to a usable composer', async () => {
 reset()
 const streamGate = deferred()
  const finishGate = deferred()
 let yielded = false
  state.stream = async function* () { await streamGate.promise; yielded = true; yield { type: 'text', content: 'Background result' }; await finishGate.promise }
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  await act(async () => { state.composer.onChangeInput('continue in background'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  const signal = state.streamArgs[2].signal
  assert.equal(signal.aborted, false)
 assert.equal(state.composer.isSending, true)
 await act(async () => { setNavigationFocus(false); await tick() })
  assert.equal(signal.aborted, false, 'navigation blur must not cancel same-chat data work')
  await act(async () => { streamGate.resolve(); await tick() })
  assert.equal(yielded, true)
  assert.equal(state.composer.isSending, true)
  await act(async () => { finishGate.resolve(); await tick() })
  assert.equal(state.composer.isSending, false)
  await act(async () => { setNavigationFocus(true); await tick() })
  assert.equal(state.composer.isSending, false)
  assert.equal(JSON.stringify(state.nativeProps.view).includes('Background result'), true)
  await act(async () => renderer.unmount())
})

test('blur cancels in-flight uploads and removes their transient busy state', async () => {
  reset()
  state.uploadGate = deferred()
  state.documentPicker = { promise: Promise.resolve({ canceled: false, assets: [{ uri: 'file:///blur.txt', name: 'blur.txt', mimeType: 'text/plain' }] }) }
  const renderer = await mount(CHAT_A)
  await act(async () => { state.composer.onPickFile(); await tick() })
  assert.equal(state.composer.pendingDocuments.some(document => document.status === 'uploading'), true)
  const signal = state.uploadCalls[0].options.signal
  await act(async () => { setNavigationFocus(false); await tick() })
  assert.equal(signal.aborted, true)
  assert.equal(state.composer.pendingDocuments.some(document => document.status === 'uploading'), false)
  state.uploadGate.resolve({ ids: ['stale-upload'], name: 'blur.txt' })
  await act(async () => { await tick() })
  assert.equal(state.composer.pendingDocuments.length, 0)
  await act(async () => renderer.unmount())
})

test('Stop cancels an accepted preset, waits for server Stop, ignores late chunks, then permits a new send', async () => {
  reset()
  const streamGate = deferred()
  state.stopGate = deferred()
  state.stream = async function* () { yield { type: 'start', metadata: { conversationId: CHAT_A } }; await streamGate.promise; yield { type: 'text', content: 'late preset chunk' } }
  const draft = { kind: 'automation', draft: { name: 'Weekly digest', description: 'Summarize updates', instructions: 'Collect updates', confidence: 'high', detectedIntegrations: [], missingFields: [], reason: 'Approved', schedule: { kind: 'interval', intervalMinutes: 60 }, timezone: 'UTC' } }
  const renderer = await mountWithAutomationDraft(CHAT_A, draft)
  await act(async () => { await openAutomationDraft(); await tick() })
  await act(async () => { state.draftReviewProps.onSave(draft); await tick() })
  assert.equal(state.draftReviewProps.state, null)
  const acceptedArgs = state.streamArgs
  await act(async () => { state.composer.onStop(); await tick() })
  assert.equal(state.stopCalls[0].conversationId, CHAT_A)
  assert.equal(state.stopCalls[0].messageId, undefined)
  assert.equal(state.composer.isSending, false)
  const stopped = state.nativeProps.view.exchanges.find(exchange => exchange.status === 'interrupted')
  assert.ok(stopped)
  state.composer.onChangeInput('next text')
  await act(async () => { await state.composer.onSend(); await tick() })
  assert.equal(state.streamArgs, acceptedArgs, 'a newer submission waits for conversation-wide Stop')
  state.stopGate.resolve()
  await act(async () => { await tick() })
  state.stream = async function* () { yield { type: 'text', content: 'next send completed' } }
  await act(async () => { await state.composer.onSend(); await tick() })
  assert.notEqual(state.streamArgs, acceptedArgs)
  streamGate.resolve()
  await act(async () => { await tick() })
  assert.equal(JSON.stringify(state.nativeProps.view).includes('late preset chunk'), false)
  await act(async () => renderer.unmount())
})

test('Stop uses a matching real assistant message ID and does not lock a newer send', async () => {
  reset()
  const streamGate = deferred()
  state.stopGate = deferred()
  state.stream = async function* () {
    yield { type: 'start', metadata: { conversationId: CHAT_A } }
    await streamGate.promise
    yield { type: 'text', content: 'stale stopped chunk' }
  }
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  await act(async () => { state.composer.onChangeInput('first stream'); await tick() })
  await act(async () => { state.composer.onSend(); await tick() })
  const firstArgs = state.streamArgs
  const turnId = firstArgs[2].turnId
  const listener = state.runListeners.find(item => item.conversationId === CHAT_A)
  assert.ok(listener)
  await act(async () => {
    listener.onValue({ id: 'run-real-id', conversationId: CHAT_A, turnId, assistantMessageId: 'ffffffffffffffffffff', status: 'running' })
    await tick()
  })
  await act(async () => { state.composer.onStop(); await tick() })
  assert.equal(state.stopCalls[0].messageId, 'ffffffffffffffffffff')
  state.stream = async function* () { yield { type: 'text', content: 'next send' } }
  await act(async () => { state.composer.onChangeInput('second stream'); await tick() })
  await act(async () => { await state.composer.onSend(); await tick() })
  assert.notEqual(state.streamArgs, firstArgs)
  assert.equal(state.composer.isSending, false)
  streamGate.resolve()
  state.stopGate.resolve()
  await act(async () => { await tick() })
  assert.equal(JSON.stringify(state.nativeProps.view).includes('stale stopped chunk'), false)
  await act(async () => renderer.unmount())
})

test('failed media exact retry replaces its optimistic turn and user message', async () => {
  reset()
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  let rejectMedia
  state.mediaGate = { promise: new Promise((_, reject) => { rejectMedia = reject }) }
  await act(async () => {
    state.composer.onChangeInput('retry same image')
    state.composer.onSelectGeneration('image', 'image-model')
    await tick()
  })
  await act(async () => { state.composer.onSend(); await tick() })
  assert.equal(state.mediaCalls.length, 1)
  rejectMedia(new Error('generation failed'))
  await act(async () => { await tick() })
  const failed = state.nativeProps.view.exchanges.find(exchange => exchange.user.text === 'retry same image')
  assert.ok(failed)
  assert.equal(failed.media.results[0].status, 'failed')
  const failedTurnId = failed.turnId
  const failedUserId = failed.user.id
  const failedRequestTurnId = state.mediaCalls[0].turnId
  state.mediaGate = { promise: Promise.resolve({ outputId: 'retry-output', url: '/retry.png' }) }
  await act(async () => { await state.composer.onSend(); await tick() })
  const retried = state.nativeProps.view.exchanges.filter(exchange => exchange.user.text === 'retry same image')
  assert.equal(retried.length, 1)
  assert.equal(retried[0].turnId, failedTurnId)
  assert.equal(retried[0].user.id, failedUserId)
  assert.equal(state.mediaCalls[1].turnId, failedRequestTurnId)
  assert.equal(retried[0].media.results[0].status, 'completed')
  assert.equal(state.composer.isSending, false)
  await act(async () => renderer.unmount())
})

test('media Stop ignores a late result and refresh ownership protects the next text send', async () => {
  reset()
  const mediaGate = deferred()
  state.mediaGate = mediaGate
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  let mediaSend
  await act(async () => { state.composer.onChangeInput('stoppable image'); state.composer.onSelectGeneration('image', 'image-model'); await tick() })
  await act(async () => { mediaSend = state.composer.onSend(); await tick() })
  assert.equal(state.mediaCalls.length, 1)
  await act(async () => { state.composer.onStop(); await tick() })
  const stopped = state.nativeProps.view.exchanges.find(exchange => exchange.user.text === 'stoppable image')
  assert.equal(stopped.media.results[0].status, 'failed')
  assert.equal(stopped.media.results[0].outputId, undefined)
  mediaGate.resolve({ url: 'https://example.test/late.png', outputId: 'late-output' })
  await act(async () => { await mediaSend; await tick() })
  assert.equal(JSON.stringify(state.nativeProps.view).includes('late.png'), false)

  const refreshGate = deferred()
  const nextMedia = deferred()
  state.mediaGate = nextMedia
  let refreshSend
  await act(async () => { state.composer.onChangeInput('media A'); state.composer.onSelectGeneration('image', 'image-model'); await tick() })
  await act(async () => { refreshSend = state.composer.onSend(); await tick() })
  state.pendingLoad = () => refreshGate.promise
  nextMedia.resolve({ url: 'https://example.test/media-a.png', outputId: 'media-a-output' })
  await act(async () => { await tick() })
  await act(async () => { state.composer.onChangeInput('text B'); await tick() })
  await act(async () => { await state.composer.onSend(); await tick() })
  assert.equal(state.streamArgs, null, 'text B cannot start while media A refresh is pending')
  const stale = fixture(CHAT_A); stale.messages[1].content = 'stale media refresh'
  refreshGate.resolve(stale)
  await act(async () => { await refreshSend; await tick() })
  state.pendingLoad = () => null
  state.stream = async function* () { yield { type: 'text', content: 'text B completed' } }
  await act(async () => { await state.composer.onSend(); await tick() })
  assert.ok(state.streamArgs, `follow-up send did not start: ${JSON.stringify({ input: state.composer.inputValue, isSending: state.composer.isSending })}`)
  assert.ok(JSON.stringify(state.nativeProps.view).includes('text B completed'))

  const finalMedia = deferred()
  state.mediaGate = finalMedia
  state.pendingLoad = () => Promise.reject(new Error('refresh unavailable'))
  let rejectedRefreshSend
  await act(async () => { state.composer.onChangeInput('media refresh failure'); state.composer.onSelectGeneration('image', 'image-model'); await tick() })
  await act(async () => { rejectedRefreshSend = state.composer.onSend(); await tick() })
  finalMedia.resolve({ url: 'https://example.test/success.png', outputId: 'success-output' })
  await act(async () => { await rejectedRefreshSend; await tick() })
  const completed = state.nativeProps.view.exchanges.find(exchange => exchange.user.text === 'media refresh failure')
  assert.equal(completed.media.results[0].status, 'completed')
  assert.equal(state.composer.isSending, false)
  state.pendingLoad = () => null
  state.stream = async function* () { yield { type: 'text', content: 'controls still work' } }
  await act(async () => { state.composer.onChangeInput('followup'); await tick() })
  await act(async () => { await state.composer.onSend(); await tick() })
  assert.ok(JSON.stringify(state.nativeProps.view).includes('controls still work'))
  await act(async () => renderer.unmount())
})

test('accepted automation Draft handoff releases Save while native approval stays reachable', async () => {
  reset()
  const streamGate = deferred()
  state.stream = async function* () {
    yield { type: 'start', metadata: { conversationId: CHAT_A } }
    await streamGate.promise
    yield { type: 'text', content: 'Automation completed' }
  }
  const draft = {
    kind: 'automation',
    draft: {
      name: 'Weekly digest', description: 'Summarize updates', instructions: 'Collect the current updates',
      confidence: 'high', detectedIntegrations: [], missingFields: [], reason: 'User approved',
      schedule: { kind: 'interval', intervalMinutes: 60 }, timezone: 'UTC',
   },
  }
  const renderer = await mountWithAutomationDraft(CHAT_A, draft)
  await act(async () => { await openAutomationDraft(); await tick() })
  assert.equal(state.draftReviewProps.state.kind, 'automation')
  await act(async () => { state.draftReviewProps.onSave(draft); await tick() })
  assert.equal(state.draftReviewProps.state, null, 'Draft Review closes on accepted handoff before approval is shown')
  assert.equal(state.composer.isSending, true, 'accepted stream continues in the background')
  const listener = state.runListeners.find(item => item.conversationId === CHAT_A)
  assert.ok(listener)
  await act(async () => {
    listener.onValue({
      id: 'run-waiting', conversationId: CHAT_A, turnId: CHAT_A + '-turn', status: 'waiting_for_approval',
      approval: { token: 'private-approval-token', requests: [{ toolCallId: 'tool-a', toolName: 'Write' }] },
    })
    await tick()
  })
  assert.ok(renderer.root.findAllByType('TouchableOpacity').some(node =>
    node.findAllByType('Text').some(child => child.props.children === 'Approve')))
  assert.equal(JSON.stringify(state.snapshots.at(-1)).includes('private-approval-token'), false)
  streamGate.resolve()
  await act(async () => { await tick() })
  assert.equal(state.composer.isSending, false)
  await act(async () => renderer.unmount())
})

test('automation Draft failure is retryable and preset sends preserve the unrelated composer', async () => {
  reset()
  const draft = {
    kind: 'automation',
    draft: {
      name: 'Weekly digest', description: 'Summarize updates', instructions: 'Collect the current updates',
      confidence: 'high', detectedIntegrations: [], missingFields: [], reason: 'User approved',
      schedule: { kind: 'interval', intervalMinutes: 60 }, timezone: 'UTC',
    },
  }
  const renderer = await mount(CHAT_A)
  state.pendingLoad = () => null
  state.picker = { promise: Promise.resolve({ canceled: false, assets: [{ base64: 'image-data', mimeType: 'image/png' }] }) }
  state.documentPicker = { promise: Promise.resolve({ canceled: false, assets: [{ uri: 'file:///extra.txt', name: 'extra.txt', mimeType: 'text/plain' }] }) }
  await act(async () => {
    state.composer.onChangeInput('unrelated composer text')
    state.composer.onAddMention({ type: 'file', id: 'file-mention', name: 'Mentioned file' })
    state.composer.onChangeRequestMode('automate')
    state.composer.onSelectGeneration('image', 'image-model')
    state.composer.onPickImage()
    state.composer.onPickFile()
    await tick()
  })
  const exchange = state.snapshots.at(-1).view.exchanges[0]
  const scope = { workspaceId: 'workspace-a', conversationId: CHAT_A, mountNonce: 'test-mount', focusNonce: 'test-focus', isCurrent: () => true }
  await act(async () => {
    state.nativeProps.onReply({ exchange, target: { kind: 'user', userId: exchange.user.id }, user: exchange.user, response: null, mediaResult: null }, scope)
    await tick()
  })
  state.stream = async function* () { yield { type: 'error', content: 'Network unavailable' } }
  const staleSave = state.nativeProps.onSaveDraft
  await act(async () => { await assert.rejects(staleSave(draft, scope)); await tick() })
  const firstRequest = state.streamArgs
  const firstTurnId = firstRequest[2].turnId
  const firstPresetExchange = state.nativeProps.view.exchanges.find(exchange => exchange.user.text.includes('Create an automation from this approved draft: Weekly digest'))
  assert.ok(firstPresetExchange)
  const firstUserMessageId = firstPresetExchange.user.id
  assert.equal(state.composer.isSending, false)
  assert.equal(firstPresetExchange.status, 'error')
  assert.equal(firstPresetExchange.responses[0].status, 'error')
  assert.equal(firstRequest[2].workspaceId, 'workspace-a')
  assert.equal(JSON.stringify(firstRequest[1]).includes('Create an automation from this approved draft: Weekly digest'), true)
  assert.equal(JSON.stringify(firstRequest[1]).includes('unrelated composer text'), false)
  assert.equal(state.composer.inputValue, 'unrelated composer text')
  assert.equal(state.composer.imageBase64, 'data:image/png;base64,image-data')
  assert.equal(state.composer.pendingDocuments[0].status, 'ready')
  assert.equal(state.composer.mentions[0].id, 'file-mention')
  assert.equal(state.composer.replyContext.replyToTurnId, exchange.turnId)
  assert.equal(state.composer.generationKind, 'image')
  assert.equal(state.composer.requestMode, 'automate')

  state.stream = async function* () { yield { type: 'text', content: 'Created' } }
  await act(async () => { await state.nativeProps.onSaveDraft(draft, scope); await tick() })
  assert.equal(state.streamArgs[2].turnId, firstTurnId)
  const retriedPresetExchanges = state.nativeProps.view.exchanges.filter(exchange => exchange.user.text.includes('Create an automation from this approved draft: Weekly digest'))
  assert.equal(retriedPresetExchanges.length, 1)
  assert.equal(retriedPresetExchanges[0].turnId, firstTurnId)
  assert.equal(retriedPresetExchanges[0].user.id, firstUserMessageId)
  assert.equal(retriedPresetExchanges[0].status, 'completed')
  assert.equal(state.composer.isSending, false)
  assert.equal(state.composer.inputValue, 'unrelated composer text')
  assert.equal(state.composer.imageBase64, 'data:image/png;base64,image-data')
  assert.equal(state.composer.pendingDocuments[0].status, 'ready')
  assert.equal(state.composer.mentions[0].id, 'file-mention')
  assert.equal(state.composer.replyContext.replyToTurnId, exchange.turnId)
  assert.equal(state.composer.generationKind, 'image')
  assert.equal(state.composer.requestMode, 'automate')

  const requestBeforeStaleSave = state.streamArgs
  state.workspaceId = 'workspace-b'
  await act(async () => {
    renderer.update(React.createElement(ThemeContext.Provider, { value: ThemeContext._currentValue }, React.createElement(ChatScreen, { conversationId: CHAT_B, routeKind: 'detail' })))
    await tick()
  })
  await assert.rejects(staleSave(draft, scope))
  assert.equal(state.streamArgs, requestBeforeStaleSave)
  await act(async () => renderer.unmount())
})
