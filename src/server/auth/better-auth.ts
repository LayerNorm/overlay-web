import 'server-only'

import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { jwt } from 'better-auth/plugins'
import { sso, type OIDCConfig } from '@better-auth/sso'
import { Pool } from 'pg'
import {
  evaluateBetterAuthAccessPolicy,
  resolveBetterAuthConnectionSet,
  type ResolvedBetterAuthOidcConnection,
} from '@/server/auth/connections'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import type {
  OverlayBetterAuthAccessPolicy,
  OverlayRuntimeConfig,
} from '@/shared/config'

export const BETTER_AUTH_BASE_PATH = '/api/better-auth'
export const BETTER_AUTH_JWKS_PATH = '/jwks'

export interface BetterAuthRuntimeConfig {
  baseUrl: string
  basePath: string
  secret: string
  databaseUrl: string
  trustedOrigins: string[]
  connections: ResolvedBetterAuthOidcConnection[]
  accessPolicy: OverlayBetterAuthAccessPolicy
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
    trustedOrigins: buildBetterAuthTrustedOrigins(resolved),
    emailAndPassword: {
      enabled: false,
    },
    plugins: [
      sso({
        providersLimit: 0,
        trustEmailVerified: true,
        defaultSSO: buildBetterAuthDefaultSsoProviders(resolved),
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
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => evaluateBetterAuthAccessPolicy({
            email: user.email,
            emailVerified: user.emailVerified,
          }, resolved.accessPolicy).allowed,
        },
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
  const connectionSet = resolveBetterAuthConnectionSet(auth)

  if (!auth.secret) {
    throw new Error('BETTER_AUTH_SECRET is required when auth.provider is better-auth')
  }
  if (!auth.databaseUrl) {
    throw new Error('BETTER_AUTH_DATABASE_URL is required when auth.provider is better-auth')
  }
  if (connectionSet.connections.length === 0) {
    throw new Error('At least one Better Auth SSO connection is required')
  }
  if (connectionSet.accessPolicy.allowedEmailDomains.length === 0) {
    throw new Error('Better Auth requires at least one allowed email domain')
  }

  return {
    baseUrl,
    basePath,
    secret: auth.secret,
    databaseUrl: auth.databaseUrl,
    trustedOrigins: auth.trustedOrigins.map(normalizeOrigin),
    connections: connectionSet.connections,
    accessPolicy: connectionSet.accessPolicy,
    jwtIssuer,
    jwtAudience,
    jwksUrl: auth.jwksUrl ?? `${baseUrl}${basePath}${BETTER_AUTH_JWKS_PATH}`,
  }
}

export function buildBetterAuthDefaultSsoProviders(config: BetterAuthRuntimeConfig) {
  return config.connections.flatMap((connection) => {
    const oidcConfig: OIDCConfig = {
      issuer: connection.issuerUrl,
      clientId: connection.clientId,
      clientSecret: connection.clientSecret,
      discoveryEndpoint: connection.discoveryEndpoint,
      scopes: [...connection.scopes],
      pkce: true,
    }

    return connection.domains.map((domain) => ({
      domain,
      providerId: connection.id,
      oidcConfig,
    }))
  })
}

export function buildBetterAuthTrustedOrigins(config: BetterAuthRuntimeConfig): string[] {
  const origins = new Set([
    config.baseUrl,
    ...config.trustedOrigins,
  ])
  for (const connection of config.connections) {
    origins.add(normalizeOrigin(connection.issuerUrl))
    origins.add(normalizeOrigin(connection.discoveryEndpoint))
    for (const origin of connection.trustedOrigins) {
      origins.add(normalizeOrigin(origin))
    }
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
