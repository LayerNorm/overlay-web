/* eslint-disable @typescript-eslint/no-require-imports */
require('./register-native-transcript-test-runtime.cjs')
require('tsx/cjs')

const assert = require('node:assert/strict')
const Module = require('node:module')
const test = require('node:test')
const vm = require('node:vm')
const React = require('../../../node_modules/react')
const { act, create } = require('../../../node_modules/react-test-renderer')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let focusEffect = null
let focusCleanup = null
let navigationFocused = false
let lastTranscriptProps = null
let lastDraftProps = null
let uuidSequence = 0
let clipboardDeferred = null
let availabilityDeferred = null
let availabilityValue = true
let shareQueue = []
let appStateListeners = new Set()
let activeTree = null
const clipboardCalls = []
const externalLinks = []
const keyboardDismissals = []
const routeCalls = []
const shareCalls = []
let transcriptMounts = 0
let transcriptUnmounts = 0
let transcriptRenders = 0
const theme = { background: '#202124', foreground: '#f5f5f5', text: '#f5f5f5', textSecondary: '#b0b5bb' }
const router = { push: (route) => routeCalls.push(route) }
const projectionScope = { workspaceId: 'workspace-1', conversationId: 'conversation-1', mountNonce: 'mount-1', focusNonce: 'focus-1' }

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function useFocusEffect(callback) {
  React.useEffect(() => {
    focusEffect = callback
    if (navigationFocused) focusCleanup = callback()
    return () => {
      const cleanup = focusCleanup
      focusCleanup = null
      cleanup?.()
      if (focusEffect === callback) focusEffect = null
    }
  }, [callback])
}

function MockNativeSharedTranscript(props) {
  transcriptRenders += 1
  lastTranscriptProps = props
  React.useEffect(() => {
    transcriptMounts += 1
    return () => { transcriptUnmounts += 1 }
  }, [])
  return React.createElement('NativeSharedTranscript', { focusNonce: props.snapshot.focusNonce })
}

function MockDraftReviewSheet(props) {
  lastDraftProps = props
  return props.state ? React.createElement('DraftReviewSheet', { saving: props.saving, saveError: props.saveError }) : null
}

