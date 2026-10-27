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

test('an authenticated account route stays at the canonical route', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const payload = 'synthetic-session-payload'
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  const response = await proxy(new NextRequest(origin + '/account?desktop_code_challenge=pkce-fixture&section=other', {
    headers: { cookie: `overlay_session=${payload}.${signature}` },
  }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('location'), null)
})

test('legacy account settings and app account paths redirect to canonical account', async () => {
  for (const path of [
    '/app/settings?section=account&billing=return',
    '/app/account?handoff=desktop',
    '/w/acme/workspace/settings?section=account&return=%2Fapp%2Fwork',
  ]) {
    const response = await proxy(new NextRequest(origin + path))
    const location = new URL(response.headers.get('location')!)
    assert.equal(response.status, 307)
    assert.equal(location.pathname, '/account')
    assert.equal(location.searchParams.has('section'), false)
  }
})

test('retired showcase and explore routes redirect before application subscriptions', async () => {
  for (const path of [
    '/explore/chat',
    '/app/chat?showcase=1&id=showcase-welcome',
    '/app/agents?id=showcase-agent-welcome',
    '/app/agents/showcase-research',
    '/api/public/showcase/ask',
  ]) {
    const response = await proxy(new NextRequest(origin + path))
    const location = new URL(response.headers.get('location')!)
    assert.equal(response.status, 307)
    assert.equal(location.pathname, '/home')
    assert.equal(location.search, '')
  }
})

test('a query containing an external URL stays inside the local return path', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const destination = '/account?redirect=https%3A%2F%2Foutside.example'
  const response = await proxy(new NextRequest(origin + destination))
  const location = new URL(response.headers.get('location')!)
  assert.equal(location.origin, origin)
  assert.equal(location.searchParams.get('redirect'), destination)
})

test('signed-out handle routes preserve a local return path and query', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const response = await proxy(new NextRequest(origin + '/w/acme-labs/agents/agent_1?tab=activity'))
  assert.equal(response.status, 307)
  const location = new URL(response.headers.get('location')!)
  assert.equal(location.pathname, '/auth/sign-in')
  assert.equal(location.searchParams.get('redirect'), '/w/acme-labs/agents/agent_1?tab=activity')
})

test('authenticated handle roots redirect to canonical Personal Work without leaking selectors', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const payload = 'synthetic-workspace-session'
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  const response = await proxy(new NextRequest(origin + '/w/acme?workspaceId=other&tab=activity', {
    headers: { cookie: `overlay_session=${payload}.${signature}` },
  }))
  const location = new URL(response.headers.get('location')!)
  assert.equal(response.status, 307)
  assert.equal(location.pathname, '/w/acme/personal/work')
  assert.equal(location.searchParams.get('workspaceId'), null)
  assert.equal(location.searchParams.get('tab'), 'activity')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
})

test('scoped canonical handle rewrites trust path scope over query and forged metadata', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const payload = 'synthetic-scoped-workspace-session'
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  const cookie = `overlay_session=${payload}.${signature}`
  const conflict = await proxy(new NextRequest(origin + '/w/acme/workspace/chat?scope=personal', {
    headers: { cookie },
  }))
  assert.equal(conflict.status, 307)
  assert.equal(new URL(conflict.headers.get('location')!).searchParams.get('scope'), null)
  assert.equal(new URL(conflict.headers.get('location')!).searchParams.get('view'), 'workspace-chats')
  const response = await proxy(new NextRequest(origin + '/w/acme/workspace/chat?view=workspace-chats', {
    headers: {
      cookie,
      'x-overlay-workspace-scope': 'personal',
      'x-overlay-workspace-original-path': '/w/forged/personal/files',
    },
  }))
  const rewrite = new URL(response.headers.get('x-middleware-rewrite')!)
  assert.equal(rewrite.pathname, '/app/chat')
  assert.equal(rewrite.searchParams.get('scope'), 'workspace')
  assert.equal(rewrite.searchParams.get('workspaceHandle'), 'acme')
  assert.equal(rewrite.searchParams.get('workspaceId'), null)
  assert.equal(response.headers.get('x-middleware-request-x-overlay-workspace-scope'), 'workspace')
  assert.equal(response.headers.get('x-middleware-request-x-overlay-workspace-original-path'), '/w/acme/workspace/chat')
  assert.equal(response.headers.get('x-middleware-request-x-overlay-workspace-id'), null)
})

test('authenticated API workspace selection survives proxy page-metadata stripping', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const payload = 'synthetic-api-workspace-session'
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  const response = await proxy(new NextRequest(origin + '/api/v1/work', {
    headers: {
      cookie: `overlay_session=${payload}.${signature}`,
      'x-overlay-workspace-id': 'native-workspace-id',
      'x-overlay-workspace-handle': 'forged',
      'x-overlay-workspace-scope': 'forged',
    },
  }))
  assert.equal(response.headers.get('x-middleware-request-x-overlay-workspace-id'), 'native-workspace-id')
  assert.equal(response.headers.get('x-middleware-request-x-overlay-workspace-handle'), null)
  assert.equal(response.headers.get('x-middleware-request-x-overlay-workspace-scope'), null)
})

test('legacy workspace rewrites preserve ID casing and reject unsupported nested paths', async () => {
  process.env.AUTH_PROVIDER = 'workos'
  const payload = 'synthetic-legacy-session'
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  const cookie = `overlay_session=${payload}.${signature}`
  const valid = await proxy(new NextRequest(origin + '/app/w/Legacy_ID/agents/Agent_X', { headers: { cookie } }))
  assert.equal(new URL(valid.headers.get('x-middleware-rewrite')!).searchParams.get('workspaceId'), 'Legacy_ID')
  const invalid = await proxy(new NextRequest(origin + '/w/acme/agents/agent_1/chat', { headers: { cookie } }))
  assert.equal(invalid.headers.get('x-middleware-rewrite'), null)
  const invalidSurface = await proxy(new NextRequest(origin + '/w/acme/does-not-exist', { headers: { cookie } }))
  assert.equal(invalidSurface.headers.get('x-middleware-rewrite'), null)
  assert.equal(invalidSurface.status, 404)
  assert.equal(invalidSurface.headers.get('cache-control'), 'private, no-store')
  assert.equal(invalidSurface.headers.get('x-robots-tag'), 'noindex, nofollow')
  const invalidScope = await proxy(new NextRequest(origin + '/w/acme/team/work', { headers: { cookie } }))
  assert.equal(invalidScope.headers.get('x-middleware-rewrite'), null)
  assert.equal(invalidScope.status, 404)
  const malformedChat = await proxy(new NextRequest(origin + '/w/acme/personal/chat/dms', { headers: { cookie } }))
  assert.equal(malformedChat.headers.get('x-middleware-rewrite'), null)
  assert.equal(malformedChat.status, 404)
  const separator = await proxy(new NextRequest(origin + '/w/acme%2Fother', { headers: { cookie } }))
  assert.equal(separator.headers.get('x-middleware-rewrite'), null)
  assert.equal(separator.status, 404)
  const dottedHandle = await proxy(new NextRequest(origin + '/w/acme.test/personal/work', { headers: { cookie } }))
  assert.equal(dottedHandle.status, 404)
  assert.equal(dottedHandle.headers.get('cache-control'), 'private, no-store')
})
