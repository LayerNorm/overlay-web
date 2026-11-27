/* eslint-disable @typescript-eslint/no-require-imports */
require('tsx/cjs')

const assert = require('node:assert/strict')
const Module = require('node:module')
const test = require('node:test')

const values = new Map()
let delayedRead = null
const secureStore = {
  async getItemAsync(key) {
    const value = values.get(key) ?? null
    if (delayedRead) {
      const read = delayedRead
      delayedRead = null
      read.started.resolve()
      await read.release.promise
    }
    return value
  },
  async setItemAsync(key, value) { values.set(key, value) },
  async deleteItemAsync(key) { values.delete(key) },
}

const originalLoad = Module._load
Module._load = function loadAuthServiceDependencies(request, parent, isMain) {
  if (request === 'expo-secure-store') return secureStore
  if (request === 'expo-crypto') {
    return {
      CryptoDigestAlgorithm: { SHA256: 'SHA256' },
      CryptoEncoding: { BASE64: 'base64' },
      digestStringAsync: async () => 'test-digest',
      getRandomBytesAsync: async length => new Uint8Array(length),
    }
  }
  if (parent?.filename.endsWith('/services/authService.ts') && request === './appConfig') {
    return { AUTH_BASE_URL: 'https://auth.example.test' }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const {
  clearAuthSessionIfCurrent,
  saveAuthSession,
  saveRefreshedAuthSessionIfCurrent,
} = require('../services/authService.ts')

function deferred() {
  let resolve
  const promise = new Promise(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

const AUTH_STORAGE_KEY = 'overlay-auth-session'

test('serialized conditional clear cannot delete a session written during its stored-session read', async () => {
  const previous = {
    accessToken: 'access-before',
    refreshToken: 'refresh-before',
    expiresAt: 1,
    user: { id: 'owner-a', email: 'owner-a@example.test' },
  }
  const rotated = {
    accessToken: 'access-after',
    refreshToken: 'refresh-after',
    expiresAt: 2,
    user: previous.user,
  }
  values.clear()
  await saveAuthSession(previous)

  const started = deferred()
  const release = deferred()
  delayedRead = { started, release }
  const clear = clearAuthSessionIfCurrent(previous)
  await started.promise
  const write = saveAuthSession(rotated)
  release.resolve()

  const [cleared] = await Promise.all([clear, write])
  assert.equal(cleared, true)
  assert.deepEqual(JSON.parse(values.get(AUTH_STORAGE_KEY)), rotated)
})

test('stale refresh result cannot overwrite an already rotated same-owner session', async () => {
  const previous = {
    accessToken: 'access-before',
    refreshToken: 'refresh-before',
    expiresAt: 1,
    user: { id: 'owner-a', email: 'owner-a@example.test' },
  }
  const rotated = {
    accessToken: 'access-after',
    refreshToken: 'refresh-after',
    expiresAt: 2,
    user: previous.user,
  }
  const staleRefresh = {
    accessToken: 'access-stale',
    refreshToken: 'refresh-stale',
    expiresAt: 3,
    user: previous.user,
  }
  values.clear()
  await saveAuthSession(rotated)

  const current = await saveRefreshedAuthSessionIfCurrent(staleRefresh, previous)
  const cleared = await clearAuthSessionIfCurrent(previous)

  assert.deepEqual(current, rotated)
  assert.equal(cleared, false)
  assert.deepEqual(JSON.parse(values.get(AUTH_STORAGE_KEY)), rotated)
})

test.after(() => {
  Module._load = originalLoad
})