const files = new Map()
const directories = new Map()
class MockFile {
  constructor(directory, name) {
    this.directory = directory
    this.name = name
    this.uri = `${directory.uri}/${name}`
    this.contents = ''
  }
  create() { files.set(this.uri, this) }
  write(contents) { this.contents = contents }
  delete() { this.deleted = true; files.delete(this.uri) }
}
class MockDirectory {
  constructor(parent, name) {
    this.parent = parent
    this.name = name
    this.uri = name ? `${parent.uri}/${name}` : parent
  }
  create() { directories.set(this.uri, this) }
  list() {
    return [...directories.values()].filter((entry) => entry.parent?.uri === this.uri).map((entry) => ({ name: entry.name, delete: () => entry.delete() }))
  }
  createArtifactDirectory(name) { return new MockDirectory(this, name) }
  createFile(name) { return new MockFile(this, name) }
  delete() {
    directories.delete(this.uri)
    for (const [uri] of files) if (uri.startsWith(`${this.uri}/`)) files.delete(uri)
  }
}
const cacheDirectory = { uri: 'file:///cache' }
const appState = {
  currentState: 'active',
  addEventListener: (_event, listener) => {
    appStateListeners.add(listener)
    return { remove: () => appStateListeners.delete(listener) }
  },
}
const reactNative = {
  ActivityIndicator: 'ActivityIndicator',
  AppState: appState,
  Keyboard: { dismiss: () => keyboardDismissals.push(true) },
  Linking: { openURL: async (url) => externalLinks.push(url) },
  StyleSheet: { absoluteFillObject: { position: 'absolute' }, create: (styles) => styles },
  Text: 'Text',
  View: 'View',
}
const expoClipboard = {
  setStringAsync: (value) => {
    clipboardCalls.push(value)
    const pending = clipboardDeferred
    clipboardDeferred = null
    return pending?.promise ?? Promise.resolve()
  },
}
const expoSharing = {
  isAvailableAsync: () => {
    if (availabilityDeferred) {
      const pending = availabilityDeferred
      availabilityDeferred = null
      return pending.promise
    }
    return Promise.resolve(availabilityValue)
  },
  shareAsync: (uri) => {
    shareCalls.push(uri)
    const pending = shareQueue.shift()
    return pending ?? Promise.resolve()
  },
}
const expoWebBrowser = { openBrowserAsync: async (url) => externalLinks.push(url) }
const expoCrypto = {
  randomUUID: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`,
}
const expoFileSystem = { Directory: MockDirectory, File: MockFile, Paths: { cache: cacheDirectory } }

const originalLoad = Module._load
Module._load = function loadNativeHostMocks(request, parent, isMain) {
  if (request === 'react-native') return reactNative
  if (request === 'expo-router') return { useFocusEffect, useRouter: () => router }
  if (request === 'expo-clipboard') return expoClipboard
  if (request === 'expo-crypto') return expoCrypto
  if (request === 'expo-file-system') return expoFileSystem
  if (request === 'expo-sharing') return expoSharing
  if (request === 'expo-web-browser') return expoWebBrowser
  if (request === 'react' && parent?.filename.endsWith('/NativePersonalChatTranscript.tsx')) return React
  if (request === 'react/jsx-runtime' && parent?.filename.endsWith('/NativePersonalChatTranscript.tsx')) return require('../../../node_modules/react/jsx-runtime')
  if (parent?.filename.endsWith('/NativePersonalChatTranscript.tsx')) {
    if (request === '../../hooks/useTheme') return { useTheme: () => ({ theme, isDark: true }) }
    if (request === './DraftReviewSheet') return { DraftReviewSheet: MockDraftReviewSheet }
    if (request === './NativeSharedTranscript.dom') return { __esModule: true, default: MockNativeSharedTranscript }
  }
  return originalLoad.call(this, request, parent, isMain)
}

let NativePersonalChatTranscript
let NativeTranscriptResourceRegistry
let createNativeTranscriptDomSnapshot
let shareNativeTranscriptText
let NATIVE_TRANSCRIPT_SHARE_RETENTION_MS
let NATIVE_TRANSCRIPT_SHARE_MAX_FILES
try {
  ({ NativePersonalChatTranscript } = require('../components/chat/NativePersonalChatTranscript.tsx'))
  ;({ NativeTranscriptResourceRegistry } = require('../lib/nativeTranscriptResources.ts'))
  ;({ createNativeTranscriptDomSnapshot } = require('../lib/nativeChatTranscriptProjection.ts'))
  ;({ shareNativeTranscriptText, NATIVE_TRANSCRIPT_SHARE_RETENTION_MS, NATIVE_TRANSCRIPT_SHARE_MAX_FILES } = require('../lib/nativeTranscriptShareCache.ts'))
} finally {
  Module._load = originalLoad
}

const draft = {
  name: 'Safe skill', description: 'Description', instructions: 'Do this', confidence: 'high',
  detectedIntegrations: [], reason: 'A synthetic draft',
}

function makeView({ resources = true, source = true, citations = true, draftTool = true } = {}) {
  const response = {
    id: 'response-1', modelId: 'model-1', status: 'completed', errorMessage: null,
    blocks: draftTool ? [{ kind: 'tool', key: 'tool-key-1', name: 'draft_skill_from_chat', state: 'output-available', toolOutput: { success: true, draft } }] : [],
    sources: source ? [
      { id: 'source-url', sourceKind: 'url', sourceId: 'url-source', url: 'https://example.org/guide', originIndex: 0 },
      { id: 'source-document', sourceKind: 'document', sourceId: 'file-2', filename: 'Guide', title: 'Guide', originIndex: 1 },
    ] : [],
    sourceCitations: citations ? {
      0: { kind: 'file', sourceId: 'file-3', title: 'Cited file' },
      1: { kind: 'memory', sourceId: 'memory-1', title: 'Memory' },
    } : {},
  }
  return {
    version: 1,
    exchanges: [{
      id: 'exchange-1', turnId: 'turn-1', index: 0, mode: 'act', generationMode: 'text',
      user: {
        id: 'user-1', text: 'Synthetic request', documentNames: [],
        indexedAttachments: resources ? [{ name: 'Report', fileIds: ['file-1'] }] : [],
        images: [], mentions: [], replyThread: { replyToTurnId: 'parent-turn' },
      },
      responses: [response], selectedResponseIndex: 0, selectedModelId: 'model-1', status: 'completed',
      media: resources ? { kind: 'image', results: [{ type: 'image', status: 'completed', outputId: 'output-1', url: 'https://example.org/generated.png' }] } : null,
    }, {
      id: 'parent-exchange', turnId: 'parent-turn', index: 1, mode: 'chat', generationMode: 'text',
      user: { id: 'parent-user', text: 'Parent', documentNames: [], indexedAttachments: [], images: [], mentions: [], replyThread: null },
      responses: [], selectedResponseIndex: 0, selectedModelId: null, status: 'completed', media: null,
    }],
  }
}

const defaultProps = (overrides = {}) => ({
  view: makeView(), workspaceId: 'workspace-1', conversationId: 'conversation-1', query: '', scrollIntent: null,
  authorityActive: true,
  publicModelLabels: [{ id: 'model-1', name: 'Public model' }],
  onReply: async () => {}, onJumpToReply: async () => {}, onSaveDraft: async () => {},
  ...overrides,
})

function Harness({ show = true, props = defaultProps() }) {
  return show ? React.createElement(NativePersonalChatTranscript, props) : React.createElement('OtherMode')
}

function scopeFrom(snapshot) {
  return { workspaceId: snapshot.workspaceId, conversationId: snapshot.conversationId, mountNonce: snapshot.mountNonce, focusNonce: snapshot.focusNonce }
}

function action(snapshot, kind, fields = {}) {
  const exchange = snapshot.view.exchanges[0]
  const base = { ...scopeFrom(snapshot), exchangeId: exchange.id, kind, ...fields }
  if (kind === 'keyboard-dismiss') return { ...scopeFrom(snapshot), kind, intent: 'user-drag' }
  if (kind === 'copy' || kind === 'open-link' || kind === 'reply' || kind === 'jump-to-reply') return { ...base, target: { kind: 'user', userId: exchange.user.id } }
  if (kind === 'open-asset') return base
  return { ...base, target: { kind: 'response', responseId: exchange.responses[0].id } }
}

function loadingVisible(tree) {
  return tree.root.findAllByType('Text').some((node) => node.children.join('') === 'Loading conversation…')
}

function coverVisible(tree) {
  return tree.root.findAllByType('View').some((node) => node.props.pointerEvents === 'auto')
}

test('citation registry, projection, and host share bounded own-data numeric entries', async () => {
  const { getNativeTranscriptCitationEntries } = require('../lib/nativeTranscriptCitations.ts')
  let getterReads = 0
  const citations = vm.runInNewContext(`({
    '0': { kind: 'file', sourceId: 'file-3', title: 'Valid cited file' },
    '2': { kind: 'file', sourceId: 'file-4', title: 'Cross-realm cited file' },
  })`)
  Object.defineProperties(citations, {
    '01': { enumerable: true, value: { kind: 'file', sourceId: 'invalid-leading-zero', title: 'SECRET_SENTINEL' } },
    '1000000': { enumerable: true, value: { kind: 'file', sourceId: 'invalid-oversized', title: 'SECRET_SENTINEL' } },
    invalid: { enumerable: true, value: { kind: 'file', sourceId: 'invalid-nonnumeric', title: 'SECRET_SENTINEL' } },
    '1': { enumerable: true, get() { getterReads += 1; return { kind: 'file', sourceId: 'getter-file', title: 'SECRET_SENTINEL' } } },
  })
  const entries = getNativeTranscriptCitationEntries(citations)
  assert.deepEqual(entries.map(({ key, citation }) => [key, citation.sourceId]), [['0', 'file-3'], ['2', 'file-4']])
  const bounded = Object.fromEntries(Array.from({ length: 105 }, (_, index) => [String(index), { kind: 'memory', sourceId: `memory-${index}` }]))
  assert.equal(getNativeTranscriptCitationEntries(bounded).length, 100)
  assert.equal(getNativeTranscriptCitationEntries(bounded).at(-1).key, '99')
  const validAfterInvalid = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [String(index), { kind: 'invalid' }]))
  validAfterInvalid['100'] = { kind: 'memory', sourceId: 'last-valid' }
  assert.deepEqual(getNativeTranscriptCitationEntries(validAfterInvalid).map(({ key }) => key), ['100'])

  const view = makeView({ resources: false, source: false, citations: false, draftTool: false })
  const exchange = view.exchanges[0]
  const response = exchange.responses[0]
  exchange.user.indexedAttachments = []
  response.sources = []
  response.blocks = []
  response.sourceCitations = citations
  const registry = new NativeTranscriptResourceRegistry(() => `citation_resource_${String(++uuidSequence).padStart(4, '0')}`)
  assert.equal(registry.commitView(view), true)
  const registered = registry.currentAssets()
  assert.deepEqual(registered.map((asset) => [asset.resourceId, asset.label]), [
    ['file-3', 'Valid cited file'], ['file-4', 'Cross-realm cited file'],
  ])

  const projected = createNativeTranscriptDomSnapshot({
    ...projectionScope, theme: 'light', view, supportedActions: ['open-citation'], query: '', scrollIntent: null, assets: registered,
  })
  const projectedCitations = projected.view.exchanges[0].responses[0].sourceCitations
  assert.deepEqual(Object.keys(projectedCitations), ['0', '2'])
  assert.equal(projectedCitations['0'].sourceId, registered.find((asset) => asset.resourceId === 'file-3').handle)
  assert.equal(projectedCitations['2'].sourceId, registered.find((asset) => asset.resourceId === 'file-4').handle)
  assert.equal(JSON.stringify(projected).includes('SECRET_SENTINEL'), false)
  assert.equal(JSON.stringify(projected).includes('invalid-leading-zero'), false)
  assert.equal(JSON.stringify(projected).includes('getter-file'), false)
  assert.equal(getterReads, 0)

  const tree = await render(defaultProps({ view }))
  await focus()
  await act(async () => { await Promise.resolve() })
  const hostSnapshot = lastTranscriptProps.snapshot
  assert.ok(hostSnapshot.supportedActions.includes('open-citation'))
  await readyCurrent()
  assert.equal((await lastTranscriptProps.onAction(action(hostSnapshot, 'open-citation', { citationKey: '0' }))).ok, true)
  const routedCount = routeCalls.length
  for (const citationKey of ['01', '1', '1000000', 'invalid']) {
    assert.equal((await lastTranscriptProps.onAction(action(hostSnapshot, 'open-citation', { citationKey }))).ok, false)
  }
  assert.equal(routeCalls.length, routedCount)
  assert.equal(getterReads, 0)
  await unmount(tree)
})

test('projection ignores malformed assets and exposes previews only for strict previewable assets', () => {
  const view = makeView({ resources: false, source: false, citations: false, draftTool: false })
  const exchange = view.exchanges[0]
  exchange.media = { kind: 'image', results: [
    { type: 'image', status: 'completed', outputId: 'image-output-2', url: 'https://private.example/image' },
    { type: 'video', status: 'completed', outputId: 'video-output-2', url: 'https://private.example/video' },
  ] }
  const malformedPreviewHandle = 'malformed_preview_handle_0001'
  const videoHandle = 'nonpreview_video_handle_0001'
  const snapshot = createNativeTranscriptDomSnapshot({
    ...projectionScope,
    theme: 'light',
    view,
    supportedActions: ['open-asset', 'reply'],
    query: '',
    scrollIntent: null,
    assets: [
      null,
      undefined,
      {
        handle: malformedPreviewHandle, exchangeId: exchange.id, resourceId: 'image-output-2', resourceKind: 'output',
        previewable: 'true', previewDataUrl: 'data:image/png;base64,AAAA', label: 'Malformed preview flag',
      },
      {
        handle: videoHandle, exchangeId: exchange.id, resourceId: 'video-output-2', resourceKind: 'output',
        previewable: false, previewDataUrl: 'data:video/mp4;base64,AAAA', label: 'Video output',
      },
    ],
  })
  assert.deepEqual(snapshot.assets, [])
  assert.deepEqual(snapshot.media[0].results.map((result) => result.assetHandle), [malformedPreviewHandle, videoHandle])
  assert.deepEqual(snapshot.media[0].results.map((result) => result.previewDataUrl), [undefined, undefined])
  assert.equal(JSON.stringify(snapshot).includes('private.example'), false)
  assert.equal(JSON.stringify(snapshot).includes('AAAA'), false)
})

async function render(props = defaultProps()) {
  await act(async () => { activeTree = create(React.createElement(Harness, { props })) })
  return activeTree
}

async function focus() {
  assert.equal(typeof focusEffect, 'function')
  navigationFocused = true
  await act(async () => { focusCleanup = focusEffect() })
}

async function blur() {
  navigationFocused = false
  const cleanup = focusCleanup
  focusCleanup = null
  await act(async () => { cleanup?.() })
}

async function emitAppState(state) {
  appState.currentState = state
  await act(async () => {
    for (const listener of appStateListeners) listener(state)
    await Promise.resolve()
  })
}

async function readyCurrent() {
  const props = lastTranscriptProps
  await act(async () => { props.onReady(scopeFrom(props.snapshot)) })
}

async function unmount(tree) {
  if (tree) await act(async () => { tree.unmount() })
  if (activeTree === tree) activeTree = null
  navigationFocused = false
  focusEffect = null
  focusCleanup = null
  appState.currentState = 'active'
  appStateListeners.clear()
  availabilityDeferred = null
  clipboardDeferred = null
  availabilityValue = true
  files.clear()
  directories.clear()
  shareCalls.length = 0
  routeCalls.length = 0
  externalLinks.length = 0
  clipboardCalls.length = 0
  keyboardDismissals.length = 0
  shareQueue = []
}

test.afterEach(async () => { if (activeTree) await unmount(activeTree) })

test('mounted host projects scoped capabilities and routes only current native resources safely', async () => {
  const replied = []
  const jumped = []
  const tree = await render(defaultProps({
    onReply: async (target, scope) => replied.push([target.exchange.id, scope.isCurrent()]),
    onJumpToReply: async (parentId, scope) => jumped.push([parentId, scope.isCurrent()]),
  }))
  await focus()
  await act(async () => { await Promise.resolve() })
  let snapshot = lastTranscriptProps.snapshot
  assert.deepEqual(lastTranscriptProps.dom, { style: { flex: 1, backgroundColor: theme.background } })
  assert.ok(snapshot.mountNonce)
  assert.ok(snapshot.focusNonce)
  assert.equal(snapshot.publicModelLabels[0].name, 'Public model')
  assert.ok(snapshot.supportedActions.includes('copy'))
  assert.ok(snapshot.supportedActions.includes('download-text'))
  assert.ok(snapshot.supportedActions.includes('reply'))
  assert.ok(snapshot.supportedActions.includes('jump-to-reply'))
  assert.ok(snapshot.supportedActions.includes('open-asset'))
  assert.ok(snapshot.supportedActions.includes('open-source'))
  assert.ok(snapshot.supportedActions.includes('open-citation'))
  assert.ok(!snapshot.supportedActions.includes('delete'))
  assert.ok(!['delete', 'branch', 'retry', 'continue', 'generated-ui-write'].some((kind) => snapshot.supportedActions.includes(kind)))
  assert.equal(loadingVisible(tree), true)
  await readyCurrent()
  assert.equal(loadingVisible(tree), false)

  const copyPromise = lastTranscriptProps.onAction(action(snapshot, 'copy', { text: 'copy me' }))
  await copyPromise
  assert.deepEqual(clipboardCalls.at(-1), 'copy me')
  const reply = await lastTranscriptProps.onAction(action(snapshot, 'reply'))
  assert.equal(reply.ok, true)
  assert.deepEqual(replied, [['exchange-1', true]])
  const jump = await lastTranscriptProps.onAction(action(snapshot, 'jump-to-reply'))
  assert.equal(jump.ok, true)
  assert.deepEqual(jumped, [['parent-exchange', true]])
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'keyboard-dismiss'))).ok, true)
  assert.equal(keyboardDismissals.length, 1)

  const fileAsset = snapshot.assets.find((asset) => asset.label === 'Report')
  const outputAsset = snapshot.assets.find((asset) => asset.resourceKind === 'output')
  assert.ok(fileAsset && outputAsset, JSON.stringify(snapshot.assets))
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-asset', { assetHandle: fileAsset.handle }))).ok, true)
  assert.deepEqual(routeCalls.at(-1), { pathname: '/(tabs)/files/file/[id]', params: { id: 'file-1' } })
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-asset', { assetHandle: outputAsset.handle }))).ok, true)
  assert.deepEqual(routeCalls.at(-1), { pathname: '/(tabs)/files/output/[id]', params: { id: 'output-1' } })

  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-source', { sourceId: 'source-document' }))).ok, true)
  assert.deepEqual(routeCalls.at(-1), { pathname: '/(tabs)/files/file/[id]', params: { id: 'file-2' } })
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-source', { sourceId: 'source-url' }))).ok, true)
  assert.deepEqual(externalLinks.at(-1), 'https://example.org/guide')
  const fileCitationResult = await lastTranscriptProps.onAction(action(snapshot, 'open-citation', { citationKey: '0' }))
  assert.equal(fileCitationResult.ok, true, JSON.stringify(fileCitationResult))
  assert.deepEqual(routeCalls.at(-1), { pathname: '/(tabs)/files/file/[id]', params: { id: 'file-3' } })
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-citation', { citationKey: '1' }))).ok, true)
  assert.deepEqual(routeCalls.at(-1), { pathname: '/(tabs)/files/memory/[id]', params: { id: 'memory-1' } })

  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://getoverlay.io/files/file/file-1?workspace=hostile&auth=secret#fragment' }))).ok, true)
  assert.deepEqual(routeCalls.at(-1), { pathname: '/(tabs)/files/file/[id]', params: { id: 'file-1' } })
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://overlay.works/files/file/file-1?workspace=untrusted' }))).ok, true)
  assert.deepEqual(routeCalls.at(-1), { pathname: '/(tabs)/files/file/[id]', params: { id: 'file-1' } })
  const beforeRejectedLink = routeCalls.length
  const beforeAuthCallback = externalLinks.length
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://overlay.works/auth/native/callback?code=secret' }))).ok, false)
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://getoverlay.io/auth/native/callback?code=secret' }))).ok, false)
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://getoverlay.io/%61uth/native/callback' }))).ok, false)
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://getoverlay.io/password/reset?code=secret' }))).ok, false)
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'http://getoverlay.io/auth/native/callback?code=secret' }))).ok, false)
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'http://GETOVERLAY.IO./%61uth/native/callback?token=secret' }))).ok, false)
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'http://getoverlay.io/files/file/file-1' }))).ok, false)
  assert.equal(routeCalls.length, beforeRejectedLink)
  assert.equal(externalLinks.length, beforeAuthCallback)
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://example.org/guide' }))).ok, true)
  assert.deepEqual(externalLinks.at(-1), 'https://example.org/guide')
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://getoverlay.io/about?workspace=untrusted&auth=secret&view=public#fragment' }))).ok, true)
  assert.equal(externalLinks.at(-1), 'https://getoverlay.io/about?view=public')
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'http://GETOVERLAY.IO./about?workspace_id=untrusted&access-token=secret&view=public#fragment' }))).ok, true)
  assert.equal(externalLinks.at(-1), 'http://getoverlay.io/about?view=public')
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-link', { url: 'https://getoverlay.io/chat/work?workspace=untrusted' }))).ok, true)
  assert.equal(externalLinks.at(-1), 'https://getoverlay.io/chat/work')

  const staleAssetRequest = action(snapshot, 'open-asset', { assetHandle: fileAsset.handle })
  const staleSourceRequest = action(snapshot, 'open-source', { sourceId: 'source-document' })
  await act(async () => tree.update(React.createElement(Harness, { props: defaultProps({ view: makeView({ resources: false, source: false, citations: false }) }) })))
  snapshot = lastTranscriptProps.snapshot
  assert.equal((await lastTranscriptProps.onAction(staleAssetRequest)).ok, false)
  assert.equal((await lastTranscriptProps.onAction(staleSourceRequest)).ok, false)
  await unmount(tree)
})

test('text-only streaming updates do not trigger an extra registry render', async () => {
  const tree = await render()
  await focus()
  await readyCurrent()
  const before = transcriptRenders
  const view = makeView()
  view.exchanges[0].user.text += ' streamed'
  await act(async () => { tree.update(React.createElement(Harness, { props: defaultProps({ view }) })) })
  assert.equal(transcriptRenders, before + 1)
  await unmount(tree)
})

test('mounted host keeps DOM mounted while focus and AppState scopes rotate, and invalidates on authority loss/unmount', async () => {
  const tree = await render()
  await focus()
  let firstProps = lastTranscriptProps
  const first = firstProps.snapshot
  await readyCurrent()
  const firstCopy = action(first, 'copy', { text: 'first' })
  assert.equal((await firstProps.onAction(firstCopy)).ok, true)
  const domMounts = transcriptMounts

  await blur()
  assert.equal((await firstProps.onAction(firstCopy)).error, 'stale-scope')
  await focus()
  let secondProps = lastTranscriptProps
  let second = secondProps.snapshot
  assert.equal(second.mountNonce, first.mountNonce)
  assert.notEqual(second.focusNonce, first.focusNonce)
  assert.equal(transcriptMounts, domMounts)
  await act(async () => { firstProps.onReady(scopeFrom(first)) })
  assert.equal(loadingVisible(tree), true)
  await readyCurrent()

  await emitAppState('background')
  assert.equal((await secondProps.onAction(action(second, 'copy', { text: 'background' }))).error, 'stale-scope')
  assert.equal(loadingVisible(tree), false)
  assert.equal(coverVisible(tree), true)
  await emitAppState('active')
  const thirdProps = lastTranscriptProps
  const third = thirdProps.snapshot
  assert.equal(third.mountNonce, first.mountNonce)
  assert.notEqual(third.focusNonce, second.focusNonce)
  assert.equal(transcriptMounts, domMounts)
  await readyCurrent()

  await act(async () => tree.update(React.createElement(Harness, { props: defaultProps({ authorityActive: false }) })))
  assert.equal(lastTranscriptProps.snapshot.view.exchanges.length, 0)
  assert.deepEqual(lastTranscriptProps.snapshot.supportedActions, [])
  assert.equal((await thirdProps.onAction(action(third, 'copy', { text: 'inactive' }))).error, 'stale-scope')
  await act(async () => tree.update(React.createElement(Harness, { props: defaultProps() })))
  const resumed = lastTranscriptProps.snapshot
  assert.equal(resumed.mountNonce, first.mountNonce)
  assert.notEqual(resumed.focusNonce, third.focusNonce)
  await readyCurrent()

  const oldProps = lastTranscriptProps
  const oldSnapshot = oldProps.snapshot
  await act(async () => tree.update(React.createElement(Harness, { show: false })))
  assert.equal((await oldProps.onAction(action(oldSnapshot, 'copy', { text: 'unmounted' }))).error, 'stale-scope')
  assert.equal(transcriptUnmounts >= 1, true)
  await unmount(tree)
  assert.equal((await firstProps.onAction(firstCopy)).error, 'stale-scope')
})

test('resumed host replays its current snapshot after the mounted DOM reports a stale focus scope', async () => {
  const tree = await render()
  await focus()
  const firstSnapshot = lastTranscriptProps.snapshot
  await readyCurrent()
  const mountedDomCount = transcriptMounts
  await emitAppState('background')
  await emitAppState('active')
  const resumedSnapshot = lastTranscriptProps.snapshot
  assert.equal(resumedSnapshot.mountNonce, firstSnapshot.mountNonce)
  assert.notEqual(resumedSnapshot.focusNonce, firstSnapshot.focusNonce)
  assert.equal(loadingVisible(tree), true)

  const renderCount = transcriptRenders
  await act(async () => { lastTranscriptProps.onReady(scopeFrom(firstSnapshot)) })
  assert.equal(transcriptRenders > renderCount, true)
  const replayedSnapshot = lastTranscriptProps.snapshot
  assert.notEqual(replayedSnapshot, resumedSnapshot)
  assert.equal(replayedSnapshot.focusNonce, resumedSnapshot.focusNonce)
  await readyCurrent()
  assert.equal(loadingVisible(tree), false)
  assert.equal(transcriptMounts, mountedDomCount)

  const acknowledgedSnapshot = lastTranscriptProps.snapshot
  const renderCountAfterCurrentAck = transcriptRenders
  await act(async () => { lastTranscriptProps.onReady(scopeFrom(firstSnapshot)) })
  assert.equal(loadingVisible(tree), false)
  assert.equal(lastTranscriptProps.snapshot.deliveryEpoch, acknowledgedSnapshot.deliveryEpoch)
  assert.equal(transcriptRenders, renderCountAfterCurrentAck)

  const renderCountAfterAck = transcriptRenders
  await act(async () => {
    lastTranscriptProps.onReady({ ...scopeFrom(replayedSnapshot), conversationId: 'other-conversation' })
  })
  assert.equal(transcriptRenders, renderCountAfterAck)
  await unmount(tree)
})

test('active readiness retries stay bounded without an exact acknowledgement and stop once acknowledged', async () => {
  const tree = await render()
  await focus()
  const initialSnapshot = lastTranscriptProps.snapshot
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const retriedSnapshot = lastTranscriptProps.snapshot
  assert.equal(retriedSnapshot.focusNonce, initialSnapshot.focusNonce)
  assert.equal(retriedSnapshot.deliveryEpoch - initialSnapshot.deliveryEpoch, 3)
  assert.equal(loadingVisible(tree), true)

  await readyCurrent()
  assert.equal(loadingVisible(tree), false)
  const acknowledgedEpoch = lastTranscriptProps.snapshot.deliveryEpoch
  await new Promise((resolve) => setTimeout(resolve, 350))
  assert.equal(lastTranscriptProps.snapshot.deliveryEpoch, acknowledgedEpoch)
  await unmount(tree)
})

test('removing a response during delayed share availability prevents file creation and Share UI', async () => {
  const tree = await render()
  await focus()
  await act(async () => { await Promise.resolve() })
  await readyCurrent()
  const snapshot = lastTranscriptProps.snapshot
  assert.ok(snapshot.supportedActions.includes('download-text'))
  const availability = deferred()
  availabilityDeferred = availability
  const pending = lastTranscriptProps.onAction(action(snapshot, 'download-text', { filename: 'removed.txt', text: 'stale response' }))
  await new Promise((resolve) => setImmediate(resolve))
  const view = makeView()
  view.exchanges[0].responses = []
  await act(async () => { tree.update(React.createElement(Harness, { props: defaultProps({ view }) })) })
  assert.equal(lastTranscriptProps.snapshot.view.exchanges[0].responses.length, 0)
  const fileCount = files.size
  const shareCount = shareCalls.length
  availability.resolve(true)
  assert.equal((await pending).ok, false)
  assert.equal(files.size, fileCount)
  assert.equal(shareCalls.length, shareCount)
  await unmount(tree)
})

test('delayed Clipboard completion cannot keep a blurred native action lease current', async () => {
  const tree = await render()
  await focus()
  await readyCurrent()
  const snapshot = lastTranscriptProps.snapshot
  const clipboard = deferred()
  clipboardDeferred = clipboard
  const pending = lastTranscriptProps.onAction(action(snapshot, 'copy', { text: 'delayed clipboard' }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(clipboardCalls.at(-1), 'delayed clipboard')
  await blur()
  clipboard.resolve()
  assert.equal((await pending).error, 'stale-scope')
  await unmount(tree)
})

test('mounted host gates Download on delayed Sharing, retains handoff artifacts, cleans failures and retries draft saves', async () => {
  const availability = deferred()
  availabilityDeferred = availability
  const saves = []
  let failFirstSave = true
  const tree = await render(defaultProps({
    onSaveDraft: async (value, scope) => {
      saves.push([value.draft.name, scope.isCurrent()])
      if (failFirstSave) { failFirstSave = false; throw new Error('synthetic save failure') }
    },
  }))
  await focus()
  const beforeAvailable = lastTranscriptProps.snapshot
  assert.ok(!beforeAvailable.supportedActions.includes('download-text'))
  await act(async () => { availability.resolve(true); await availability.promise; await Promise.resolve() })
  let snapshot = lastTranscriptProps.snapshot
  assert.ok(snapshot.supportedActions.includes('download-text'))
  const shareDeferred = deferred()
  shareQueue.push(shareDeferred.promise)
  const downloadPromise = lastTranscriptProps.onAction(action(snapshot, 'download-text', { filename: 'answer.txt', text: 'plain transcript' }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(shareCalls.length, 1)
  const sharedFile = files.get(shareCalls[0])
  assert.ok(sharedFile)
  assert.equal(sharedFile.name, 'answer.txt')
  assert.equal(sharedFile.name.includes('..'), false)
  assert.equal(sharedFile.contents, 'plain transcript')
  shareDeferred.resolve()
  assert.equal((await downloadPromise).ok, true)
  assert.equal(files.has(sharedFile.uri), true)

  const delayedHandoff = deferred()
  shareQueue.push(delayedHandoff.promise)
  const staleHandoff = lastTranscriptProps.onAction(action(snapshot, 'download-text', { filename: 'pending.txt', text: 'pending handoff' }))
  await new Promise((resolve) => setImmediate(resolve))
  const pendingFile = files.get(shareCalls.at(-1))
  assert.ok(pendingFile)
  await blur()
  delayedHandoff.resolve()
  assert.equal((await staleHandoff).error, 'stale-scope')
  assert.equal(files.has(pendingFile.uri), true)
  await focus()
  await act(async () => { await Promise.resolve() })
  snapshot = lastTranscriptProps.snapshot

  const failedShare = deferred()
  shareQueue.push(failedShare.promise)
  const failedRequest = lastTranscriptProps.onAction(action(snapshot, 'download-text', { filename: 'retry.txt', text: 'retry text' }))
  await new Promise((resolve) => setImmediate(resolve))
  failedShare.reject(new Error('share failed'))
  const failure = await failedRequest
  assert.equal(failure.error, 'action-failed')
  assert.equal(files.size, 2)
  shareQueue.push(Promise.resolve())
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'download-text', { filename: 'retry.txt', text: 'retry text' }))).ok, true)
  assert.equal(files.size, 3)

  let draftResult
  await act(async () => { draftResult = await lastTranscriptProps.onAction(action(snapshot, 'open-draft', { toolKey: 'tool-key-1' })) })
  assert.equal(draftResult.ok, true, JSON.stringify(draftResult))
  assert.equal(lastDraftProps.state.kind, 'skill')
  await act(async () => { await lastDraftProps.onSave(lastDraftProps.state) })
  assert.match(lastDraftProps.saveError, /Unable to save/)
  assert.equal(lastDraftProps.saving, false)
  assert.deepEqual(saves, [['Safe skill', true]])
  await act(async () => { await lastDraftProps.onSave(lastDraftProps.state) })
  assert.equal(lastDraftProps.state, null)
  assert.deepEqual(saves, [['Safe skill', true], ['Safe skill', true]])

  const savesBeforeBlur = saves.length
  assert.equal((await lastTranscriptProps.onAction(action(snapshot, 'open-draft', { toolKey: 'tool-key-1' }))).ok, true)
  const retiredDraft = lastDraftProps
  await blur()
  await act(async () => { await retiredDraft.onSave(retiredDraft.state) })
  assert.equal(saves.length, savesBeforeBlur)
})

test('share cache retention prunes only owned directories by age/count and preserves the requested filename', async () => {
  files.clear()
  directories.clear()
  const now = Date.now()
  const root = new MockDirectory(cacheDirectory, 'native-transcript-share-cache')
  root.create()
  const addOwnedDirectory = (timestamp, id) => {
    const directory = root.createArtifactDirectory(`native-transcript-${timestamp.toString(36)}-${id}`)
    directory.create()
    return directory
  }
  const expired = addOwnedDirectory(now - NATIVE_TRANSCRIPT_SHARE_RETENTION_MS - 1, 'expired_artifact_0001')
  const recent = Array.from({ length: NATIVE_TRANSCRIPT_SHARE_MAX_FILES }, (_, index) =>
    addOwnedDirectory(now - (index + 1) * 1_000, `recent_artifact_${String(index).padStart(4, '0')}`))
  const unrelated = root.createArtifactDirectory('another-feature-cache')
  unrelated.create()
  let sharedUri = ''
  await shareNativeTranscriptText({
    filename: '../Answer.txt',
    text: 'plain text',
    isCurrent: () => true,
    adapters: {
      isAvailable: async () => true,
      getDirectory: () => new MockDirectory(cacheDirectory, 'native-transcript-share-cache'),
      share: async (uri) => { sharedUri = uri },
      now: () => now,
      createId: () => 'new_artifact_id_0001',
    },
  })
  assert.equal(directories.has(expired.uri), false)
  assert.equal(directories.has(unrelated.uri), true)
  assert.equal(directories.has(recent.at(-1).uri), false)
  const retainedOwned = [...directories.values()].filter((directory) => directory.parent?.uri === root.uri && /^native-transcript-/.test(directory.name))
  assert.equal(retainedOwned.length, NATIVE_TRANSCRIPT_SHARE_MAX_FILES)
  assert.equal(sharedUri.split('/').at(-1), 'Answer.txt')
})

test('resource handles retire permanently and public model projection copies only bounded ID/name labels', () => {
  let sequence = 0
  const registry = new NativeTranscriptResourceRegistry(() => `opaque_handle_${String(++sequence).padStart(4, '0')}`)
  const firstView = makeView()
  assert.equal(registry.commitView(firstView), true)
  const first = registry.currentAssets().find((asset) => asset.resourceId === 'file-1')
  assert.ok(first)
  assert.equal(registry.resolveCurrent(first.handle, 'exchange-1').resourceId, 'file-1')
  assert.equal(registry.resolveCurrent(first.handle, 'another-exchange'), null)
  assert.equal(registry.commitView(firstView), false)
  assert.equal(registry.commitView(makeView({ resources: false })), true)
  assert.equal(registry.resolveCurrent(first.handle), null)
  assert.equal(registry.commitView(firstView), true)
  const reappeared = registry.currentAssets().find((asset) => asset.resourceId === 'file-1')
  assert.ok(reappeared)
  assert.notEqual(reappeared.handle, first.handle)

  const mutableLabel = { id: 'model-2', name: 'Public label' }
  const projectionAssets = registry.currentAssets()
  const projected = createNativeTranscriptDomSnapshot({
    workspaceId: 'workspace-1', conversationId: 'conversation-1', mountNonce: 'mount-1', focusNonce: 'focus-1',
    theme: 'light', view: firstView, supportedActions: [], query: '', scrollIntent: null, assets: projectionAssets,
    publicModelLabels: [
      { id: 'model-1', name: 'Private config', apiKey: 'model-secret-sentinel' },
      mutableLabel,
      { id: 'model-3', name: `  ${'x'.repeat(200)}  ` },
    ],
  })
  mutableLabel.name = 'Mutated after projection'
  assert.deepEqual(projected.publicModelLabels, [
    { id: 'model-2', name: 'Public label' },
    { id: 'model-3', name: 'x'.repeat(96) },
  ])
  assert.equal(JSON.stringify(projected).includes('model-secret-sentinel'), false)
  assert.equal(JSON.stringify(projected).includes('file-1'), false)
  assert.equal(JSON.stringify(projected).includes('file-2'), false)
  assert.equal(JSON.stringify(projected).includes('file-3'), false)
  assert.equal(JSON.stringify(projected).includes('output-1'), false)
  const fileCitationSource = projected.view.exchanges[0].responses[0].sourceCitations?.['0']
  const expectedCitationHandle = projectionAssets.find((asset) => asset.resourceId === 'file-3')?.handle
  assert.ok(fileCitationSource)
  assert.ok(expectedCitationHandle)
  assert.equal(fileCitationSource.sourceId, expectedCitationHandle)
  assert.match(fileCitationSource.sourceId, /^[A-Za-z0-9_-]{16,200}$/)

  const displayIdView = makeView()
  displayIdView.exchanges[0].id = 'session:legacy/turn-1'
  const displayIdRegistry = new NativeTranscriptResourceRegistry(() => `display_resource_${String(++sequence).padStart(4, '0')}`)
  assert.equal(displayIdRegistry.commitView(displayIdView), true)
  const displayIdAssets = displayIdRegistry.currentAssets()
  assert.ok(displayIdAssets.some((asset) => asset.exchangeId === 'session:legacy/turn-1' && asset.resourceId === 'file-1'))
  const displayIdSnapshot = createNativeTranscriptDomSnapshot({
    workspaceId: 'workspace-1', conversationId: 'conversation-1', mountNonce: 'mount-1', focusNonce: 'focus-1',
    theme: 'light', view: displayIdView, supportedActions: [], query: '', scrollIntent: null, assets: displayIdAssets,
  })
  assert.ok(displayIdSnapshot.assets.some((asset) => asset.exchangeId === 'session:legacy/turn-1'))

  const membershipView = makeView()
  membershipView.exchanges[0].user.mentions.push({ type: 'file', id: 'mention-1', name: 'Mentioned file', fileIds: ['file-5'] })
  membershipView.exchanges[0].responses[0].blocks.push({ kind: 'source', sourceKind: 'document', sourceId: 'file-4', title: 'Block source' })
  const membershipRegistry = new NativeTranscriptResourceRegistry(() => `membership_resource_${String(++sequence).padStart(4, '0')}`)
  assert.equal(membershipRegistry.commitView(membershipView), true)
  const membershipAssets = membershipRegistry.currentAssets()
  const membershipSnapshot = createNativeTranscriptDomSnapshot({
    workspaceId: 'workspace-1', conversationId: 'conversation-1', mountNonce: 'mount-1', focusNonce: 'focus-1',
    theme: 'light', view: membershipView, supportedActions: [], query: '', scrollIntent: null, assets: membershipAssets,
  })
  const mentionHandle = membershipAssets.find((asset) => asset.resourceId === 'file-5')?.handle
  const blockHandle = membershipAssets.find((asset) => asset.resourceId === 'file-4')?.handle
  assert.ok(mentionHandle)
  assert.ok(blockHandle)
  assert.equal(membershipSnapshot.view.exchanges[0].user.mentions[0].fileIds[0], mentionHandle)
  assert.equal(membershipSnapshot.view.exchanges[0].responses[0].blocks.some((block) => block.kind === 'source' && block.sourceId === blockHandle), true)

  const videoView = makeView()
  videoView.exchanges[0].media = { kind: 'image', results: [
    { type: 'image', status: 'completed', outputId: 'image-output-1', url: 'https://private.example/image' },
    { type: 'video', status: 'completed', outputId: 'video-output-1', url: 'https://private.example/video' },
    { type: 'image', status: 'generating', outputId: 'temporary-output-1', url: 'https://private.example/temporary' },
  ] }
  const videoRegistry = new NativeTranscriptResourceRegistry(() => `video_resource_${String(++sequence).padStart(4, '0')}`)
  assert.equal(videoRegistry.commitView(videoView), true)
  const videoAsset = videoRegistry.currentAssets().find((asset) => asset.resourceId === 'video-output-1')
  const imageAsset = videoRegistry.currentAssets().find((asset) => asset.resourceId === 'image-output-1')
  assert.ok(videoAsset)
  assert.ok(imageAsset)
  assert.equal(videoAsset.previewable, false)
  assert.equal(imageAsset.previewable, true)
  assert.equal(videoRegistry.currentAssets().some((asset) => asset.resourceId === 'temporary-output-1'), false)
  const videoSnapshot = createNativeTranscriptDomSnapshot({
    workspaceId: 'workspace-1', conversationId: 'conversation-1', mountNonce: 'mount-1', focusNonce: 'focus-1',
    theme: 'light', view: videoView, supportedActions: ['reply', 'open-asset'], query: '', scrollIntent: null,
    assets: videoRegistry.currentAssets(),
  })
  assert.equal(videoSnapshot.media[0].results.length, 3)
  assert.deepEqual(videoSnapshot.media[0].results.map((result) => [result.type, result.status]), [
    ['image', 'completed'], ['video', 'completed'], ['image', 'generating'],
  ])
  assert.ok(videoSnapshot.media[0].results[0].assetHandle)
  assert.ok(videoSnapshot.media[0].results[1].assetHandle)
  assert.equal(videoSnapshot.media[0].results[1].previewDataUrl, undefined)
  assert.equal(videoSnapshot.media[0].results[2].assetHandle, undefined)
  assert.equal(videoSnapshot.media[0].results[2].previewDataUrl, undefined)
  assert.deepEqual(videoSnapshot.assets.filter((asset) => asset.resourceKind === 'output').map((asset) => asset.handle), [
    videoSnapshot.media[0].results[0].assetHandle,
  ])
  assert.equal(JSON.stringify(videoSnapshot).includes('video-output-1'), false)
  assert.equal(JSON.stringify(videoSnapshot).includes('temporary-output-1'), false)
  assert.equal(JSON.stringify(videoSnapshot).includes('private.example'), false)
})
