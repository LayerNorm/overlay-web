import 'server-only'

import type {
  AuthProvider,
  Session,
  TokenClaims,
  UserProfile,
} from '@overlay/app-core'
import { getBetterAuth, resolveBetterAuthRuntimeConfig } from '@/server/auth/better-auth'
import type { OverlayRuntimeConfig } from '@/shared/config'

export interface BetterAuthProviderConfig {
  runtimeConfig?: OverlayRuntimeConfig
}

export class BetterAuthProvider implements AuthProvider {
  readonly providerConfigSummary: {
    provider: 'better-auth'
    baseUrl?: string
    basePath?: string
    hasSecret: boolean
    hasDatabaseUrl: boolean
    jwtIssuer?: string
    jwtAudience?: string
    jwksUrl?: string
  }

  constructor(private readonly config: BetterAuthProviderConfig = {}) {
    const betterAuthConfig = this.config.runtimeConfig?.auth.betterAuth
    this.providerConfigSummary = {
      provider: 'better-auth',
      baseUrl: betterAuthConfig?.baseUrl ?? this.config.runtimeConfig?.app.baseUrl,
      basePath: betterAuthConfig?.basePath,
      hasSecret: Boolean(betterAuthConfig?.secret),
      hasDatabaseUrl: Boolean(betterAuthConfig?.databaseUrl),
      jwtIssuer: betterAuthConfig?.jwtIssuer ?? this.config.runtimeConfig?.app.baseUrl,
      jwtAudience: betterAuthConfig?.jwtAudience ?? this.config.runtimeConfig?.app.baseUrl,
      jwksUrl: betterAuthConfig?.jwksUrl,
    }
  }

  async getSession(req: Request): Promise<Session | null> {
    return this.resolveSession(req)
  }

  async refreshSession(req: Request): Promise<Session | null> {
    return this.resolveSession(req)
  }

  async signOut(req: Request): Promise<Response> {
    const config = resolveBetterAuthRuntimeConfig(this.config.runtimeConfig)
    const headers = new Headers(req.headers)
    headers.set('origin', headers.get('origin') ?? new URL(config.baseUrl).origin)

    const response = await getBetterAuth(this.config.runtimeConfig).handler(new Request(
      `${config.baseUrl}${config.basePath}/sign-out`,
      {
        method: 'POST',
        headers,
      },
    ))
    if (!response.ok) {
      const text = await response.text().catch((_error) => '')
      throw new Error(text || `Better Auth sign-out failed with HTTP ${response.status}`)
    }
    return response
  }

  async verifyAccessToken(token: string): Promise<TokenClaims | null> {
    const { getVerifiedAccessTokenClaims } = await import('../../../../convex/lib/auth')
    const claims = await getVerifiedAccessTokenClaims(token)
    return claims ? toTokenClaims(claims) : null
  }

  async getUserProfile(token: string): Promise<UserProfile | null> {
    const claims = await this.verifyAccessToken(token)
    return claims ? toUserProfile(claims) : null
  }

  async deleteUser(userId: string, req?: Request): Promise<void> {
    if (!req) {
      throw new Error('BetterAuthProvider.deleteUser requires the current authenticated request.')
    }
    const session = await this.resolveSession(req)
    if (!session || session.user.id !== userId) {
      throw new Error('BetterAuthProvider.deleteUser requires a matching authenticated session.')
    }
    await getBetterAuth(this.config.runtimeConfig).api.deleteUser({
      headers: req.headers,
      body: {},
    })
  }

  private async resolveSession(req: Request): Promise<Session | null> {
    const auth = getBetterAuth(this.config.runtimeConfig)
    const session = await auth.api.getSession({
      headers: req.headers,
    }).catch((error) => {
      if (isBetterAuthUnauthorizedError(error)) return null
      throw error
    })
    if (!session?.user?.id) return null

    const tokenPayload = await auth.api.getToken({
      headers: req.headers,
    }).catch((error) => {
      if (isBetterAuthUnauthorizedError(error)) return null
      throw error
    })
    const token = tokenPayload?.token
    if (!token) return null

    const claims = await this.verifyAccessToken(token)
    const expiresAt = typeof claims?.exp === 'number' ? claims.exp * 1000 : undefined

    return {
      accessToken: token,
      expiresAt,
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: firstNameFromBetterAuthUser(session.user.name),
        lastName: lastNameFromBetterAuthUser(session.user.name),
        profilePictureUrl: session.user.image ?? undefined,
        emailVerified: session.user.emailVerified,
      },
    }
  }
}

function toTokenClaims(claims: Record<string, unknown>): TokenClaims | null {
  if (
    typeof claims.iss !== 'string' ||
    typeof claims.sub !== 'string' ||
    typeof claims.exp !== 'number'
  ) {
    return null
  }

  return {
    ...claims,
    iss: claims.iss,
    sub: claims.sub,
    aud:
      typeof claims.aud === 'string' || Array.isArray(claims.aud)
        ? claims.aud
        : undefined,
    exp: claims.exp,
    iat: typeof claims.iat === 'number' ? claims.iat : undefined,
  }
}

function toUserProfile(claims: TokenClaims): UserProfile {
  const name = typeof claims.name === 'string' ? claims.name : ''
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    firstName: firstNameFromBetterAuthUser(name),
    lastName: lastNameFromBetterAuthUser(name),
    profilePictureUrl:
      typeof claims.profilePictureUrl === 'string'
        ? claims.profilePictureUrl
        : undefined,
    emailVerified:
      typeof claims.emailVerified === 'boolean' ? claims.emailVerified : undefined,
  }
}

function firstNameFromBetterAuthUser(name: string | null | undefined): string | undefined {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  return parts[0]
}

function lastNameFromBetterAuthUser(name: string | null | undefined): string | undefined {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  return parts.length > 1 ? parts.slice(1).join(' ') : undefined
}

function isBetterAuthUnauthorizedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { status?: unknown; statusCode?: unknown }
  return candidate.status === 'UNAUTHORIZED' || candidate.statusCode === 401
}
