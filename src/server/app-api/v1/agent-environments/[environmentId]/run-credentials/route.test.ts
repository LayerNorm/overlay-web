import assert from 'node:assert/strict'
import test from 'node:test'
import { POST } from './route'

test('legacy run-credentials endpoint returns an explicit retirement response', async () => {
  const response = await POST()
  assert.equal(response.status, 410)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), {
    error: 'Hosted runtime credential delivery is retired.',
    code: 'hosted_runtime_retired',
  })
})
