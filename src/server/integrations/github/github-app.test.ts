import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync } from 'node:crypto'
import { authorizeUrl, installPageUrl, userInstallations } from './github-app'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
Object.assign(process.env, {
  GITHUB_APP_ID: '42', GITHUB_APP_SLUG: 'overlay-agents-test', GITHUB_APP_CLIENT_ID: 'client-1',
  GITHUB_APP_CLIENT_SECRET: 'not-a-real-secret', GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
})

test('connecting signs in with GitHub and returns to the deployment that started it', () => {
  const url = new URL(authorizeUrl('sealed-state', 'https://pr-7.preview.getoverlay.io/api/v1/github/callback'))
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(url.searchParams.get('client_id'), 'client-1')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://pr-7.preview.getoverlay.io/api/v1/github/callback')
  assert.equal(url.searchParams.get('state'), 'sealed-state')
  assert.equal(installPageUrl(), 'https://github.com/apps/overlay-agents-test/installations/new')
})

test('only installations of this app that GitHub lists for the person are connected', async () => {
  const calls: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    if (url === 'https://github.com/login/oauth/access_token') {
      assert.match(String(init?.body), /"redirect_uri":"https:\/\/overlay.works\/api\/v1\/github\/callback"/)
      return new Response(JSON.stringify({ access_token: 'user-token' }), { status: 200 })
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer user-token')
    return new Response(JSON.stringify({ installations: [
      { id: 1, app_id: 42, account: { login: 'LayerNorm', type: 'Organization' }, repository_selection: 'all' },
      { id: 2, app_id: 99, account: { login: 'someone-else', type: 'User' } },
    ] }), { status: 200 })
  }) as typeof fetch
  try {
    const found = await userInstallations('code-1', 'https://overlay.works/api/v1/github/callback')
    assert.deepEqual(found, [{ id: 1, account: { login: 'LayerNorm', type: 'Organization' }, repositorySelection: 'all' }])
    assert.ok(calls.some(url => url.startsWith('https://api.github.com/user/installations')))
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a rejected sign-in connects nothing', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 })) as typeof fetch
  try {
    await assert.rejects(userInstallations('stale', 'https://overlay.works/api/v1/github/callback'))
  } finally {
    globalThis.fetch = realFetch
  }
})
