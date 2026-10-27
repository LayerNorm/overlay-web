import assert from 'node:assert/strict'
import test from 'node:test'

import { deleteByokVaultKey, writeByokVaultKey } from './byok-vault'

test('Vault writes reject redirects and do not expose upstream error bodies', async (t) => {
  const previousApiKey = process.env.WORKOS_API_KEY
  process.env.WORKOS_API_KEY = 'workos_test_key'
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.WORKOS_API_KEY
    else process.env.WORKOS_API_KEY = previousApiKey
  })

  let capturedInit: RequestInit | undefined
  t.mock.method(globalThis, 'fetch', async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedInit = init
    return new Response(JSON.stringify({ message: 'sensitive upstream detail' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'x-request-id': 'sensitive-request-id' },
    })
  })
  const log = t.mock.method(console, 'error', () => undefined)

  await assert.rejects(
    () => writeByokVaultKey('byok_user_connection', 'provider_test_key', {
      purpose: 'byok-provider-key',
      userId: 'user_1',
      providerId: 'openrouter',
    }),
    (error) => {
      assert.equal(error instanceof Error, true)
      assert.equal((error as Error).message, 'Failed to store API key in vault')
      assert.equal((error as Error).message.includes('sensitive upstream detail'), false)
      return true
    },
  )

  assert.equal(capturedInit?.redirect, 'error')
  assert.equal(capturedInit?.cache, 'no-store')
  assert.equal(new Headers(capturedInit?.headers).get('authorization'), 'Bearer workos_test_key')
  assert.equal(log.mock.callCount(), 1)
  const logged = String(log.mock.calls[0].arguments[0])
  assert.deepEqual(JSON.parse(logged).context, { code: 'http_failure', httpStatus: 400 })
  for (const sensitive of ['sensitive upstream detail', 'sensitive-request-id', 'workos_test_key', 'provider_test_key', 'user_1']) {
    assert.equal(logged.includes(sensitive), false)
  }
})

test('Vault diagnostics distinguish missing configuration without attempting a request', async (t) => {
  const previousApiKey = process.env.WORKOS_API_KEY
  delete process.env.WORKOS_API_KEY
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.WORKOS_API_KEY
    else process.env.WORKOS_API_KEY = previousApiKey
  })
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch') })
  const log = t.mock.method(console, 'error', () => undefined)
  await assert.rejects(writeByokVaultKey('byok_test', 'sensitive', {
    purpose: 'subscription-credential', userId: 'user_1', providerId: 'subscription:codex',
  }), { message: 'Failed to store API key in vault' })
  assert.equal(fetch.mock.callCount(), 0)
  assert.deepEqual(JSON.parse(String(log.mock.calls[0].arguments[0])).context, { code: 'missing_configuration' })
})

test('Vault diagnostics never log transport messages or malformed success bodies', async (t) => {
  const previousApiKey = process.env.WORKOS_API_KEY
  process.env.WORKOS_API_KEY = 'workos_test_key'
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.WORKOS_API_KEY
    else process.env.WORKOS_API_KEY = previousApiKey
  })
  let transportFailure = true
  t.mock.method(globalThis, 'fetch', async () => {
    if (transportFailure) throw new Error('sensitive transport detail')
    return new Response('sensitive malformed success')
  })
  const log = t.mock.method(console, 'error', () => undefined)
  for (const code of ['transport_failure', 'invalid_response']) {
    await assert.rejects(writeByokVaultKey('byok_test', 'sensitive', {
      purpose: 'subscription-credential', userId: 'user_1', providerId: 'subscription:codex',
    }), { message: 'Failed to store API key in vault' })
    const logged = String(log.mock.calls.at(-1)?.arguments[0])
    assert.deepEqual(JSON.parse(logged).context, { code })
    assert.equal(logged.includes('sensitive'), false)
    transportFailure = false
  }
})

test('Vault DELETE treats an already-deleted object as success', async (t) => {
  process.env.WORKOS_API_KEY = 'workos_test_key'
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  await deleteByokVaultKey('already-deleted')
})
