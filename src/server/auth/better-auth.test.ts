import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import {
  buildBetterAuthDefaultSsoProviders,
  buildBetterAuthTrustedOrigins,
  createBetterAuthOptions,
  resolveBetterAuthRuntimeConfig,
} from '@/server/auth/better-auth'
import { getAuthUiOptionsForConfig } from '@/server/auth/auth-ui-options'
import { evaluateBetterAuthAccessPolicy } from '@/server/auth/connections'
import {
  parseOverlayRuntimeConfig,
  type OverlayRuntimeConfig,
} from '@/shared/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const baseConfig = parseOverlayRuntimeConfig(JSON.parse(
  readFileSync(path.join(repoRoot, 'fixtures/config/saas-staging.json'), 'utf8'),
))

function canonicalBetterAuthConfig(): OverlayRuntimeConfig {
  return parseOverlayRuntimeConfig({
    ...baseConfig,
    providers: {
      ...baseConfig.providers,
      auth: { provider: 'better-auth' },
    },
    auth: {
      provider: 'better-auth',
      allowDevFallbacks: false,
      workos: {},
      oidc: {},
      betterAuth: {
        baseUrl: 'https://staging.getoverlay.io',
        secret: 'better_auth_secret',
        databaseUrl: 'postgresql://overlay_auth:secret@localhost/overlay_auth',
        trustedOrigins: ['https://admin.getoverlay.io'],
        connections: [
          {
            id: 'workspace',
            preset: 'google-workspace',
            label: 'Continue with School Google',
            domains: ['school.edu', 'students.school.edu'],
            clientId: 'google-client',
            clientSecret: 'google-secret',
          },
          {
            id: 'microsoft',
            preset: 'entra-id',
            domains: ['corp.example.com'],
            tenantId: '4d38d1b7-5f35-4fd9-a522-8c85ec9ecb43',
            clientId: 'entra-client',
            clientSecret: 'entra-secret',
          },
        ],
        accessPolicy: {
          requireVerifiedEmail: true,
          allowedEmailDomains: ['school.edu', 'students.school.edu', 'corp.example.com'],
        },
      },
    },
  })
}

test('Better Auth runtime resolves multiple canonical connections', () => {
  const resolved = resolveBetterAuthRuntimeConfig(canonicalBetterAuthConfig())

  assert.deepEqual(resolved.connections.map(({ id, label, icon }) => ({ id, label, icon })), [
    {
      id: 'workspace',
      label: 'Continue with School Google',
      icon: 'google',
    },
    {
      id: 'microsoft',
      label: 'Continue with Microsoft Entra ID',
      icon: 'microsoft',
    },
  ])
  assert.deepEqual(resolved.accessPolicy.allowedEmailDomains, [
    'school.edu',
    'students.school.edu',
    'corp.example.com',
  ])
})

test('Better Auth builds one stable provider entry for every routed domain', () => {
  const resolved = resolveBetterAuthRuntimeConfig(canonicalBetterAuthConfig())
  const providers = buildBetterAuthDefaultSsoProviders(resolved)

  assert.deepEqual(providers.map(({ providerId, domain }) => ({ providerId, domain })), [
    { providerId: 'workspace', domain: 'school.edu' },
    { providerId: 'workspace', domain: 'students.school.edu' },
    { providerId: 'microsoft', domain: 'corp.example.com' },
  ])
  assert.deepEqual(providers[0]?.oidcConfig.scopes, ['openid', 'email', 'profile'])
  assert.equal(providers[0]?.oidcConfig.pkce, true)
})

test('Better Auth trusts configured app and OIDC discovery origins', () => {
  const resolved = resolveBetterAuthRuntimeConfig(canonicalBetterAuthConfig())

  assert.deepEqual(buildBetterAuthTrustedOrigins(resolved), [
    'https://staging.getoverlay.io',
    'https://admin.getoverlay.io',
    'https://accounts.google.com',
    'https://login.microsoftonline.com',
  ])
})

test('Better Auth options disable implicit linking and reject disallowed new users', async () => {
  const resolved = resolveBetterAuthRuntimeConfig(canonicalBetterAuthConfig())
  const options = createBetterAuthOptions(resolved, {} as Pool)

  assert.equal(options.account.accountLinking.disableImplicitLinking, true)
  const beforeCreate = options.databaseHooks.user.create.before
  assert.equal(await beforeCreate({
    email: 'student@school.edu',
    emailVerified: true,
  } as Parameters<typeof beforeCreate>[0]), true)
  assert.equal(await beforeCreate({
    email: 'student@gmail.com',
    emailVerified: true,
  } as Parameters<typeof beforeCreate>[0]), false)
  assert.equal(await beforeCreate({
    email: 'student@school.edu',
    emailVerified: false,
  } as Parameters<typeof beforeCreate>[0]), false)
})

test('Better Auth access policy requires exact configured domains', () => {
  const policy = {
    requireVerifiedEmail: true,
    allowedEmailDomains: ['school.edu'],
  }

  assert.deepEqual(evaluateBetterAuthAccessPolicy({
    email: 'teacher@school.edu',
    emailVerified: true,
  }, policy), { allowed: true })
  assert.deepEqual(evaluateBetterAuthAccessPolicy({
    email: 'teacher@sub.school.edu',
    emailVerified: true,
  }, policy), { allowed: false, reason: 'email_domain_not_allowed' })
  assert.deepEqual(evaluateBetterAuthAccessPolicy({
    email: 'teacher@school.edu',
    emailVerified: false,
  }, policy), { allowed: false, reason: 'email_unverified' })
})

test('auth UI options are derived from the active auth provider', () => {
  const betterAuthOptions = getAuthUiOptionsForConfig(canonicalBetterAuthConfig())
  assert.equal(betterAuthOptions.provider, 'better-auth')
  assert.equal(betterAuthOptions.supportsPasswordSignIn, false)
  assert.deepEqual(betterAuthOptions.ssoProviders, [
    { id: 'workspace', label: 'Continue with School Google', icon: 'google' },
    { id: 'microsoft', label: 'Continue with Microsoft Entra ID', icon: 'microsoft' },
  ])

  const workOsOptions = getAuthUiOptionsForConfig(baseConfig)
  assert.equal(workOsOptions.provider, 'workos')
  assert.equal(workOsOptions.supportsPasswordSignIn, true)
  assert.deepEqual(workOsOptions.ssoProviders.map(({ id, icon }) => ({ id, icon })), [
    { id: 'google', icon: 'google' },
    { id: 'apple', icon: 'apple' },
    { id: 'microsoft', icon: 'microsoft' },
  ])

  const unsupportedWebFlowConfig = parseOverlayRuntimeConfig({
    ...baseConfig,
    providers: {
      ...baseConfig.providers,
      auth: { provider: 'oidc' },
    },
  })
  assert.deepEqual(getAuthUiOptionsForConfig(unsupportedWebFlowConfig).ssoProviders, [])
})
