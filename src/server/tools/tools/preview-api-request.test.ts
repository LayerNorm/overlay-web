import 'server-only'
import assert from 'node:assert/strict'
import test from 'node:test'
import { callInternalApi, callInternalApiGet } from './internal-api'
import { getServiceAuthHeaderName, verifyServiceAuthToken } from '@/server/auth/service-auth'

test('protected Preview tool reads and writes retain app auth and use only their own hosting credential', async () => {
  const keys = ['VERCEL_ENV', 'OVERLAY_DEPLOYMENT_ENV', 'NEXT_PUBLIC_APP_URL', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'VERCEL_GIT_PULL_REQUEST_ID', 'INTERNAL_SERVICE_AUTH_SECRET'] as const
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const originalFetch = globalThis.fetch
  const requests: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json({ ok: true }) }
  try {
    Object.assign(process.env, { VERCEL_ENV: 'preview', OVERLAY_DEPLOYMENT_ENV: 'preview',
      NEXT_PUBLIC_APP_URL: 'https://pr-247.preview.getoverlay.io', VERCEL_GIT_PULL_REQUEST_ID: '247', VERCEL_AUTOMATION_BYPASS_SECRET: 'existing-test-secret',
      INTERNAL_SERVICE_AUTH_SECRET: 'preview-service-auth-test-secret' })
    await callInternalApiGet('/api/v1/files?limit=1', 'app-auth', 'https://pr-247.preview.getoverlay.io', undefined, 'root-marker-not-sent', 'user', 'workspace')
    await callInternalApi('/api/v1/notes', { userId: 'user', workspaceId: 'workspace', serverSecret: 'root-marker-not-sent', content: 'owned QA note' }, 'app-auth', 'https://pr-247.preview.getoverlay.io')
    for (const request of requests) {
      const headers = new Headers(request.init?.headers)
      assert.equal(headers.get('x-vercel-protection-bypass'), 'existing-test-secret')
      assert.equal(headers.get('Authorization'), 'Bearer app-auth')
      assert.equal(headers.get('x-overlay-workspace-id'), 'workspace')
      assert.deepEqual(await verifyServiceAuthToken(headers.get(getServiceAuthHeaderName()), {
        method: request.init?.method ?? 'GET', path: new URL(request.url).pathname, consumeReplay: false,
      }), { userId: 'user' })
      assert.equal(request.init?.redirect, 'error', 'A redirect must not forward the hosting credential')
      assert.equal(String(request.init?.body).includes('existing-test-secret'), false)
      assert.equal(String(request.init?.body).includes('root-marker-not-sent'), false)
    }
    requests.length = 0
    await callInternalApiGet('/api/v1/files', 'app-auth', 'https://other.example')
    await callInternalApiGet('/api/v1/files', 'app-auth', 'https://pr-248.preview.getoverlay.io')
    await callInternalApiGet('/help', 'app-auth', 'https://pr-247.preview.getoverlay.io')
    process.env.VERCEL_ENV = 'production'; process.env.OVERLAY_DEPLOYMENT_ENV = 'production'
    await callInternalApiGet('/api/v1/files', 'app-auth', 'https://pr-247.preview.getoverlay.io')
    for (const request of requests) assert.equal(new Headers(request.init?.headers).has('x-vercel-protection-bypass'), false)
  } finally {
    globalThis.fetch = originalFetch
    for (const key of keys) { const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
