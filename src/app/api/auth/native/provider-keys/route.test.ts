import assert from 'node:assert/strict'
import test from 'node:test'

import { POST } from './route'

test('native provider credential delivery is permanently disabled', async () => {
  const response = await POST()
  const body = (await response.json()) as Record<string, unknown>

  assert.equal(response.status, 410)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(response.headers.get('pragma'), 'no-cache')
  assert.equal(body.code, 'provider_credentials_server_only')
  assert.equal('keys' in body, false)
})
