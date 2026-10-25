import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  constantTimeSecret,
  createBrokerServer,
  decrypt,
  encrypt,
  keyFor,
  assertSupportedSubscriptionRequest,
  validAuthorizationUrl,
} from './server.mjs'

const serviceKey = 's'.repeat(48)
const master = Buffer.alloc(32, 7).toString('base64')

test('snapshot encryption is authenticated and scoped to the connection identity', () => {
  process.env.OVERLAY_SUBSCRIPTION_MASTER_KEY = master
  const encrypted = encrypt({ token: 'private' }, 'scope-a')
  assert.equal(decrypt(encrypted, 'scope-a').token, 'private')
  assert.throws(() => decrypt(encrypted, 'scope-b'))
})

test('service key comparison and provider authorization URLs fail closed', () => {
  assert.equal(constantTimeSecret(serviceKey, serviceKey), true)
  assert.equal(constantTimeSecret(serviceKey, `${serviceKey}x`), false)
  assert.equal(validAuthorizationUrl('xai', 'https://accounts.x.ai/login'), 'https://accounts.x.ai/login')
  assert.equal(validAuthorizationUrl('xai', 'https://evil.example/login'), null)
})

test('subscription inference rejects unsupported modalities and ZDR guarantees', () => {
  assert.doesNotThrow(() => assertSupportedSubscriptionRequest({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  }))
  assert.throws(() => assertSupportedSubscriptionRequest({
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/image' } }] }],
  }), /text-only/)
  assert.throws(() => assertSupportedSubscriptionRequest({ zero_data_retention: true }), /zero data retention/)
})

