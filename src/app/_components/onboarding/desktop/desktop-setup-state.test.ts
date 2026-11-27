import { strict as assert } from 'node:assert'
import test from 'node:test'
import { desktopSetupSteps, readDesktopSetup, writeDesktopSetup } from './desktop-setup-state'

test('desktop setup shows only the screens this app can support', () => {
  assert.deepEqual(desktopSetupSteps(['auth']), ['who', 'about', 'plan'])
  assert.deepEqual(desktopSetupSteps(['auth', 'localSetup', 'localThreads', 'localComputer', 'agentHost']),
    ['who', 'about', 'setup', 'models', 'computer', 'plan'])
})

test('desktop setup resumes where it was left, and starts fresh when storage is blocked', () => {
  const store = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  } } })
  try {
    const fresh = readDesktopSetup('user-1', 'Sam', 'personal-1')
    assert.deepEqual(fresh, { step: 'who', forTeam: false, workspaceName: '', workspaceId: 'personal-1', name: 'Sam', about: '' })
    writeDesktopSetup('user-1', { ...fresh, step: 'models', about: 'Operations' })
    assert.equal(readDesktopSetup('user-1', 'Sam', 'personal-1').step, 'models')
    assert.equal(readDesktopSetup('user-2', 'Ada', 'personal-2').step, 'who')
    writeDesktopSetup('user-1', null)
    assert.equal(readDesktopSetup('user-1', 'Sam', 'personal-1').step, 'who')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } } } })
    assert.equal(readDesktopSetup('user-1', 'Sam', 'personal-1').step, 'who')
    writeDesktopSetup('user-1', fresh)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete (globalThis as { window?: unknown }).window
  }
})
