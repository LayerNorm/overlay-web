/* eslint-disable @typescript-eslint/no-require-imports */
require('tsx/cjs')

const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '..')
const bootstrapServicePath = path.join(projectRoot, 'services/bootstrapService.ts')
const cacheKey = 'overlay-app-bootstrap-v2'

const state = {
  cache: new Map(),
  events: [],
  getCalls: [],
  setCalls: [],
  removeCalls: [],
  networkCalls: 0,
  response: null,
}

const asyncStorage = {
  async getItem(key) {
    state.events.push('get')
    state.getCalls.push(key)
    return state.cache.get(key) ?? null
  },
  async setItem(key, value) {
    state.events.push('set')
    state.setCalls.push([key, value])
    state.cache.set(key, value)
  },
  async removeItem(key) {
    state.events.push('remove')
    state.removeCalls.push(key)
    state.cache.delete(key)
  },
}

const originalLoad = Module._load
Module._load = function loadBootstrapServiceMocks(request, parent, isMain) {
  if (parent?.filename === bootstrapServicePath) {
    if (request === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: asyncStorage }
    }
    if (request === './overlayClient') {
      return {
        mobileOverlayAppClient: {
          bootstrap: {
            get: async () => {
              state.events.push('request')
              state.networkCalls += 1
              if (state.response instanceof Error) throw state.response
              return state.response
            },
          },
        },
      }
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const bootstrapService = require(bootstrapServicePath)
Module._load = originalLoad

function validBootstrap(overrides = {}) {
  return {
    user: null,
    entitlements: null,
    uiSettings: {},
    chatModels: [{
      id: 'model-a',
      name: 'Model A',
      provider: 'anthropic',
    }],
    imageModels: [],
    videoModels: [],
    featureFlags: {},
    capabilities: {},
    destinations: [],
    ...overrides,
  }
}

async function reset(cacheValue, response = validBootstrap()) {
  await bootstrapService.clearBootstrapCache()
  state.cache.clear()
  state.events.length = 0
  state.getCalls.length = 0
  state.setCalls.length = 0
  state.removeCalls.length = 0
  state.networkCalls = 0
  state.response = response
  if (cacheValue !== undefined) state.cache.set(cacheKey, cacheValue)
}

test('literal-null cache is invalidated before fetching and caching valid models', async () => {
  const fresh = validBootstrap()
  await reset('null', fresh)

  const result = await bootstrapService.getAppBootstrap()

  assert.deepEqual(result, fresh)
  assert.equal(result.chatModels.length, 1)
  assert.equal(state.networkCalls, 1)
  assert.deepEqual(state.events, ['get', 'remove', 'request', 'set'])
  assert.equal(state.cache.get(cacheKey), JSON.stringify(fresh))
})

test('malformed cached object is removed and recovered from a valid fresh response', async () => {
  const fresh = validBootstrap()
  await reset(JSON.stringify({ user: null, chatModels: null }), fresh)

  const result = await bootstrapService.getAppBootstrap()

  assert.deepEqual(result, fresh)
  assert.equal(state.networkCalls, 1)
  assert.deepEqual(state.removeCalls, [cacheKey])
  assert.equal(state.cache.get(cacheKey), JSON.stringify(fresh))
})

test('malformed JSON cache is removed before retrying the bootstrap request', async () => {
  const fresh = validBootstrap()
  await reset('{"chatModels":', fresh)

  const result = await bootstrapService.getAppBootstrap()

  assert.deepEqual(result, fresh)
  assert.deepEqual(state.events, ['get', 'remove', 'request', 'set'])
})

test('valid cached bootstrap is reused without a request or rewrite', async () => {
  const cached = validBootstrap()
  await reset(JSON.stringify(cached))

  const result = await bootstrapService.getAppBootstrap()

  assert.deepEqual(result, cached)
  assert.equal(state.networkCalls, 0)
  assert.deepEqual(state.setCalls, [])
  assert.deepEqual(state.removeCalls, [])
})

test('explicit empty model arrays remain valid and are not replaced with defaults', async () => {
  const cached = validBootstrap({ chatModels: [] })
  await reset(JSON.stringify(cached))

  const result = await bootstrapService.getAppBootstrap()

  assert.deepEqual(result.chatModels, [])
  assert.equal(state.networkCalls, 0)
})

test('null fresh bootstrap fails without creating a cache entry', async () => {
  await reset(undefined, null)

  await assert.rejects(bootstrapService.getAppBootstrap(), {
    message: 'Invalid app bootstrap response',
  })

  assert.equal(state.networkCalls, 1)
  assert.deepEqual(state.setCalls, [])
  assert.equal(state.cache.has(cacheKey), false)
  assert.equal(bootstrapService.getCachedBootstrap(), null)
})

test('invalid forced refresh does not replace an existing valid cache', async () => {
  const cached = validBootstrap()
  await reset(JSON.stringify(cached), { ...validBootstrap(), chatModels: null })

  await assert.rejects(bootstrapService.getAppBootstrap({ forceRefresh: true }), {
    message: 'Invalid app bootstrap response',
  })

  assert.equal(state.networkCalls, 1)
  assert.deepEqual(state.getCalls, [])
  assert.deepEqual(state.setCalls, [])
  assert.equal(state.cache.get(cacheKey), JSON.stringify(cached))
})

test('normal forceRefresh bypasses the cache and stores the valid fresh response', async () => {
  const cached = validBootstrap()
  const fresh = validBootstrap({ chatModels: [{
    id: 'model-b',
    name: 'Model B',
    provider: 'openai',
  }] })
  await reset(JSON.stringify(cached), fresh)

  const result = await bootstrapService.getAppBootstrap({ forceRefresh: true })

  assert.deepEqual(result, fresh)
  assert.equal(state.networkCalls, 1)
  assert.deepEqual(state.getCalls, [])
  assert.equal(state.cache.get(cacheKey), JSON.stringify(fresh))
})

test('unknown additive bootstrap and model fields are preserved', async () => {
  const base = validBootstrap()
  const fresh = {
    ...base,
    user: { id: 'user-a', email: 'user@example.test', futureUserField: true },
    entitlements: { tier: 'future-tier', futureEntitlementField: true },
    futureBootstrapField: { enabled: true },
    uiSettings: { ...base.uiSettings, futureSetting: { mode: 'new' } },
    featureFlags: { futureFlag: true },
    capabilities: { ...base.capabilities, futureCapability: true },
    chatModels: [{ ...base.chatModels[0], futureModelField: ['kept'] }],
  }
  await reset(undefined, fresh)

  const result = await bootstrapService.getAppBootstrap({ forceRefresh: true })

  assert.equal(result, fresh)
  assert.deepEqual(result, fresh)
  assert.equal(state.cache.get(cacheKey), JSON.stringify(fresh))
})

test('setCachedBootstrap rejects malformed values before mutating either cache', async () => {
  await reset(undefined)

  await assert.rejects(bootstrapService.setCachedBootstrap(null), {
    message: 'Invalid app bootstrap value',
  })

  assert.deepEqual(state.setCalls, [])
  assert.equal(state.cache.has(cacheKey), false)
  assert.equal(bootstrapService.getCachedBootstrap(), null)
})
