import assert from 'node:assert/strict'

const baseUrl = (process.env.NATIVE_AUTH_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')

async function post(path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function assertStatus(response: Response, expected: number, message: string) {
  if (response.status === 404) {
    throw new Error(`${message}: got 404. Start overlay-landing dev server first or set NATIVE_AUTH_BASE_URL.`)
  }
  assert.equal(response.status, expected, message)
}

async function main() {
  const validVerifier = 'A'.repeat(64)
  const validChallenge = 'B'.repeat(43)
  const validState = 'C'.repeat(43)

  const badRedirect = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'https://evil.example/callback',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(badRedirect, 400, 'wrong redirect URI should be rejected')

  const looseRedirect = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'overlay://auth/callback.evil',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(looseRedirect, 400, 'lookalike callback route should be rejected')

  const customSchemeRedirect = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'overlay://auth/callback',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(customSchemeRedirect, 400, 'custom scheme redirect should be rejected')

  const preseededSchemeRedirect = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'overlay://auth/callback?code=preseeded&state=preseeded',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(preseededSchemeRedirect, 400, 'custom scheme redirect with query params should be rejected')

  const fragmentSchemeRedirect = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'overlay://auth/callback#code=preseeded',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(fragmentSchemeRedirect, 400, 'custom scheme redirect with fragment params should be rejected')

  const badProvider = await post('/api/auth/native/authorize', {
    provider: 'GitHubOAuth',
    redirectUri: 'https://www.getoverlay.io/auth/native/callback',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(badProvider, 400, 'unsupported provider should be rejected')

  const badState = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'https://www.getoverlay.io/auth/native/callback',
    codeChallenge: validChallenge,
    state: 'bad state',
  })
  await assertStatus(badState, 400, 'malformed state should be rejected')

  const universalLinkRedirect = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'https://www.getoverlay.io/auth/native/callback',
    codeChallenge: validChallenge,
    state: validState,
  })
  assert.notEqual(universalLinkRedirect.status, 400, 'universal link redirect should pass local validation')

  const universalLinkLookalike = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'https://www.getoverlay.io/auth/native/callback/evil',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(universalLinkLookalike, 400, 'universal link lookalike route should be rejected')

  const preseededUniversalLinkRedirect = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'https://www.getoverlay.io/auth/native/callback?code=preseeded&state=preseeded',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(preseededUniversalLinkRedirect, 400, 'universal link redirect with query params should be rejected')

  const fragmentUniversalLinkRedirect = await post('/api/auth/native/authorize', {
    provider: 'GoogleOAuth',
    redirectUri: 'https://www.getoverlay.io/auth/native/callback#code=preseeded',
    codeChallenge: validChallenge,
    state: validState,
  })
  await assertStatus(fragmentUniversalLinkRedirect, 400, 'universal link redirect with fragment params should be rejected')

  const missingVerifier = await post('/api/auth/native/exchange', {
    code: 'validLookingCode123',
  })
  await assertStatus(missingVerifier, 400, 'missing verifier should be rejected')

  const badVerifier = await post('/api/auth/native/exchange', {
    code: 'validLookingCode123',
    codeVerifier: 'bad+verifier',
  })
  await assertStatus(badVerifier, 400, 'malformed verifier should be rejected')

  const invalidCode = await post('/api/auth/native/exchange', {
    code: 'not real code',
    codeVerifier: validVerifier,
  })
  await assertStatus(invalidCode, 400, 'malformed code should be rejected before WorkOS exchange')

  const unauthenticatedApp = await fetch(`${baseUrl}/api/v1/conversations`)
  await assertStatus(unauthenticatedApp, 401, '/api/v1/* should reject unauthenticated requests')

  console.log(`Native auth security smoke passed against ${baseUrl}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
