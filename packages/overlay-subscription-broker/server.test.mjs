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
  assert.equal((await post('/v1/subscriptions/start-codex', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
    deviceAuthId: 'device', userCode: 'CODE', expiresAt: Date.now() + 60_000, interval: 5,
  })).status, 200)
  const foreignPoll = await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-b', connectionId: 'conn-a', providerId: 'codex',
  })
  assert.equal(foreignPoll.status, 404)
  const firstPoll = await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
  })
  assert.equal((await firstPoll.json()).status, 'pending')
  const duplicatePoll = await post('/v1/subscriptions/codex-device', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
  })
  assert.equal((await duplicatePoll.json()).status, 'polling')
  await post('/v1/subscriptions/codex-release', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'codex',
  })
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
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({ url: 'https://accounts.x.ai/login', state: 'state-1', expires_in: 900, interval: 2 }))
  }
  if (url.pathname === '/v8/management/oauth/status') {
    await writeFile(authDir + '/xai.json', credential('token-initial'))
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({ status: 'ok' }))
  }
  if (url.pathname === '/v1/models') {
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({ data: [{ id: 'model-a', display_name: 'Model A' }, { id: 'model-b', display_name: 'Model B' }] }))
  }
  if (url.pathname === '/v1/chat/completions') {
    const value = await body(request)
    if (value.rotate) await writeFile(authDir + '/xai.json', credential('token-rotated'))
    if (value.slow) await new Promise((resolve) => setTimeout(resolve, 250))
    response.setHeader('content-type', 'application/json')
    return response.end(JSON.stringify({ id: 'fake', choices: [{ message: { role: 'assistant', content: 'ok' } }] }))
  }
  response.writeHead(404); response.end()
})
server.listen(config.port, '127.0.0.1')
`, { mode: 0o700 })
  await chmod(binary, 0o700)
  process.env.OVERLAY_SUBSCRIPTION_MASTER_KEY = master
  process.env.OVERLAY_SUBSCRIPTION_RUNTIME_DIR = path.join(root, 'runtime')
  process.env.OVERLAY_SUBSCRIPTION_STATE_DIR = path.join(root, 'state')
  process.env.OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS = 'xai'
  process.env.CLIPROXYAPI_BIN = binary
  let server = await createBrokerServer({ host: '127.0.0.1', port: 0, serviceKey })
  await new Promise((resolve) => server.once('listening', resolve))
  const endpoint = () => `http://127.0.0.1:${server.address().port}`
  const post = async (route, body, signal, ownerId = 'owner-a', connectionId = 'conn-a') => await fetch(`${endpoint()}${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json',
      ...(route.startsWith('/v1/chat/') ? {
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
    await rm(root, { recursive: true, force: true })
  })

  const started = await post('/v1/subscriptions/start', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })
  assert.equal(started.status, 200)
  assert.equal((await post('/v1/subscriptions/poll', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai',
  })).status, 200)
  assert.equal((await post('/v1/subscriptions/models', {
    ownerId: 'owner-a', connectionId: 'conn-a', providerId: 'xai', enabledModelIds: ['model-a'],
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
  assert.match(decrypt(await readFile(snapshotPath, 'utf8'), `overlay-subscription:${identity}`).authFiles['xai.json'], /token-rotated/)

  await server.shutdown()
  server = await createBrokerServer({ host: '127.0.0.1', port: 0, serviceKey })
  await new Promise((resolve) => server.once('listening', resolve))
  assert.equal((await post('/v1/chat/completions', {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }],
  })).status, 200)

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
