import test from 'node:test'
import assert from 'node:assert/strict'
import { OverlayBetterAuthConnectionSchema } from '@/shared/config'
import {
  resolveBetterAuthConnection,
  resolveBetterAuthConnectionSet,
  type BetterAuthConfig,
} from './index'

function betterAuthConfig(overrides: Partial<BetterAuthConfig> = {}): BetterAuthConfig {
  return {
    trustedOrigins: [],
    connections: [],
    accessPolicy: {
      requireVerifiedEmail: true,
      allowedEmailDomains: [],
    },
    ...overrides,
  }
}

test('preset registry resolves the four initial OIDC presets', () => {
  const google = resolveBetterAuthConnection(OverlayBetterAuthConnectionSchema.parse({
    id: 'workspace',
    preset: 'google-workspace',
    domains: ['school.edu'],
    clientId: 'google-client',
    clientSecret: 'google-secret',
  }))
  assert.equal(google.issuerUrl, 'https://accounts.google.com')
  assert.equal(
    google.discoveryEndpoint,
    'https://accounts.google.com/.well-known/openid-configuration',
  )
  assert.equal(google.label, 'Continue with Google')
  assert.equal(google.icon, 'google')
  assert.deepEqual(google.trustedOrigins, [
    'https://oauth2.googleapis.com',
    'https://openidconnect.googleapis.com',
    'https://www.googleapis.com',
  ])

  const auth0 = resolveBetterAuthConnection(OverlayBetterAuthConnectionSchema.parse({
    id: 'auth0',
    preset: 'auth0',
    domains: ['partners.example.com'],
    issuerUrl: 'https://tenant.us.auth0.com/',
    clientId: 'auth0-client',
    clientSecret: 'auth0-secret',
  }))
  assert.equal(auth0.issuerUrl, 'https://tenant.us.auth0.com/')
  assert.equal(
    auth0.discoveryEndpoint,
    'https://tenant.us.auth0.com/.well-known/openid-configuration',
  )
  assert.equal(auth0.label, 'Continue with Auth0')
  assert.deepEqual(auth0.trustedOrigins, [])

  const entra = resolveBetterAuthConnection(OverlayBetterAuthConnectionSchema.parse({
    id: 'microsoft',
    preset: 'entra-id',
    domains: ['corp.example.com'],
    tenantId: '4d38d1b7-5f35-4fd9-a522-8c85ec9ecb43',
    clientId: 'entra-client',
    clientSecret: 'entra-secret',
  }))
  assert.equal(
    entra.issuerUrl,
    'https://login.microsoftonline.com/4d38d1b7-5f35-4fd9-a522-8c85ec9ecb43/v2.0',
  )
  assert.equal(entra.icon, 'microsoft')

  const generic = resolveBetterAuthConnection(OverlayBetterAuthConnectionSchema.parse({
    id: 'custom',
    preset: 'generic-oidc',
    label: 'Continue with Enterprise SSO',
    domains: ['identity.example.org'],
    issuerUrl: 'https://idp.example.org',
    discoveryEndpoint: 'https://idp.example.org/custom-discovery',
    clientId: 'generic-client',
    clientSecret: 'generic-secret',
  }))
  assert.equal(generic.label, 'Continue with Enterprise SSO')
  assert.equal(generic.discoveryEndpoint, 'https://idp.example.org/custom-discovery')
  assert.deepEqual(generic.scopes, ['openid', 'email', 'profile'])
})

test('preset registry resolves named credential environment references', () => {
  const connection = OverlayBetterAuthConnectionSchema.parse({
    id: 'workspace',
    preset: 'google-workspace',
    domains: ['school.edu'],
    clientIdEnv: 'GOOGLE_WORKSPACE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_WORKSPACE_CLIENT_SECRET',
  })

  const resolved = resolveBetterAuthConnection(connection, {
    GOOGLE_WORKSPACE_CLIENT_ID: 'resolved-client',
    GOOGLE_WORKSPACE_CLIENT_SECRET: 'resolved-secret',
  })
  assert.equal(resolved.clientId, 'resolved-client')
  assert.equal(resolved.clientSecret, 'resolved-secret')

  assert.throws(
    () => resolveBetterAuthConnection(connection, {}),
    /requires clientId from GOOGLE_WORKSPACE_CLIENT_ID/,
  )
})

test('connection-set resolver derives policy domains from canonical connections', () => {
  const connections = [
    OverlayBetterAuthConnectionSchema.parse({
      id: 'workspace',
      preset: 'google-workspace',
      domains: ['school.edu', 'students.school.edu'],
      clientId: 'google-client',
      clientSecret: 'google-secret',
    }),
    OverlayBetterAuthConnectionSchema.parse({
      id: 'custom',
      preset: 'generic-oidc',
      domains: ['school.edu', 'partners.example.org'],
      issuerUrl: 'https://idp.example.org',
      clientId: 'custom-client',
      clientSecret: 'custom-secret',
    }),
  ]
  const resolved = resolveBetterAuthConnectionSet(betterAuthConfig({ connections }))

  assert.equal(resolved.source, 'connections')
  assert.deepEqual(resolved.accessPolicy, {
    requireVerifiedEmail: true,
    allowedEmailDomains: ['school.edu', 'students.school.edu', 'partners.example.org'],
  })
})

test('connection-set resolver translates complete legacy OIDC configuration', () => {
  const resolved = resolveBetterAuthConnectionSet(betterAuthConfig({
    defaultSsoProviderId: 'legacy-enterprise',
    defaultSsoDomain: 'Example.COM,partners.example.com',
    oidcIssuerUrl: 'https://legacy-idp.example.com',
    oidcDiscoveryEndpoint: 'https://legacy-idp.example.com/discovery',
    oidcClientId: 'legacy-client',
    oidcClientSecret: 'legacy-secret',
  }))

  assert.equal(resolved.source, 'legacy')
  assert.equal(resolved.connections[0]?.preset, 'generic-oidc')
  assert.equal(resolved.connections[0]?.id, 'legacy-enterprise')
  assert.deepEqual(resolved.accessPolicy.allowedEmailDomains, [
    'example.com',
    'partners.example.com',
  ])
})

test('connection-set resolver preserves an explicit access policy', () => {
  const connection = OverlayBetterAuthConnectionSchema.parse({
    id: 'workspace',
    preset: 'google-workspace',
    domains: ['school.edu'],
    clientId: 'google-client',
    clientSecret: 'google-secret',
  })
  const resolved = resolveBetterAuthConnectionSet(betterAuthConfig({
    connections: [connection],
    accessPolicy: {
      requireVerifiedEmail: false,
      allowedEmailDomains: ['staff.school.edu'],
    },
  }))

  assert.deepEqual(resolved.accessPolicy, {
    requireVerifiedEmail: false,
    allowedEmailDomains: ['staff.school.edu'],
  })
})
