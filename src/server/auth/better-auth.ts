import 'server-only'

import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { jwt } from 'better-auth/plugins'
import { sso, type OIDCConfig } from '@better-auth/sso'
import { Pool } from 'pg'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import type { OverlayRuntimeConfig } from '@/shared/config'

export const BETTER_AUTH_BASE_PATH = '/api/better-auth'
export const BETTER_AUTH_JWKS_PATH = '/jwks'

export interface BetterAuthRuntimeConfig {
  baseUrl: string
  basePath: string
  secret: string
  databaseUrl: string
  trustedOrigins: string[]
  defaultSsoProviderId?: string
  defaultSsoDomain?: string
  oidcIssuerUrl?: string
  oidcDiscoveryEndpoint?: string
  oidcClientId?: string
  oidcClientSecret?: string
  jwtIssuer: string
  jwtAudience: string
  jwksUrl: string
}

type BetterAuthInstance = ReturnType<typeof createBetterAuthInstance>

let betterAuthInstance: BetterAuthInstance | null = null
let betterAuthPool: Pool | null = null
let betterAuthCacheKey: string | null = null

export function getBetterAuth(runtimeConfig?: OverlayRuntimeConfig): BetterAuthInstance {
  const resolved = resolveBetterAuthRuntimeConfig(runtimeConfig)
  const cacheKey = JSON.stringify(resolved)
  if (betterAuthInstance && betterAuthCacheKey === cacheKey) {
    return betterAuthInstance
  }

  betterAuthPool?.end().catch((_error) => undefined)
  betterAuthPool = new Pool({
    connectionString: resolved.databaseUrl,
  })

  betterAuthInstance = createBetterAuthInstance(resolved, betterAuthPool)
  betterAuthCacheKey = cacheKey
  return betterAuthInstance
}

function createBetterAuthInstance(resolved: BetterAuthRuntimeConfig, database: Pool) {
  return betterAuth(createBetterAuthOptions(resolved, database))
}

export function createBetterAuthOptions(
  resolved: BetterAuthRuntimeConfig,
  database: Pool,
) {
  return {
    baseURL: resolved.baseUrl,
    basePath: resolved.basePath,
    secret: resolved.secret,
    database,
    trustedOrigins: buildTrustedOrigins(resolved),
    emailAndPassword: {
      enabled: false,
    },
    plugins: [
      sso({
        providersLimit: 0,
        trustEmailVerified: true,
        defaultSSO: buildDefaultSsoProviders(resolved),
      }),
      jwt({
        jwks: {
          jwksPath: BETTER_AUTH_JWKS_PATH,
          keyPairConfig: {
            alg: 'RS256',
            modulusLength: 2048,
          },
        },
        jwt: {
          issuer: resolved.jwtIssuer,
          audience: resolved.jwtAudience,
          expirationTime: '15m',
          getSubject: ({ user }) => user.id,
          definePayload: ({ user }) => ({
            sub: user.id,
            email: user.email,
            name: user.name,
            emailVerified: user.emailVerified,
            profilePictureUrl: user.image ?? undefined,
          }),
        },
        disableSettingJwtHeader: true,
      }),
      nextCookies(),
    ],
    user: {
      deleteUser: {
        enabled: true,
      },
    },
  } satisfies Parameters<typeof betterAuth>[0]
}

export function resolveBetterAuthRuntimeConfig(
  runtimeConfig: OverlayRuntimeConfig = getOverlayRuntimeConfigSync(),
): BetterAuthRuntimeConfig {
  const auth = runtimeConfig.auth.betterAuth
  const baseUrl = normalizeOrigin(auth.baseUrl ?? runtimeConfig.app.baseUrl)
  const basePath = normalizeBasePath(auth.basePath ?? BETTER_AUTH_BASE_PATH)
  const jwtIssuer = normalizeOrigin(auth.jwtIssuer ?? baseUrl)
  const jwtAudience = auth.jwtAudience?.trim() || baseUrl

  if (!auth.secret) {
    throw new Error('BETTER_AUTH_SECRET is required when auth.provider is better-auth')
  }
  if (!auth.databaseUrl) {
    throw new Error('BETTER_AUTH_DATABASE_URL is required when auth.provider is better-auth')
  }

  return {
    baseUrl,
    basePath,
    secret: auth.secret,
    databaseUrl: auth.databaseUrl,
    trustedOrigins: auth.trustedOrigins.map(normalizeOrigin),
    defaultSsoProviderId: auth.defaultSsoProviderId,
    defaultSsoDomain: auth.defaultSsoDomain,
    oidcIssuerUrl: auth.oidcIssuerUrl,
    oidcDiscoveryEndpoint: auth.oidcDiscoveryEndpoint,
    oidcClientId: auth.oidcClientId,
    oidcClientSecret: auth.oidcClientSecret,
    jwtIssuer,
    jwtAudience,
    jwksUrl: auth.jwksUrl ?? `${baseUrl}${basePath}${BETTER_AUTH_JWKS_PATH}`,
  }
}

function buildDefaultSsoProviders(config: BetterAuthRuntimeConfig) {
  if (
    !config.defaultSsoProviderId ||
    !config.defaultSsoDomain ||
    !config.oidcIssuerUrl ||
    !config.oidcClientId ||
    !config.oidcClientSecret
  ) {
    return []
  }

  const oidcConfig: OIDCConfig = {
    issuer: config.oidcIssuerUrl,
    clientId: config.oidcClientId,
    clientSecret: config.oidcClientSecret,
    discoveryEndpoint:
      config.oidcDiscoveryEndpoint ??
      `${config.oidcIssuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`,
    pkce: true,
  }

  return [{
    domain: config.defaultSsoDomain,
    providerId: config.defaultSsoProviderId,
    oidcConfig,
  }]
}

function buildTrustedOrigins(config: BetterAuthRuntimeConfig): string[] {
  const origins = new Set([
    config.baseUrl,
    ...config.trustedOrigins,
  ])
  if (config.oidcIssuerUrl) {
    origins.add(normalizeOrigin(config.oidcIssuerUrl))
  }
  if (config.oidcDiscoveryEndpoint) {
    origins.add(normalizeOrigin(config.oidcDiscoveryEndpoint))
  }
  return [...origins]
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  return url.origin
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim()
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '') || BETTER_AUTH_BASE_PATH
}
