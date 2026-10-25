import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
  const server = await createBrokerServer({ host: '127.0.0.1', port: 0, serviceKey })
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
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
