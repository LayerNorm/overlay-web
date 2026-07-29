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
  evaluateAuthorizationRoute,
  evaluateResourceRoute,
  firstDeniedCapability,
  getAuthorizationEnforcementMode,
  getAuthorizationRoutePolicy,
} from '@/server/authorization'
import { recordAuthorizationDenial } from '@/server/authorization/authorization-denial-audit'
import { logger } from '@/server/observability/logger'
import {
  appDataRouteUnsupportedResponse,
  getAppDataRouteSupport,
} from '@/server/app-data/route-support'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'
import {
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_HEADER,
} from '@/shared/workspaces/constants'

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
  let serverContext: ReturnType<typeof getOverlayServerContext>
  try {
    serverContext = getOverlayServerContext()
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
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let workspace
  const requestedByHeader = request.headers.get(ACTIVE_WORKSPACE_HEADER)?.trim() || undefined
  const requestedByCookie = request.cookies.get(ACTIVE_WORKSPACE_COOKIE)?.value.trim() || undefined
  try {
    workspace = await serverContext.workspaceService.resolveActiveWorkspace(
      auth.userId,
      requestedByHeader ?? requestedByCookie,
    )
  } catch (error) {
    if (requestedByHeader && error instanceof WorkspaceServiceError && error.code === 'not_found') {
      return NextResponse.json(
        { error: 'Not found', code: 'workspace_not_found' },
        { status: 404 },
      )
    }
    if (requestedByCookie && error instanceof WorkspaceServiceError && error.code === 'not_found') {
      workspace = await serverContext.workspaceService.resolveActiveWorkspace(auth.userId)
    } else {
      throw error
    }
  }

  const authorizationPolicy = getAuthorizationRoutePolicy(
    request.method,
    request.nextUrl.pathname,
  )
  if (!authorizationPolicy) {
    logger.error('[Authorization] Missing route policy', {
      method: request.method,
      pathname: request.nextUrl.pathname,
    })
    return NextResponse.json({
      error: 'Authorization policy missing',
      code: 'authorization_policy_missing',
    }, { status: 500 })
  }
  await serverContext.fixedRoleAuthorizationBridge.ensureDefaultUserRole(auth.userId)
  const authorizationEvaluation = await evaluateAuthorizationRoute({
    authorization: serverContext.authorizationService,
    mode: getAuthorizationEnforcementMode(),
    policy: authorizationPolicy,
    userId: auth.userId,
  })
  const deniedCapability = firstDeniedCapability(authorizationEvaluation)
  if (deniedCapability) {
    logger.warn('[Authorization] Route capability denied', {
      allowed: authorizationEvaluation.allowed,
      authType: auth.authType,
      capability: deniedCapability.capability,
      method: request.method,
      mode: authorizationEvaluation.mode,
      pathname: request.nextUrl.pathname,
      reason: deniedCapability.reason,
      userId: auth.userId,
    })
  }
  if (!authorizationEvaluation.allowed) {
    await recordAuthorizationDenial({
      auditService: serverContext.auditService,
      actor: auth,
      clientIp,
      capability: deniedCapability?.capability,
      method: request.method,
      pathname: request.nextUrl.pathname,
      reason: deniedCapability?.reason ?? 'authorization_denied',
      requestId: request.headers.get('x-request-id') ?? undefined,
    })
    return NextResponse.json({
      error: 'Forbidden',
      code: 'authorization_denied',
      capability: deniedCapability?.capability,
      reason: deniedCapability?.reason ?? 'authorization_denied',
    }, { status: 403 })
  }

  const routeParams = await resolveRouteParams(context)
  const resourceAuthorization = await evaluateResourceRoute({
    authorization: serverContext.authorizationService,
    evaluation: authorizationEvaluation,
    mode: authorizationEvaluation.mode,
    params: routeParams,
    parsedJson: parsedInput.parsedJson,
    parsedQuery: parsedInput.parsedQuery,
    policy: authorizationPolicy,
  })
  const conversationParticipantAccess = resourceAuthorization.resourceId
    && resourceAuthorization.decision?.resourceType === 'conversation'
    ? await serverContext.appData.repositories.conversationCollaboration.canAccessConversation({
      actorUserId: auth.userId,
      workspaceId: workspace.workspace.id,
      conversationId: resourceAuthorization.resourceId,
    })
    : false
  if (
    resourceAuthorization.decision
    && !resourceAuthorization.decision.allowed
    && !conversationParticipantAccess
  ) {
    logger.warn('[Authorization] Resource access denied', {
      action: resourceAuthorization.decision.requiredAction,
      method: request.method,
      pathname: request.nextUrl.pathname,
      reason: resourceAuthorization.decision.reason,
      resourceId: resourceAuthorization.resourceId,
      resourceType: resourceAuthorization.decision.resourceType,
      userId: auth.userId,
    })
    if (authorizationEvaluation.mode === 'enforce') {
      await recordAuthorizationDenial({
        auditService: serverContext.auditService,
        actor: auth,
        clientIp,
        capability: resourceAuthorization.decision.capability,
        method: request.method,
        pathname: request.nextUrl.pathname,
        reason: resourceAuthorization.decision.reason,
        requestId: request.headers.get('x-request-id') ?? undefined,
        resourceId: resourceAuthorization.resourceId,
        resourceType: resourceAuthorization.decision.resourceType,
      })
      return NextResponse.json({
        error: 'Not found',
        code: 'resource_not_found',
      }, { status: 404 })
    }
  }
  if (
    resourceAuthorization.resourceId
    && resourceAuthorization.decision?.resourceType === 'conversation'
  ) {
    try {
      await serverContext.workspaceService.assertResourceWorkspace({
        actorUserId: auth.userId,
        workspaceId: workspace.workspace.id,
        resourceType: 'conversation',
        resourceId: resourceAuthorization.resourceId,
      })
      if (!conversationParticipantAccess && resourceAuthorization.decision.allowed === false) {
        return NextResponse.json({
          error: 'Not found',
          code: 'resource_not_found',
        }, { status: 404 })
      }
    } catch (error) {
      if (error instanceof WorkspaceServiceError && error.code === 'not_found') {
        return NextResponse.json({
          error: 'Not found',
          code: 'resource_not_found',
        }, { status: 404 })
      }
      throw error
    }
  }

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
    params: Promise.resolve(routeParams),
    ...(context && typeof context === 'object' ? context as object : {}),
    auth,
    parsedQuery: parsedInput.parsedQuery,
    parsedJson: parsedInput.parsedJson,
    parsedFormData: parsedInput.parsedFormData,
    capabilities,
    appDataCapabilities,
    workspace,
    authorization: {
      evaluation: authorizationEvaluation,
      policy: authorizationPolicy,
      resourceDecision: resourceAuthorization.decision,
      resourceId: resourceAuthorization.resourceId,
      resourceOwnerUserId: resourceAuthorization.ownerUserId,
      grantedResources: resourceAuthorization.grantedResources,
    },
  } as AppApiRouteContext

  const response = await handleIdempotentMutation(
    request,
    auth.userId,
    async () => service(request, serviceContext),
    { repository: idempotencyRepository },
  )
  return standardizePaginatedListResponse(request, response)
}

async function resolveRouteParams(context: unknown): Promise<Record<string, string | string[]>> {
  if (!context || typeof context !== 'object' || !('params' in context)) return {}
  const params = await Promise.resolve((context as BffRouteContext).params)
  return params ?? {}
}

function getBearerToken(request: NextRequest): string | undefined {
  const authHeader = request.headers.get('authorization')
  return authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : undefined
}
