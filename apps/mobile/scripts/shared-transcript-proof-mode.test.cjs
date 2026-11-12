/* eslint-disable @typescript-eslint/no-require-imports */
require('tsx/cjs')

const assert = require('node:assert/strict')
const Module = require('node:module')
const test = require('node:test')
const React = require('../../node_modules/react')
const { act, create } = require('../../node_modules/react-test-renderer')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let registeredFocusEffect = null
let blurCleanup = null
let lastTranscriptProps = null
let uuidSequence = 0
let nextClipboardPromise = null
const clipboardCalls = []
const theme = { background: '#202124', textSecondary: '#b0b5bb' }
const reactNative = {
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { absoluteFillObject: { position: 'absolute' }, create: (styles) => styles },
  Text: 'Text',
  View: 'View',
}

function useFocusEffect(callback) {
  React.useEffect(() => {
    registeredFocusEffect = callback
    return () => {
      const cleanup = blurCleanup
      blurCleanup = null
      cleanup?.()
      if (registeredFocusEffect === callback) registeredFocusEffect = null
    }
  }, [callback])
}

function MockNativeSharedTranscript(props) {
  lastTranscriptProps = props
  return React.createElement('NativeSharedTranscript', { focusNonce: props.snapshot.focusNonce })
}

const originalLoad = Module._load
Module._load = function loadProofHelperMock(request, parent, isMain) {
  if (parent?.filename.endsWith('/components/chat/SharedTranscriptProofMode.tsx')) {
    if (request === 'react') return React
    if (request === 'react/jsx-runtime') return require('../../node_modules/react/jsx-runtime')
    if (request === 'expo-router') return { useFocusEffect }
    if (request === 'expo-crypto') return { randomUUID: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}` }
    if (request === 'expo-clipboard') return {
      setStringAsync: (value) => {
        clipboardCalls.push(value)
        const pending = nextClipboardPromise
        nextClipboardPromise = null
        return pending ?? Promise.resolve()
      },
    }
    if (request === 'react-native') return reactNative
    if (request === '../../hooks/useTheme') return { useTheme: () => ({ theme, isDark: true }) }
    if (request === './NativeSharedTranscript.dom') return MockNativeSharedTranscript
  }
  return originalLoad.call(this, request, parent, isMain)
}

let SharedTranscriptProofMode
try {
  ({ SharedTranscriptProofMode } = require('../components/chat/SharedTranscriptProofMode.tsx'))
} finally {
  Module._load = originalLoad
}

function Harness({ show }) {
  return show ? React.createElement(SharedTranscriptProofMode) : React.createElement('MarkdownMode')
}

function scopeFor(snapshot) {
  return {
    workspaceId: snapshot.workspaceId,
    conversationId: snapshot.conversationId,
    mountNonce: snapshot.mountNonce,
    focusNonce: snapshot.focusNonce,
  }
}

function copyRequest(snapshot, text) {
  const exchange = snapshot.view.exchanges[0]
  return {
    kind: 'copy',
    workspaceId: snapshot.workspaceId,
    conversationId: snapshot.conversationId,
    mountNonce: snapshot.mountNonce,
    focusNonce: snapshot.focusNonce,
    exchangeId: exchange.id,
    target: { kind: 'user', userId: exchange.user.id },
    text,
  }
}

function loadingVisible(tree) {
  return tree.root.findAllByType('Text').some((node) => node.children.join('') === 'Loading synthetic transcript')
}

async function focus() {
  assert.equal(typeof registeredFocusEffect, 'function')
  await act(async () => {
    blurCleanup = registeredFocusEffect()
  })
}

async function blur() {
  const cleanup = blurCleanup
  blurCleanup = null
  await act(async () => { cleanup?.() })
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('mounted dev proof rotates focus scopes, gates readiness, copies and invalidates retired callbacks', async () => {
  let tree
  await act(async () => { tree = create(React.createElement(Harness, { show: true })) })
  assert.equal(loadingVisible(tree), true)

  await focus()
  const firstProps = lastTranscriptProps
  const firstSnapshot = firstProps.snapshot
  assert.ok(firstSnapshot.focusNonce)
  assert.equal(firstSnapshot.focusNonce, `${firstSnapshot.mountNonce}_focus_1`)
  assert.ok(firstSnapshot.supportedActions.includes('copy'))
  assert.equal(firstSnapshot.theme, 'dark')
  assert.equal(loadingVisible(tree), true)

  await act(async () => { firstProps.onReady(scopeFor(firstSnapshot)) })
  assert.equal(loadingVisible(tree), false)

  const firstCopy = await firstProps.onAction(copyRequest(firstSnapshot, 'first focused copy'))
  assert.equal(firstCopy.ok, true)
  assert.deepEqual(clipboardCalls, ['first focused copy'])

  await blur()
  assert.equal(loadingVisible(tree), true)
  assert.equal((await firstProps.onAction(copyRequest(firstSnapshot, 'blurred copy'))).error, 'stale-scope')
  assert.deepEqual(clipboardCalls, ['first focused copy'])

  await focus()
  const secondProps = lastTranscriptProps
  const secondSnapshot = secondProps.snapshot
  assert.equal(secondSnapshot.mountNonce, firstSnapshot.mountNonce)
  assert.notEqual(secondSnapshot.focusNonce, firstSnapshot.focusNonce)
  assert.ok(secondSnapshot.focusNonce)
  assert.equal(loadingVisible(tree), true)

  await act(async () => { firstProps.onReady(scopeFor(firstSnapshot)) })
  assert.equal(loadingVisible(tree), true)
  assert.equal((await firstProps.onAction(copyRequest(firstSnapshot, 'old focus copy'))).error, 'stale-scope')
  assert.deepEqual(clipboardCalls, ['first focused copy'])

  await act(async () => { secondProps.onReady(scopeFor(secondSnapshot)) })
  assert.equal(loadingVisible(tree), false)
  const secondCopy = await secondProps.onAction(copyRequest(secondSnapshot, 'refocused copy'))
  assert.equal(secondCopy.ok, true)
  assert.deepEqual(clipboardCalls, ['first focused copy', 'refocused copy'])

  const pendingClipboard = deferred()
  nextClipboardPromise = pendingClipboard.promise
  const pendingRequest = secondProps.onAction(copyRequest(secondSnapshot, 'pending copy'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(clipboardCalls.includes('pending copy'))

  await act(async () => { tree.update(React.createElement(Harness, { show: false })) })
  pendingClipboard.resolve()
  assert.equal((await pendingRequest).error, 'stale-scope')
  assert.equal((await secondProps.onAction(copyRequest(secondSnapshot, 'after mode switch'))).error, 'stale-scope')

  await act(async () => { tree.update(React.createElement(Harness, { show: true })) })
  await focus()
  const remountedSnapshot = lastTranscriptProps.snapshot
  assert.notEqual(remountedSnapshot.mountNonce, firstSnapshot.mountNonce)
  assert.notEqual(remountedSnapshot.focusNonce, secondSnapshot.focusNonce)
  assert.equal(uuidSequence, 2)
  await act(async () => { tree.unmount() })
})
