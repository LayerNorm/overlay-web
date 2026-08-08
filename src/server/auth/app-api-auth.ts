import 'server-only'

import { logger } from '@/server/observability/logger'
import type { NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getServiceAuthHeaderName, verifyServiceAuthToken } from '@/server/auth/service-auth'
import { consumeServiceAuthReplayNonce } from '@/server/auth/service-auth-replay'
import { isApiKeyCandidate } from '@/server/auth/api-keys'
import { hasRequiredApiKeyScopes, type ApiKeyScope } from '@/shared/auth/api-key-scopes'

export type AuthenticatedAppUser = {
  userId: string
  accessToken: string
  authType: 'session' | 'api-key' | 'service' | 'access-token'
  apiKeyId?: string
  organizationId?: string
  scopes?: ApiKeyScope[]
}

export function resolveVerifiedBearerUserId(
  claims: Record<string, unknown> | null,
  claimedUserId: string,
): string | null {
  const verifiedUserId = typeof claims?.sub === 'string' ? claims.sub.trim() : ''
  if (!verifiedUserId) return null
  if (claimedUserId && claimedUserId !== verifiedUserId) return null
  return verifiedUserId
}

type ResolveAuthenticatedAppUserOptions = {
  clientIp?: string
  requiredApiKeyScopes?: readonly ApiKeyScope[]
}

const authenticatedAppUsers = new WeakMap<Request, AuthenticatedAppUser>()

/**
 * Browser requests use the session cookie. Server-side tool calls (e.g. Agent)
 * send the same provider-issued access token + userId in the JSON body and/or
 * Authorization header.
 */
export async function resolveAuthenticatedAppUser(
  request: NextRequest,
  body: { accessToken?: string; userId?: string },
  options: ResolveAuthenticatedAppUserOptions = {},
): Promise<AuthenticatedAppUser | null> {
  const cached = getCachedAuthenticatedAppUser(request, options.requiredApiKeyScopes)
  if (cached) return cached

  const ctx = getOverlayServerContext()
  const session = await ctx.auth.getSession(request)
  if (session) {
    const claims = await ctx.auth.verifyAccessToken(session.accessToken).catch((_error) => null)
    const organizationId = organizationIdFromClaims(claims)
    return cacheAuthenticatedAppUser(request, {
      userId: session.user.id,
      accessToken: session.accessToken,
      authType: 'session',
      ...(organizationId ? { organizationId } : {}),
    })
  }

  const authHeader = request.headers.get('authorization')
  const bearer =
    authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : undefined
  if (shouldAttemptApiKeyAuth(bearer, options)) {
    const apiKeyAuth = await ctx.apiKeyService.validate({
      apiKey: bearer,
      clientIp: options.clientIp,
      requiredScopes: options.requiredApiKeyScopes,
    }).catch((error) => {
      logger.error('[api-key-auth] validation failed', error)
      return null
    })
    if (apiKeyAuth) {
      return cacheAuthenticatedAppUser(request, {
        userId: apiKeyAuth.userId,
        accessToken: '',
        authType: 'api-key',
        apiKeyId: apiKeyAuth.id,
        scopes: apiKeyAuth.scopes,
      })
    }
  }

  const internalUserId =
    typeof body.userId === 'string' && body.userId.trim()
      ? body.userId.trim()
      : request.nextUrl.searchParams.get('userId')?.trim() || ''
  const serviceAuth = await verifyServiceAuthToken(
    request.headers.get(getServiceAuthHeaderName()),
    {
      method: request.method,
      path: request.nextUrl.pathname,
      userId: internalUserId || undefined,
      replayConsumer: consumeServiceAuthReplayNonce,
    },
  )
  if (serviceAuth) {
    return cacheAuthenticatedAppUser(request, {
      userId: serviceAuth.userId,
      accessToken: '',
      authType: 'service',
    })
  }

  const token =
    (typeof body.accessToken === 'string' && body.accessToken.trim()) || bearer
  const queryUserId = request.nextUrl.searchParams.get('userId')?.trim() || ''
  const claimedUserId =
    typeof body.userId === 'string' && body.userId.trim()
      ? body.userId.trim()
      : queryUserId
  if (!token) return null

  const claims = await ctx.auth.verifyAccessToken(token).catch((_error) => null)
  const verifiedUserId = resolveVerifiedBearerUserId(claims, claimedUserId)
  if (!claims || !verifiedUserId) return null

  const organizationId = organizationIdFromClaims(claims)
  return cacheAuthenticatedAppUser(request, {
    userId: verifiedUserId,
    accessToken: token,
    authType: 'access-token',
    ...(organizationId ? { organizationId } : {}),
  })
}

function organizationIdFromClaims(
  claims: Record<string, unknown> | null,
): string | null {
  if (!claims) return null
  for (const key of ['organization_id', 'org_id', 'organizationId']) {
    const value = claims[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function shouldAttemptApiKeyAuth(
  bearer: string | undefined,
  options: ResolveAuthenticatedAppUserOptions,
): bearer is string {
  if (!isApiKeyCandidate(bearer)) return false
  return Boolean(options.requiredApiKeyScopes?.length)
}

function cacheAuthenticatedAppUser(
  request: Request,
  auth: AuthenticatedAppUser,
): AuthenticatedAppUser {
  authenticatedAppUsers.set(request, auth)
  return auth
}

function getCachedAuthenticatedAppUser(
  request: Request,
  requiredApiKeyScopes: readonly ApiKeyScope[] | undefined,
): AuthenticatedAppUser | null {
  const cached = authenticatedAppUsers.get(request)
  if (!cached) return null
  if (
    cached.authType === 'api-key' &&
    !hasRequiredApiKeyScopes(cached.scopes ?? [], requiredApiKeyScopes)
  ) {
    return null
  }
  return cached
}
