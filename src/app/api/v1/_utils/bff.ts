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
import { handleIdempotentMutation } from '@/server/app-api/idempotency'
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
  try {
    appDataCapabilities = getOverlayServerContext().appDataCapabilities
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
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimits = getEndpointRateLimitSpecs({
    ip: clientIp,
    method: request.method,
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
  } as AppApiRouteContext

  const response = await handleIdempotentMutation(
    request,
    auth.userId,
    async () => service(request, serviceContext),
    { appDataProvider: appDataCapabilities.provider },
  )
  return standardizePaginatedListResponse(request, response)
}

function getBearerToken(request: NextRequest): string | undefined {
  const authHeader = request.headers.get('authorization')
  return authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : undefined
}
