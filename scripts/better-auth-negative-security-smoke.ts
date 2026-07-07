import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { webcrypto } from 'node:crypto'
import { DEFAULT_OVERLAY_RUNTIME_CONFIG, mergeOverlayRuntimeConfig, parseOverlayRuntimeConfig, type OverlayRuntimeConfig } from '../src/shared/config'
import { createOverlayServerContext } from '../src/server/bootstrap'
import { OverlayConfigError } from '../src/server/config'
import { getVerifiedAccessTokenClaims } from '../convex/lib/auth'

const baseUrl = (process.env.BETTER_AUTH_NEGATIVE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
const textEncoder = new TextEncoder()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (response.status === 404) {
    throw new Error(`${path} returned 404. Start the Better Auth dev server first or set BETTER_AUTH_NEGATIVE_BASE_URL.`)
  }
  let body: unknown
  const text = await response.text()
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { response, body }
}

function bodyError(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error
  }
  return typeof body === 'string' ? body : JSON.stringify(body)
}

async function expectStatus(path: string, expected: number, init: RequestInit, label: string) {
  const { response, body } = await requestJson(path, init)
  assert.equal(response.status, expected, `${label}: ${bodyError(body)}`)
  return body
}

async function runHttpFailureChecks() {
  const email = `better-auth-negative-${Date.now()}@example.com`
  const disabledSignIn = await expectStatus('/api/auth/sign-in', 401, {
    method: 'POST',
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
  }, 'email/password sign-in should be disabled in Better Auth mode')
  assert.match(bodyError(disabledSignIn), /Email\/password sign-in is disabled/i)

  const disabledSignUp = await expectStatus('/api/auth/sign-up', 400, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: 'correct-horse-battery-staple',
      firstName: 'Test',
      lastName: 'User',
    }),
  }, 'email/password sign-up should be disabled in Better Auth mode')
  assert.match(bodyError(disabledSignUp), /If this email can be used/i)

  const nativeExchange = await expectStatus('/api/auth/native/exchange', 400, {
    method: 'POST',
    body: JSON.stringify({
      code: 'validLookingCode123',
      codeVerifier: 'A'.repeat(64),
    }),
  }, 'native code exchange should be rejected clearly in Better Auth mode')
  assert.match(bodyError(nativeExchange), /Native Better Auth code exchange is not supported/i)

  const nativeAuthorize = await expectStatus('/api/auth/native/authorize', 400, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'GoogleOAuth',
      redirectUri: 'https://www.getoverlay.io/auth/native/callback',
      codeChallenge: 'B'.repeat(43),
      state: 'C'.repeat(43),
    }),
  }, 'native authorization should be rejected clearly in Better Auth mode')
  assert.match(bodyError(nativeAuthorize), /Native Better Auth code exchange is not supported/i)

  const externalRedirect = await expectStatus(`/api/auth/sso/google?redirect=${encodeURIComponent('https://evil.example/callback')}`, 400, {
    method: 'GET',
  }, 'external SSO redirect should be rejected')
  assert.match(bodyError(externalRedirect), /Invalid redirect URI/i)

  const protocolRelativeRedirect = await expectStatus(`/api/auth/sso/google?redirect=${encodeURIComponent('//evil.example/callback')}`, 400, {
    method: 'GET',
  }, 'protocol-relative SSO redirect should be rejected')
  assert.match(bodyError(protocolRelativeRedirect), /Invalid redirect URI/i)
}

function betterAuthConfig(overrides: Partial<OverlayRuntimeConfig['auth']['betterAuth']>): OverlayRuntimeConfig {
  return parseOverlayRuntimeConfig(mergeOverlayRuntimeConfig(DEFAULT_OVERLAY_RUNTIME_CONFIG, {
    app: {
      baseUrl: 'http://localhost:3000',
      deploymentEnvironment: 'onprem',
    },
    providers: {
      auth: { provider: 'better-auth' },
      database: { provider: 'convex' },
      objectStorage: { provider: 'none' },
      vectorSearch: { provider: 'none' },
      models: { provider: 'none' },
      integrations: { provider: 'none' },
      browser: { provider: 'none' },
      sandbox: { provider: 'none' },
      webSearch: { provider: 'none' },
      analytics: { provider: 'none' },
      errorReporting: { provider: 'none' },
      rateLimit: { provider: 'memory' },
    },
    auth: {
      provider: 'better-auth',
      betterAuth: overrides,
    },
    billing: {
      provider: 'none',
    },
    storage: {
      provider: 'none',
    },
    llm: {
      gatewayProvider: 'none',
      keySource: 'none',
    },
    capabilities: {
      billing: false,
      vectorSearch: false,
      modelRouting: false,
      automations: false,
      webhooks: false,
      apiKeys: false,
      multiTenant: false,
    },
    features: {
      billing: false,
      vectorSearch: false,
      modelRouting: false,
      automations: false,
      webhooks: false,
      apiKeys: false,
      multiTenant: false,
    },
  }))
}

