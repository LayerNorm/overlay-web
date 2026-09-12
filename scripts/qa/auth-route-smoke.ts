import assert from 'node:assert/strict'

const baseUrl = (process.env.AUTH_SMOKE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const providerId = process.env.AUTH_SMOKE_PROVIDER_ID ?? 'workspace'
const expectedLabel = process.env.AUTH_SMOKE_PROVIDER_LABEL ?? 'Continue with Google'
const expectedProviderIds = (process.env.AUTH_SMOKE_PROVIDER_IDS ?? providerId)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const expectedRedirectHost = process.env.AUTH_SMOKE_REDIRECT_HOST

async function main() {
  const optionsResponse = await fetch(`${baseUrl}/api/auth/options`, { redirect: 'manual' })
  assert.equal(optionsResponse.status, 200)
  const options = await optionsResponse.json() as {
    provider?: unknown
    ssoProviders?: Array<{ id?: unknown; label?: unknown }>
  }
  const providers = options.ssoProviders ?? []
  assert.deepEqual(providers.map(({ id }) => id), expectedProviderIds)
  assert.equal(providers.find(({ id }) => id === providerId)?.label, expectedLabel)

  const unknown = await fetch(`${baseUrl}/api/auth/sso/not-configured`, { redirect: 'manual' })
  assert.equal(unknown.status, 400)

  const malicious = await fetch(
    `${baseUrl}/api/auth/sso/${encodeURIComponent(providerId)}?redirect=${encodeURIComponent('https://evil.example/callback')}`,
    { redirect: 'manual' },
  )
  assert.equal(malicious.status, 400)

  const sso = await fetch(
    `${baseUrl}/api/auth/sso/${encodeURIComponent(providerId)}?redirect=${encodeURIComponent('/app/chat')}`,
    { redirect: 'manual' },
  )
  assert.equal(sso.status, 307)
  const location = sso.headers.get('location')
  assert.ok(location, 'SSO response must include a redirect location')
  if (expectedRedirectHost) {
    assert.equal(new URL(location).hostname, expectedRedirectHost)
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    provider: options.provider,
    providerId,
    redirectHost: new URL(location).hostname,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