test('broker enforces service authentication, provider allowlist, and owner-bound Codex polling', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overlay-subscription-test-'))
  process.env.OVERLAY_SUBSCRIPTION_MASTER_KEY = master
  process.env.OVERLAY_SUBSCRIPTION_RUNTIME_DIR = path.join(root, 'runtime')
  process.env.OVERLAY_SUBSCRIPTION_STATE_DIR = path.join(root, 'state')
  process.env.OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS = 'codex'
  const server = await createBrokerServer({ host: '127.0.0.1', port: 0, serviceKey })
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(async () => {
    await server.shutdown()
    delete process.env.OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS
    await rm(root, { recursive: true, force: true })
  })
  const address = server.address()
  const endpoint = `http://127.0.0.1:${address.port}`
  const post = async (route, body, key = serviceKey) => await fetch(`${endpoint}${route}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  assert.equal((await fetch(`${endpoint}/healthz`)).status, 401)
  assert.equal((await post('/v1/subscriptions/start', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'anthropic',
  })).status, 400)
  assert.equal((await post('/v1/subscriptions/start', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })).status, 400)
  assert.equal((await post('/v1/subscriptions/start-codex', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    deviceAuthId: 'device', userCode: 'CODE', expiresAt: Date.now() + 60_000, interval: 5,
  })).status, 200)
  assert.equal((await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })).status, 400)
  const foreignPoll = await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-b', connectionId: 'conn-a', providerId: 'codex',
  })
  assert.equal(foreignPoll.status, 404)
  const firstPoll = await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
  })
  const lease = await firstPoll.json()
  assert.equal(lease.status, 'pending')
  assert.equal(typeof lease.authorizationGeneration, 'string')
  assert.equal(typeof lease.pollLease?.token, 'string')
  const tokenSet = {
    idToken: 'i'.repeat(32),
    accessToken: 'a'.repeat(32),
    refreshToken: 'r'.repeat(32),
    lastRefresh: Date.now(),
    accountId: 'account-1',
  }
  assert.equal((await post('/v1/subscriptions/import-codex', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
    authorizationGeneration: lease.authorizationGeneration,
    pollLease: lease.pollLease.token,
    tokens: tokenSet,
  })).status, 400)
  assert.equal((await post('/v1/subscriptions/codex-release', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
    authorizationGeneration: lease.authorizationGeneration,
    pollLease: lease.pollLease.token,
  })).status, 400)
  const staleGenerationImport = await post('/v1/subscriptions/import-codex', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    authorizationGeneration: `${lease.authorizationGeneration}-stale`,
    pollLease: lease.pollLease.token,
    tokens: tokenSet,
  })
  assert.equal(staleGenerationImport.status, 403)
  const staleLeaseImport = await post('/v1/subscriptions/import-codex', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    authorizationGeneration: lease.authorizationGeneration,
    pollLease: `${lease.pollLease.token}-stale`,
    tokens: tokenSet,
  })
  assert.equal(staleLeaseImport.status, 403)
  const duplicatePoll = await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
  })
  assert.equal((await duplicatePoll.json()).status, 'polling')
  const staleRelease = await post('/v1/subscriptions/codex-release', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    authorizationGeneration: lease.authorizationGeneration,
    pollLease: `${lease.pollLease.token}-stale`,
  })
  assert.deepEqual(await staleRelease.json(), { released: false })
  const currentRelease = await post('/v1/subscriptions/codex-release', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    authorizationGeneration: lease.authorizationGeneration,
    pollLease: lease.pollLease.token,
  })
  assert.deepEqual(await currentRelease.json(), { released: true })
  const renewedPoll = await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
  })
  const renewedLease = await renewedPoll.json()
  assert.equal(renewedLease.status, 'pending')
  const staleReleaseAfterRenewal = await post('/v1/subscriptions/codex-release', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    authorizationGeneration: lease.authorizationGeneration,
    pollLease: lease.pollLease.token,
  })
  assert.deepEqual(await staleReleaseAfterRenewal.json(), { released: false })
  assert.equal((await post('/v1/subscriptions/start-codex', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    deviceAuthId: 'device-auth-2', userCode: 'CODE2',
    expiresAt: Date.now() + 60_000, interval: 5,
  })).status, 200)
  const staleImportAfterReconnect = await post('/v1/subscriptions/import-codex', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    authorizationGeneration: lease.authorizationGeneration,
    pollLease: renewedLease.pollLease.token,
    tokens: tokenSet,
  })
  assert.equal(staleImportAfterReconnect.status, 403)
  const staleReleaseAfterReconnect = await post('/v1/subscriptions/codex-release', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    authorizationGeneration: lease.authorizationGeneration,
    pollLease: renewedLease.pollLease.token,
  })
  assert.deepEqual(await staleReleaseAfterReconnect.json(), { released: false })
  assert.equal((await post('/v1/subscriptions/disconnect', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
  })).status, 200)
  assert.equal((await post('/v1/subscriptions/import-codex', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    authorizationGeneration: renewedLease.authorizationGeneration,
    pollLease: renewedLease.pollLease.token,
    tokens: tokenSet,
  })).status, 404)
})

test('isolates owners, persists rotated credentials, preserves selections, and serializes disconnect', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overlay-subscription-lifecycle-'))
  const binary = path.join(root, 'fake-cli.mjs')
  await writeFile(binary, `#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
const args = parseArgs({ args: process.argv.slice(2), strict: false, options: { config: { type: 'string' } } })
const config = JSON.parse(await readFile(args.values.config, 'utf8'))
const authDir = config.oauth['auth-dir']
const managementKey = config['remote-management']['secret-key']
const credential = (token) => JSON.stringify({ type: 'xai', access_token: token, refresh_token: 'refresh', email: 'account@example.test' })
const devinCredential = JSON.stringify({ type: 'devin', session_token: 'session-token', raw_token: 'raw-token' })
const metaCredential = JSON.stringify({ type: 'meta', dca_token: 'dca-token' })
const statusCalls = new Map()
const body = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/healthz') return response.end('ok')
  if (request.headers.authorization !== 'Bearer ' + managementKey &&
      url.pathname.startsWith('/v8/management')) { response.writeHead(401); return response.end() }
  if (url.pathname === '/v8/management/oauth/auth-url') {
    const provider = url.searchParams.get('provider')
    const state = provider + '-state'
    if (provider === 'xai') {
      setTimeout(() => writeFile(authDir + '/xai-account@example.test.json', credential('token-initial')), 40)
    }
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({
      url: ({
        devin: 'https://app.devin.ai/oauth',
        meta: 'https://auth.meta.com/oauth',
      })[provider] ?? 'https://accounts.x.ai/login',
      state, expires_in: 900, interval: 2,
    }))
  }
  if (url.pathname === '/v8/management/credentials') {
    const name = url.searchParams.get('name')
    const value = await body(request)
    await writeFile(authDir + '/' + name, JSON.stringify(value))
    response.setHeader('content-type', 'application/json')
    return response.end('{"ok":true}')
  }
  if (url.pathname === '/v8/management/oauth/status') {
    const state = url.searchParams.get('state')
    const calls = (statusCalls.get(state) ?? 0) + 1
    statusCalls.set(state, calls)
    if (calls === 1) {
      response.setHeader('content-type', 'application/json')
      return response.end(JSON.stringify({ status: 'wait' }))
    }
    if (state === 'devin-state') await writeFile(authDir + '/devin-user.json', devinCredential)
    if (state === 'meta-state') await writeFile(authDir + '/meta-user.json', metaCredential)
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({ status: 'ok' }))
  }
  if (url.pathname === '/v8/management/oauth/callback') {
    await writeFile(authDir + '/.oauth-devin-devin-state.oauth', '{"state":"devin-state"}')
    await writeFile(authDir + '/.oauth-callback-temp', '{"state":"devin-state"}')
    response.setHeader('content-type', 'application/json')
    return response.end('{"ok":true}')
  }
  if (url.pathname === '/v1/models') {
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({ data: [{ id: 'model-a', display_name: 'Model A' }, { id: 'model-b', display_name: 'Model B' }] }))
  }
  if (url.pathname === '/v1/chat/completions') {
    const value = await body(request)
    if (value.rotate) {
      const path = authDir + '/xai-account@example.test.json'
      await writeFile(path, '{"type":"xai","access_token":"rotated')
      setTimeout(() => writeFile(path, credential('token-rotated')), 50)
    }
    if (value.slow) await new Promise((resolve) => setTimeout(resolve, 250))
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({ id: 'fake', choices: [{ message: { role: 'assistant', content: 'ok' } }] }))
  }
  if (url.pathname === '/v1/responses') {
    const value = await body(request)
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({ id: 'responses-fake', tools: value.tools }))
  }
  response.writeHead(404); response.end()
})
server.listen(config.port, '127.0.0.1')
`, { mode: 0o700 })
  await chmod(binary, 0o700)
  process.env.OVERLAY_SUBSCRIPTION_MASTER_KEY = master
  process.env.OVERLAY_SUBSCRIPTION_RUNTIME_DIR = path.join(root, 'runtime')
  process.env.OVERLAY_SUBSCRIPTION_STATE_DIR = path.join(root, 'state')
  process.env.OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS = 'codex,xai,meta,devin'
  process.env.CLIPROXYAPI_BIN = binary
  let server = await createBrokerServer({ host: '127.0.0.1', port: 0, serviceKey })
  await new Promise((resolve) => server.once('listening', resolve))
  const endpoint = () => `http://127.0.0.1:${server.address().port}`
  const post = async (route, body, signal, ownerId = 'owner-a', connectionId = 'conn-a') => await fetch(`${endpoint()}${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json',
      ...(route.startsWith('/v1/chat/') || route === '/v1/responses' ? {
        'x-overlay-owner-id': ownerId, 'x-overlay-connection-id': connectionId,
      } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })
  t.after(async () => {
    await server.shutdown().catch(() => {})
    delete process.env.CLIPROXYAPI_BIN
    delete process.env.OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS
    delete process.env.OVERLAY_SUBSCRIPTION_MASTER_KEY
    delete process.env.OVERLAY_SUBSCRIPTION_RUNTIME_DIR
    delete process.env.OVERLAY_SUBSCRIPTION_STATE_DIR
    await rm(root, { recursive: true, force: true })
  })

  const started = await post('/v1/subscriptions/start', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })
  assert.equal(started.status, 200)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const pendingIdentity = keyFor('owner-a', 'conn-a')
  const pendingRecord = decrypt(
    await readFile(path.join(root, 'state', `${pendingIdentity}.enc`), 'utf8'),
    `overlay-subscription:${pendingIdentity}`,
  )
  assert.equal(pendingRecord.status, 'pending')
  assert.deepEqual(pendingRecord.authFiles, {})
  const firstPendingPoll = await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })
  assert.equal((await firstPendingPoll.json()).status, 'pending')
  assert.equal((await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })).status, 200)
  const firstConnectedPoll = await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })
  assert.equal((await firstConnectedPoll.json()).status, 'connected')
  const responsesTool = {
    type: 'function',
    name: 'overlay_tool',
    parameters: { type: 'object', properties: {} },
    strict: true,
    description: 'A local Overlay tool',
  }
  const codexStart = await post('/v1/subscriptions/start-codex', {
    ownerId: 'owner-a',
    connectionId: 'codex-conn',
    providerId: 'codex',
    deviceAuthId: 'device-auth',
    userCode: 'CODE',
    expiresAt: Date.now() + 60_000,
    interval: 5,
  })
  assert.equal(codexStart.status, 200)
  const codexLeaseResponse = await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-a', connectionId: 'codex-conn', providerId: 'codex',
  })
  const codexLease = await codexLeaseResponse.json()
  const codexImport = await post('/v1/subscriptions/import-codex', {
    ownerId: 'owner-a',
    connectionId: 'codex-conn',
    providerId: 'codex',
    authorizationGeneration: codexLease.authorizationGeneration,
    pollLease: codexLease.pollLease.token,
    tokens: {
      idToken: 'i'.repeat(32),
      accessToken: 'a'.repeat(32),
      refreshToken: 'r'.repeat(32),
      lastRefresh: Date.now(),
      accountId: 'account-2',
      expired: new Date(Date.now() + 60_000).toISOString(),
    },
  })
  assert.equal(codexImport.status, 200)
  const responsesRequest = await post('/v1/responses', {
    model: 'model-a', input: 'hello', tools: [responsesTool],
  }, undefined, 'owner-a', 'codex-conn')
  assert.equal(responsesRequest.status, 200)
  assert.deepEqual((await responsesRequest.json()).tools, [responsesTool])
  assert.equal((await post('/v1/responses', {
    model: 'model-a', input: 'hello',
    tools: [{ type: 'function', function: { name: 'nested', parameters: { type: 'object' } } }],
  }, undefined, 'owner-a', 'codex-conn')).status, 400)
  assert.equal((await post('/v1/responses', {
    model: 'model-a', input: 'hello', tools: [{ type: 'web_search_preview' }],
  }, undefined, 'owner-a', 'codex-conn')).status, 400)
  assert.equal((await post('/v1/responses', {
    model: 'model-a', input: 'hello', tools: [{ type: 'computer_use_preview' }],
  }, undefined, 'owner-a', 'codex-conn')).status, 400)
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }],
    tools: [{ type: 'function', name: 'flat', parameters: { type: 'object' } }],
  })).status, 400)
  assert.equal((await post('/v1/subscriptions/models', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai', enabledModelIds: ['model-a'],
  })).status, 200)
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{
      type: 'function',
      function: { name: 'chat_tool', parameters: { type: 'object', properties: {} } },
    }],
  })).status, 200)
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }],
  }, undefined, 'owner-b', 'conn-a')).status, 404)
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-b', messages: [{ role: 'user', content: 'hello' }],
  })).status, 403)
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }], rotate: true,
  })).status, 200)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const identity = keyFor('owner-a', 'conn-a')
  const snapshotPath = path.join(root, 'state', `${identity}.enc`)
  const rotated = decrypt(await readFile(snapshotPath, 'utf8'), `overlay-subscription:${identity}`)
  assert.match(rotated.authFiles['xai-account@example.test.json'], /token-rotated/)
  assert.equal((await post('/v1/subscriptions/models', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai', enabledModelIds: [],
  })).status, 200)
  const refresh = await post('/v1/subscriptions/refresh', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })
  assert.equal(refresh.status, 200)
  assert.deepEqual((await refresh.json()).models.map((model) => model.id), ['model-a', 'model-b'])
  assert.equal((await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })).status, 200)
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }],
  })).status, 403)
  assert.equal((await post('/v1/subscriptions/models', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai', enabledModelIds: ['model-a'],
  })).status, 200)

  await server.shutdown()
  server = await createBrokerServer({ host: '127.0.0.1', port: 0, serviceKey })
  await new Promise((resolve) => server.once('listening', resolve))
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }],
  })).status, 200)

  const devinStarted = await post('/v1/subscriptions/start', {
    ownerId: 'owner-a', connectionId: 'devin-conn', providerId: 'devin',
  })
  assert.equal(devinStarted.status, 200)
  const badCallback = await post('/v1/subscriptions/callback', {
    ownerId: 'owner-a', connectionId: 'devin-conn', providerId: 'devin',
    callbackUrl: 'https://evil.example/callback?state=devin-state&code=code',
  })
  assert.equal(badCallback.status, 400)
  assert.equal((await post('/v1/subscriptions/callback', {
    ownerId: 'owner-a', connectionId: 'devin-conn', providerId: 'xai',
    callbackUrl: 'http://127.0.0.1/callback?state=devin-state&code=code',
  })).status, 400)
  const wrongStateCallback = await post('/v1/subscriptions/callback', {
    ownerId: 'owner-a', connectionId: 'devin-conn', providerId: 'devin',
    callbackUrl: 'http://127.0.0.1/callback?state=wrong-state&code=code',
  })
  assert.equal(wrongStateCallback.status, 400)
  const callback = await post('/v1/subscriptions/callback', {
    ownerId: 'owner-a', connectionId: 'devin-conn', providerId: 'devin',
    callbackUrl: 'http://127.0.0.1/callback?state=devin-state&code=code',
  })
  assert.deepEqual(await callback.json(), { status: 'pending' })
  const devinIdentity = keyFor('owner-a', 'devin-conn')
  const callbackRecord = decrypt(
    await readFile(path.join(root, 'state', `${devinIdentity}.enc`), 'utf8'),
    `overlay-subscription:${devinIdentity}`,
  )
  assert.deepEqual(callbackRecord.authFiles, {})
  const firstDevinPoll = await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'devin-conn', providerId: 'devin',
  })
  assert.equal((await firstDevinPoll.json()).status, 'pending')
  assert.equal((await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'devin-conn', providerId: 'devin',
  })).status, 200)
  const connectedDevinRecord = decrypt(
    await readFile(path.join(root, 'state', `${devinIdentity}.enc`), 'utf8'),
    `overlay-subscription:${devinIdentity}`,
  )
  assert.match(connectedDevinRecord.authFiles['devin-user.json'], /session_token/)

  const metaStarted = await post('/v1/subscriptions/start', {
    ownerId: 'owner-a', connectionId: 'meta-conn', providerId: 'meta',
  })
  assert.equal(metaStarted.status, 200)
  const firstMetaPoll = await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'meta-conn', providerId: 'meta',
  })
  assert.equal((await firstMetaPoll.json()).status, 'pending')
  assert.equal((await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'meta-conn', providerId: 'meta',
  })).status, 200)
  const metaIdentity = keyFor('owner-a', 'meta-conn')
  const connectedMetaRecord = decrypt(
    await readFile(path.join(root, 'state', `${metaIdentity}.enc`), 'utf8'),
    `overlay-subscription:${metaIdentity}`,
  )
  assert.match(connectedMetaRecord.authFiles['meta-user.json'], /dca_token/)

  const aborted = new AbortController()
  const slow = post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }], slow: true,
  }, aborted.signal)
  setTimeout(() => aborted.abort(), 30)
  await assert.rejects(slow)
  assert.equal((await post('/v1/subscriptions/disconnect', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })).status, 200)
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }],
  })).status, 404)

  await server.shutdown()
  server = await createBrokerServer({ host: '127.0.0.1', port: 0, serviceKey })
  await new Promise((resolve) => server.once('listening', resolve))
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }],
  })).status, 404)
})