function assertConfigFailure(config: OverlayRuntimeConfig, expectedIssue: string) {
  assert.throws(
    () => createOverlayServerContext({ runtimeConfig: config }),
    (error) => error instanceof OverlayConfigError && error.issues.some((issue) => issue.includes(expectedIssue)),
  )
}

function runConfigFailureChecks() {
  assertConfigFailure(
    betterAuthConfig({
      databaseUrl: 'postgres://overlay_auth:secret@localhost:5432/overlay_auth',
    }),
    'auth.betterAuth.secret is required',
  )
  assertConfigFailure(
    betterAuthConfig({
      secret: 'test-secret-that-is-long-enough-for-negative-smoke',
    }),
    'auth.betterAuth.databaseUrl is required',
  )
}

function base64url(value: unknown): string {
  const input = typeof value === 'string' ? value : JSON.stringify(value)
  return Buffer.from(input).toString('base64url')
}

async function signJwt(privateKey: CryptoKey, payload: Record<string, unknown>, kid: string): Promise<string> {
  const signingInput = [
    base64url({ alg: 'RS256', kid, typ: 'JWT' }),
    base64url(payload),
  ].join('.')
  const signature = await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    textEncoder.encode(signingInput),
  )
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}

async function listen(server: Server): Promise<number> {
  return await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert(address && typeof address === 'object')
      resolve(address.port)
    })
  })
}

async function runJwtFailureChecks() {
  const kid = `better-auth-negative-${Date.now()}`
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const publicJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)
  const jwks = {
    keys: [{
      ...publicJwk,
      alg: 'RS256',
      kid,
      use: 'sig',
    }],
  }
  const server = createServer((request, response) => {
    if (request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(jwks))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
  })

  const port = await listen(server)
  const issuer = 'https://better-auth-negative.example.com'
  const audience = 'overlay-negative-audience'
  const now = Math.floor(Date.now() / 1000)
  process.env.BETTER_AUTH_JWT_ISSUER = issuer
  process.env.BETTER_AUTH_JWT_AUDIENCE = audience
  process.env.BETTER_AUTH_JWKS_URL = `http://127.0.0.1:${port}/jwks`

  try {
    const goodToken = await signJwt(keyPair.privateKey, {
      iss: issuer,
      aud: audience,
      sub: 'better-auth-negative-user',
      iat: now,
      exp: now + 300,
    }, kid)
    const goodClaims = await getVerifiedAccessTokenClaims(goodToken)
    assert.equal(goodClaims?.sub, 'better-auth-negative-user')

    const badAudienceToken = await signJwt(keyPair.privateKey, {
      iss: issuer,
      aud: 'wrong-audience',
      sub: 'better-auth-negative-user',
      iat: now,
      exp: now + 300,
    }, kid)
    assert.equal(await getVerifiedAccessTokenClaims(badAudienceToken), null)

    process.env.BETTER_AUTH_JWKS_URL = `http://127.0.0.1:${port}/missing-jwks`
    const badJwksToken = await signJwt(keyPair.privateKey, {
      iss: issuer,
      aud: audience,
      sub: 'better-auth-negative-user',
      iat: now,
      exp: now + 300,
    }, kid)
    await assert.doesNotReject(async () => {
      assert.equal(await getVerifiedAccessTokenClaims(badJwksToken), null)
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function main() {
  await runHttpFailureChecks()
  runConfigFailureChecks()
  await runJwtFailureChecks()
  console.log(`Better Auth negative security smoke passed against ${baseUrl}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
