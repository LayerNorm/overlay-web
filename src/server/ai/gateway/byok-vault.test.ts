import assert from 'node:assert/strict'
import test from 'node:test'

import { logger } from '@/server/observability/logger'
import { writeByokVaultKey } from './byok-vault'

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
      headers: { 'content-type': 'application/json' },
    })
  })
  t.mock.method(logger, 'error', () => undefined)

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
})
