import assert from 'node:assert/strict'
import test from 'node:test'
import { POST } from './route'

test('projection callback refuses member sessions before reading SDK state', async () => {
  const response = await POST(new Request('https://example.test/api/v1/automations/project-events', {
    method: 'POST', headers: {cookie: 'overlay_session=member'}, body: '{}',
  }), async () => assert.fail('Unauthenticated callback must not read SDK events'))
  assert.equal(response.status, 401)
})
