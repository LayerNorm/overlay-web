import 'server-only'

import { WorkOS } from '@workos-inc/node'
import type {
  AuthProvider,
  Session,
  TokenClaims,
  UserProfile,
} from '@overlay/app-core'

export interface WorkOSAuthProviderConfig {
  clientId?: string
  apiKey?: string
  devClientId?: string
  devApiKey?: string
  allowDevFallbacks?: boolean
}

export class WorkOSAuthProvider implements AuthProvider {
  readonly providerConfigSummary: {
    provider: 'workos'
    clientId?: string
    hasApiKey: boolean
  }

  constructor(private readonly config?: WorkOSAuthProviderConfig) {
    const resolved = this.resolveConfig()
    this.providerConfigSummary = {
      provider: 'workos',
      ...(resolved.clientId ? { clientId: resolved.clientId } : {}),
      hasApiKey: Boolean(resolved.apiKey),
    }
  }

  async getSession(req: Request): Promise<Session | null> {
    void req
    const { getSession } = await import('@/server/auth/workos-auth')
    const session = await getSession({ allowRefresh: false })
    return session ? toProviderSession(session) : null
  }

  async refreshSession(req: Request): Promise<Session | null> {
    void req
    const { getSession } = await import('@/server/auth/workos-auth')
    const session = await getSession({ allowRefresh: true })
    return session ? toProviderSession(session) : null
  }

  async signOut(req: Request): Promise<void> {
    void req
    const { clearSession } = await import('@/server/auth/workos-auth')
    await clearSession()
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

  async deleteUser(userId: string): Promise<void> {
    const resolved = this.resolveConfig()
    if (!resolved.apiKey) {
      throw new Error('WorkOS API key is not configured for the selected auth provider.')
    }
    const workos = new WorkOS({ apiKey: resolved.apiKey })
    await workos.userManagement.deleteUser(userId)
  }

  private resolveConfig(): { clientId: string; apiKey: string | undefined } {
    if (this.config) {
      const allowDevFallbacks = this.config.allowDevFallbacks === true
      return {
        clientId:
          this.config.clientId ??
          (allowDevFallbacks ? this.config.devClientId : undefined) ??
          '',
        apiKey:
          this.config.apiKey ??
          (allowDevFallbacks ? this.config.devApiKey : undefined),
      }
    }

    const isDev = process.env.NODE_ENV === 'development'
    return {
      clientId: isDev
        ? process.env.DEV_WORKOS_CLIENT_ID || process.env.WORKOS_CLIENT_ID || ''
        : process.env.WORKOS_CLIENT_ID || '',
      apiKey: isDev
        ? process.env.DEV_WORKOS_API_KEY || process.env.WORKOS_API_KEY
        : process.env.WORKOS_API_KEY,
    }
  }
}

function toProviderSession(session: {
  accessToken: string
  refreshToken?: string
  user: Session['user']
  expiresAt?: number
}): Session {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: session.user,
    expiresAt: session.expiresAt,
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
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    firstName: typeof claims.firstName === 'string' ? claims.firstName : undefined,
    lastName: typeof claims.lastName === 'string' ? claims.lastName : undefined,
    profilePictureUrl:
      typeof claims.profilePictureUrl === 'string'
        ? claims.profilePictureUrl
        : undefined,
    emailVerified:
      typeof claims.emailVerified === 'boolean' ? claims.emailVerified : undefined,
  }
}
