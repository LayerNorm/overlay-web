import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { after, before, test } from 'node:test'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

const origin = 'https://fixture.example'
const secret = 'proxy-test-session-secret'
const originalEnv = { ...process.env }

before(() => {
  delete process.env.OVERLAY_DEPLOYMENT_ENV
  process.env.SESSION_SECRET = secret
})
after(() => { process.env = originalEnv })

for (const scenario of [
  { name: 'WorkOS missing session', provider: 'workos', cookie: '' },
  { name: 'WorkOS invalid session signature', provider: 'workos', cookie: 'overlay_session=invalid.signature' },
  { name: 'Better Auth missing session', provider: 'better-auth', cookie: '' },
]) {
  test(`${scenario.name} preserves the protected path and complete query`, async () => {
    process.env.AUTH_PROVIDER = scenario.provider
    const destination = '/account?desktop_code_challenge=pkce-fixture&return=%2Fapp%3Fx%3D1&tag=a&tag=b'
    const response = await proxy(new NextRequest(origin + destination, {
      headers: { cookie: scenario.cookie },
    }))
    assert.equal(response.status, 307)
    const location = new URL(response.headers.get('location')!)
    assert.equal(location.origin, origin)
    assert.equal(location.pathname, '/auth/sign-in')
    assert.equal(location.searchParams.get('redirect'), destination)
  })

  test(`${scenario.name} keeps protected API requests as 401 JSON`, async () => {
    process.env.AUTH_PROVIDER = scenario.provider
    const response = await proxy(new NextRequest(origin + '/api/entitlements?redirect=https%3A%2F%2Foutside.example', {
      headers: { cookie: scenario.cookie },
    }))
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('location'), null)
    assert.equal(typeof (await response.json()).error, 'string')
  })
}

test('an authenticated account alias preserves query parameters and selects account settings', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const payload = 'synthetic-session-payload'
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  const response = await proxy(new NextRequest(origin + '/account?desktop_code_challenge=pkce-fixture&section=other', {
    headers: { cookie: `overlay_session=${payload}.${signature}` },
  }))
  assert.equal(response.status, 307)
  const location = new URL(response.headers.get('location')!)
  assert.equal(location.origin, origin)
  assert.equal(location.pathname, '/app/settings')
  assert.equal(location.searchParams.get('desktop_code_challenge'), 'pkce-fixture')
  assert.equal(location.searchParams.get('section'), 'account')
})

test('a query containing an external URL stays inside the local return path', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const destination = '/account?redirect=https%3A%2F%2Foutside.example'
  const response = await proxy(new NextRequest(origin + destination))
  const location = new URL(response.headers.get('location')!)
  assert.equal(location.origin, origin)
  assert.equal(location.searchParams.get('redirect'), destination)
})
