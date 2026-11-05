import assert from 'node:assert/strict'
import test from 'node:test'
import { deployedNativeAuthConfig, nativeAuthConfig } from './nativeAuthConfig'

test('deployment config never reads absent optional or unselected provider settings', () => {
  const strictEnv = (values: Record<string, string>) => new Proxy(values, {
    get(target, key: string) {
      if (!(key in target)) throw new Error(`Missing environment variable ${key}`)
      return target[key]
    },
  })
  for (const values of [
    { OVERLAY_PROVIDER_AUTH: 'workos', WORKOS_CLIENT_ID: 'client_fixture' },
    { OVERLAY_PROVIDER_AUTH: 'none' },
    { OVERLAY_PROVIDER_AUTH: 'oidc', OIDC_ISSUER_URL: 'https://issuer.test/', OIDC_AUDIENCE: 'app' },
    { OVERLAY_PROVIDER_AUTH: 'better-auth', BETTER_AUTH_URL: 'https://auth.test',
      BETTER_AUTH_JWT_ISSUER: 'https://auth.test', BETTER_AUTH_JWT_AUDIENCE: 'app',
      BETTER_AUTH_JWKS_URL: 'https://auth.test/custom/jwks' },
  ] as Record<string, string>[]) {
    assert.deepEqual(deployedNativeAuthConfig(strictEnv(values)), nativeAuthConfig(values))
  }
  assert.throws(() => deployedNativeAuthConfig(strictEnv({})), /Missing environment/)
  assert.throws(() => deployedNativeAuthConfig(strictEnv({ OVERLAY_PROVIDER_AUTH: 'oidc' })), /Missing environment/)
})

test('hosted WorkOS trust remains scoped to its client and exact supported issuers', () => {
  const config = nativeAuthConfig({ WORKOS_CLIENT_ID: 'client_fixture', DEV_WORKOS_CLIENT_ID: 'not-trusted' })
  assert.equal(config.providers.length, 3)
  assert.deepEqual(config.providers[2], {
    type: 'customJwt', issuer: 'https://api.workos.com/user_management/client_fixture',
    jwks: 'https://api.workos.com/sso/jwks/client_fixture', algorithm: 'RS256',
  })
  assert.ok(!JSON.stringify(config).includes('not-trusted'))
})

test('Better Auth uses RS256, subject-preserving issuer/audience and only the selected provider', () => {
  assert.deepEqual(nativeAuthConfig({ AUTH_PROVIDER: 'better-auth', WORKOS_CLIENT_ID: 'not-trusted',
    BETTER_AUTH_URL: 'https://private.example.test/', BETTER_AUTH_BASE_PATH: 'custom-auth/',
  }), { providers: [{ type: 'customJwt', issuer: 'https://private.example.test',
    applicationID: 'https://private.example.test', jwks: 'https://private.example.test/custom-auth/jwks', algorithm: 'RS256',
  }] })
})

test('OIDC audience is required and the configured issuer is exact, including trailing slash', () => {
  assert.deepEqual(nativeAuthConfig({ AUTH_PROVIDER: 'oidc', OIDC_ISSUER_URL: 'https://issuer.example.test/',
    OIDC_CLIENT_ID: 'client', OIDC_AUDIENCE: 'overlay-api',
  }), { providers: [{ domain: 'https://issuer.example.test/', applicationID: 'overlay-api' }] })
  assert.throws(() => nativeAuthConfig({ AUTH_PROVIDER: 'oidc' }))
  assert.throws(() => nativeAuthConfig({ AUTH_PROVIDER: 'better-auth' }))
  assert.throws(() => nativeAuthConfig({ AUTH_PROVIDER: 'unknown' }))
  assert.deepEqual(nativeAuthConfig({ OVERLAY_PROVIDER_AUTH: 'none', AUTH_PROVIDER: 'workos', WORKOS_CLIENT_ID: 'client' }), { providers: [] })
})
