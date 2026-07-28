import { NextRequest, NextResponse } from 'next/server'
import type { CapabilityCheck } from '@overlay/app-core'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import {
  enforceRateLimits,
  getClientIp,
  markRateLimitsSatisfied,
} from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import {
  fingerprintApiRequest,
  handleIdempotentMutation,
} from '@/server/app-api/idempotency'
import { standardizePaginatedListResponse } from '@/server/app-api/pagination'
import { getRequiredApiKeyScopesForRoute, isApiKeyCandidate } from '@/server/auth/api-keys'
import {
  capabilityDisabledResponse,
  getOverlayCapabilities,
  getRequiredCapabilityForRoute,
  runtimeConfigErrorResponse,
} from '@/server/capabilities'
import { parseApiBoundaryInput } from '@/server/app-api/boundary'
import { isOverlayConfigError } from '@/server/config'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  appDataRouteUnsupportedResponse,
  getAppDataRouteSupport,
} from '@/server/app-data/route-support'
import {
  getOwnerFundedOperation,
  ownerFundedOperationRequiresIdempotencyKey,
} from '@/server/billing/owner-funded-operations'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { logSecurityEvent } from '@/server/observability/security-events'

const API_KEY_CANDIDATE_RATE_LIMITS = [
  { bucket: 'api-key-auth:candidate:ip', limit: 60, windowMs: 60_000 },
  { bucket: 'api-key-auth:candidate:ip-hour', limit: 600, windowMs: 60 * 60_000 },
] as const

const API_KEY_REQUEST_RATE_LIMIT = {
  bucket: 'api-key:request:key',
  limit: 300,
  windowMs: 10 * 60_000,
} as const

export type BffRouteContext = {
  params: Promise<Record<string, string | string[]>>
}

export type BffDomainService = (
  request: NextRequest,
  context: AppApiRouteContext,
) => Response | Promise<Response>

export async function handleBffRoute(
  request: NextRequest,
  context: unknown,
  service: BffDomainService,
): Promise<Response> {
  let capabilities: CapabilityCheck
  try {
    capabilities = await getOverlayCapabilities()
  } catch (error) {
    return runtimeConfigErrorResponse(error)
  }
  let appDataCapabilities
  let idempotencyRepository
  try {
    const serverContext = getOverlayServerContext()
    appDataCapabilities = serverContext.appDataCapabilities
    idempotencyRepository = serverContext.appData.repositories.idempotency
  } catch (error) {
    return runtimeConfigErrorResponse(error)
  }
  const appDataRouteSupport = getAppDataRouteSupport({
    appDataCapabilities,
    method: request.method,
    pathname: request.nextUrl.pathname,
  })
  if (appDataRouteSupport.status === 'unsupported') {
    return appDataRouteUnsupportedResponse({
      databaseProvider: appDataCapabilities.provider,
      method: request.method,
      pathname: request.nextUrl.pathname,
      support: appDataRouteSupport,
    })
  }
  const requiredCapability = getRequiredCapabilityForRoute(request.method, request.nextUrl.pathname)
  if (requiredCapability && !capabilities[requiredCapability]) {
    return capabilityDisabledResponse(requiredCapability)
  }

  const parsedInput = await parseApiBoundaryInput(request)
  if (parsedInput.error) return parsedInput.error
  const clientIp = getClientIp(request)
  const bearer = getBearerToken(request)
  if (isApiKeyCandidate(bearer)) {
    let apiKeyCandidateLimit: Response | null
    try {
      apiKeyCandidateLimit = await enforceRateLimits(
        request,
        API_KEY_CANDIDATE_RATE_LIMITS.map((rule) => ({ ...rule, key: clientIp })),
      )
    } catch (error) {
      if (isOverlayConfigError(error)) return runtimeConfigErrorResponse(error)
      throw error
    }
    if (apiKeyCandidateLimit) return apiKeyCandidateLimit
  }

  let auth
  try {
    auth = await resolveAuthenticatedAppUser(request, parsedInput.parsedJson, {
      clientIp,
      requiredApiKeyScopes: getRequiredApiKeyScopesForRoute(
        request.method,
        request.nextUrl.pathname,
      ),
    })
  } catch (error) {
    if (isOverlayConfigError(error)) return runtimeConfigErrorResponse(error)
    throw error
  }
  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          'WWW-Authenticate': bearer
            ? 'Bearer error="invalid_token"'
            : 'Bearer',
        },
      },
    )
  }

  const ownerFundedOperation = getOwnerFundedOperation(
    request.method,
    request.nextUrl.pathname,
  )
  if (
    ownerFundedOperationRequiresIdempotencyKey(ownerFundedOperation) &&
    !request.headers.get('idempotency-key')?.trim()
  ) {
    logSecurityEvent('owner_funded_idempotency_missing', {
      authType: auth.authType,
      operation: ownerFundedOperation.id,
      userHash: hashOperationalIdentifier('security-user:v1', auth.userId),
    })
    return NextResponse.json(
      {
        error: 'Idempotency-Key header is required for owner-funded operations',
        code: 'idempotency_key_required',
        operation: ownerFundedOperation.id,
      },
      { status: 428 },
    )
  }

  const rateLimits = getEndpointRateLimitSpecs({
    ...(clientIp !== 'unknown'
      ? {
          deviceRiskKey: hashOperationalIdentifier(
            'owner-funded-device-risk:v1',
            [
              clientIp,
              request.headers.get('user-agent')?.slice(0, 256) ?? '',
              auth.authType,
            ].join('\n'),
          ),
        }
      : {}),
    ip: clientIp,
    method: request.method,
    organizationId: auth.organizationId,
    pathname: request.nextUrl.pathname,
    userId: auth.userId,
  })
  if (auth.authType === 'api-key' && auth.apiKeyId) {
    rateLimits.push({ ...API_KEY_REQUEST_RATE_LIMIT, key: auth.apiKeyId })
  }
  if (rateLimits.length > 0) {
    let rateLimitResponse: Response | null
    try {
      rateLimitResponse = await enforceRateLimits(request, rateLimits)
    } catch (error) {
      if (isOverlayConfigError(error)) return runtimeConfigErrorResponse(error)
      throw error
    }
    if (rateLimitResponse) return rateLimitResponse
    markRateLimitsSatisfied(request)
  }

  const serviceContext = {
    params: Promise.resolve({}),
    ...(context && typeof context === 'object' ? context as object : {}),
    auth,
    parsedQuery: parsedInput.parsedQuery,
    parsedJson: parsedInput.parsedJson,
    parsedFormData: parsedInput.parsedFormData,
    capabilities,
    appDataCapabilities,
    requestFingerprint: await fingerprintApiRequest(request),
    requestIdempotencyKey: request.headers.get('idempotency-key')?.trim() || null,
  } as AppApiRouteContext

  const response = await handleIdempotentMutation(
    request,
    auth.userId,
    async () => service(request, serviceContext),
    { repository: idempotencyRepository },
  )
  return standardizePaginatedListResponse(request, response)
}

function getBearerToken(request: NextRequest): string | undefined {
  const authHeader = request.headers.get('authorization')
  return authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : undefined
}
