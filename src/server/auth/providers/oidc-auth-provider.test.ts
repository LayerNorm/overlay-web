import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test, { type TestContext } from 'node:test'
import { OidcAuthProvider } from './oidc-auth-provider'

const encoder = new TextEncoder()

type TestKeyMaterial = {
  kid: string
  privateKey: CryptoKey
  publicJwk: TestPublicJwk
}

type TestPublicJwk = JsonWebKey & {
  alg?: string
  kid?: string
  use?: string
}

test('OidcAuthProvider verifies RS256 access tokens with discovery JWKS and maps bearer sessions', async (t) => {
  ensureCrypto()
  const issuer = 'https://idp.enterprise.example.com'
  const key = await createTestKey('oidc-key-1')
  mockOidcFetch(t, issuer, key.publicJwk)

  const token = await signJwt(key, {
    iss: issuer,
    sub: 'user_1',
    aud: 'overlay-api',
    exp: Math.floor(Date.now() / 1000) + 60,
    email: 'user@example.com',
    given_name: 'Ada',
    family_name: 'Lovelace',
    picture: 'https://idp.enterprise.example.com/avatar.png',
    email_verified: true,
  })

  const provider = new OidcAuthProvider({
    issuerUrl: issuer,
    clientId: 'overlay-web',
    audience: 'overlay-api',
  })

  const claims = await provider.verifyAccessToken(token)
  assert.equal(claims?.sub, 'user_1')
  assert.equal(claims?.aud, 'overlay-api')

  const profile = await provider.getUserProfile(token)
  assert.deepEqual(profile, {
    id: 'user_1',
    email: 'user@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    profilePictureUrl: 'https://idp.enterprise.example.com/avatar.png',
    emailVerified: true,
  })

  const session = await provider.getSession(new Request('https://overlay.test', {
    headers: { authorization: `Bearer ${token}` },
  }))
  assert.equal(session?.user.id, 'user_1')
  assert.equal(session?.user.email, 'user@example.com')
  assert.equal(session?.accessToken, token)
})

test('OidcAuthProvider rejects validly signed tokens for the wrong audience', async (t) => {
  ensureCrypto()
  const issuer = 'https://idp.wrong-audience.example.com'
  const key = await createTestKey('oidc-key-2')
  mockOidcFetch(t, issuer, key.publicJwk)

  const token = await signJwt(key, {
    iss: issuer,
    sub: 'user_1',
    aud: 'another-api',
    exp: Math.floor(Date.now() / 1000) + 60,
  })

  const provider = new OidcAuthProvider({
    issuerUrl: issuer,
    clientId: 'overlay-web',
    audience: 'overlay-api',
  })

  assert.equal(await provider.verifyAccessToken(token), null)
})

test('OidcAuthProvider verifies Keycloak-style realm issuer tokens with client-id audience fallback', async (t) => {
  ensureCrypto()
  const issuer = 'https://keycloak.enterprise.example.com/realms/overlay'
  const key = await createTestKey('keycloak-key-1')
  mockOidcFetch(t, issuer, key.publicJwk)

  const token = await signJwt(key, {
    iss: issuer,
    sub: 'kc_user_1',
    aud: 'overlay-web',
    exp: Math.floor(Date.now() / 1000) + 60,
    email: 'keycloak@example.com',
  })

  const provider = new OidcAuthProvider({
    issuerUrl: issuer,
    clientId: 'overlay-web',
  })

  const claims = await provider.verifyAccessToken(token)
  assert.equal(claims?.sub, 'kc_user_1')
  assert.equal((await provider.getUserProfile(token))?.email, 'keycloak@example.com')
})

function ensureCrypto(): void {
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    })
  }
}

async function createTestKey(kid: string): Promise<TestKeyMaterial> {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const jwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)
  return {
    kid,
    privateKey: keyPair.privateKey,
    publicJwk: {
      ...jwk,
      alg: 'RS256',
      kid,
      use: 'sig',
    },
  }
}

async function signJwt(
  key: TestKeyMaterial,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = base64UrlJson({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
  const payload = base64UrlJson(claims)
  const input = `${header}.${payload}`
  const signature = await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    encoder.encode(input),
  )
  return `${input}.${Buffer.from(signature).toString('base64url')}`
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function mockOidcFetch(t: TestContext, issuer: string, jwk: TestPublicJwk): void {
  const previousFetch = globalThis.fetch
  const jwksUri = `${issuer}/jwks`
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return jsonResponse({ issuer, jwks_uri: jwksUri })
    }
    if (url === jwksUri) {
      return jsonResponse({ keys: [jwk] })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  })
}
