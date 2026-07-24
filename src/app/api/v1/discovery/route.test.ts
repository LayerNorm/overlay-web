import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { GET } from './route'

test('public discovery exposes only versioned non-secret server metadata', async () => {
  const response = await GET(new NextRequest('https://overlay.example/api/v1/discovery'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json() as Record<string, unknown>
  assert.deepEqual(body.api, { currentVersion: 'v1', supportedVersions: ['v1'] })
  assert.deepEqual(body.deployment, { id: 'https://overlay.example' })
  assert.equal(
    (body.nativeAuth as { browserHandoffPath?: unknown }).browserHandoffPath,
    '/account',
  )
  assert.equal(JSON.stringify(body).match(/secret|apiKey|tokenValue|internalTopology/), null)
})

test('public discovery reports hosted inference unavailable while the emergency kill switch is active', async (t) => {
  const previous = process.env.OVERLAY_HOSTED_PROVIDER_KILL_SWITCH
  process.env.OVERLAY_HOSTED_PROVIDER_KILL_SWITCH = '1'
  t.after(() => {
    if (previous === undefined) delete process.env.OVERLAY_HOSTED_PROVIDER_KILL_SWITCH
    else process.env.OVERLAY_HOSTED_PROVIDER_KILL_SWITCH = previous
  })

  const response = await GET(new NextRequest('https://overlay.example/api/v1/discovery'))
  const body = await response.json() as { capabilities: { hostedInference: boolean } }
  assert.equal(body.capabilities.hostedInference, false)
})
