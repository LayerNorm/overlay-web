import assert from 'node:assert/strict'
import test from 'node:test'
import { getDesktopBridge, isTrustedFrame, methodSchemas, notifyDesktopSignedOut } from './index'

test('ordinary browser and server rendering have no desktop bridge', () => {
  assert.equal(getDesktopBridge(), null)
})
test('only the pinned origin in the main frame is trusted', () => {
  const origin = 'https://www.getoverlay.io'
  assert.equal(isTrustedFrame(`${origin}/app/chat`, true, origin), true)
  for (const url of ['about:blank', 'file:///app.html', 'https://www.getoverlay.io.evil.test/app', 'https://evil.test', 'http://www.getoverlay.io/app', 'https://getoverlay.io', 'invalid']) assert.equal(isTrustedFrame(url, true, origin), false, url)
  assert.equal(isTrustedFrame(`${origin}/app/chat`, false, origin), false)
})
test('external protocol, panel, enrollment and native input boundaries fail closed', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'overlay://auth/transfer']) assert.equal(methodSchemas['window.openExternal'].safeParse({ url }).success, false)
  assert.equal(methodSchemas['window.openExternal'].safeParse({ url: 'https://example.com' }).success, true)
  for (const count of [-1, 0.1, 100000, '1']) assert.equal(methodSchemas['window.setBadgeCount'].safeParse({ count }).success, false)
  assert.equal(methodSchemas['panels.show'].safeParse({ kind: 'browser' }).success, false)
  assert.equal(methodSchemas['panels.show'].safeParse({ kind: 'chat', url: 'https://evil.test' }).success, false)
  assert.equal(methodSchemas['transcription.transcribe'].safeParse({ audio: new Uint8Array(), mime: 'audio/wav', model: 'parakeet_v2' }).success, false)
  assert.equal(methodSchemas['notifications.show'].safeParse({ title: 'Test', body: '', route: '/app\\evil' }).success, false)
})

test('sign-out outside the shell checks the capability and awaits native cleanup', async () => {
  let hasAuth = false
  let calls = 0
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { overlayDesktop: {
    handshake: async () => ({ capabilities: hasAuth ? ['auth'] : [] }),
    call: async () => { calls++ },
    on: () => () => {},
  } } })
  try {
    await notifyDesktopSignedOut()
    assert.equal(calls, 0)
    hasAuth = true
    await notifyDesktopSignedOut()
    assert.equal(calls, 1)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
