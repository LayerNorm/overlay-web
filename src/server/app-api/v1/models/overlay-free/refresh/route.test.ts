import assert from 'node:assert/strict'
import test from 'node:test'

import { POST } from './route'

test('private refresh callback rejects requests without the internal secret and disables caching', async () => {
  const response = await POST(new Request('http://localhost/api/v1/models/overlay-free/refresh', {
    method: 'POST',
  }))

  assert.equal(response.status, 401)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})
