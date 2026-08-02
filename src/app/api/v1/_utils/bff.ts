import { NextRequest, NextResponse } from 'next/server'
import type { CapabilityCheck } from '@overlay/app-core'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import {
  resolveAuthenticatedAppUser,
  type AuthenticatedAppUser,
} from '@/server/auth/app-api-auth'
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
import { getOverlayRuntimeConfig, isOverlayConfigError } from '@/server/config'
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
import {
  WORKSPACE_SHARE_RESOURCE_TYPES,
  type WorkspaceShareResourceType,
} from '@overlay/workspace-contracts'
import {
  getOwnerFundedOperation,
  ownerFundedOperationRequiresIdempotencyKey,
} from '@/server/billing/owner-funded-operations'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { logSecurityEvent } from '@/server/observability/security-events'
import { contextForRequest, withObservabilityContext } from '@/server/observability/context'
import { rejectCrossSiteBrowserMutation } from '@/server/security/browser-mutation-origin'

const API_KEY_CANDIDATE_RATE_LIMITS = [
  { bucket: 'api-key-auth:candidate:ip', limit: 60, windowMs: 60_000 },
  { bucket: 'api-key-auth:candidate:ip-hour', limit: 600, windowMs: 60 * 60_000 },
] as const

const API_KEY_REQUEST_RATE_LIMIT = {
  bucket: 'api-key:request:key',
  limit: 300,
  windowMs: 10 * 60_000,
} as const

const DEFAULT_AUTHENTICATED_ROUTE_RATE_LIMITS = [
  { bucket: 'api:default:ip', limit: 600, windowMs: 10 * 60_000 },
  { bucket: 'api:default:user', limit: 300, windowMs: 10 * 60_000 },
] as const

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

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
  let serverContext!: ReturnType<typeof getOverlayServerContext>
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
  const apiKeyCandidateLimit = await enforceApiKeyCandidateRateLimit(request, bearer, clientIp)
  if (apiKeyCandidateLimit) return apiKeyCandidateLimit

  const authResult = await resolveBffRouteAuth(request, parsedInput.parsedJson, bearer, clientIp)
  if (authResult instanceof Response) return authResult
  const auth = authResult

  let bffSafety
  try {
    bffSafety = await resolveBffSafety(request, auth)
  } catch (error) {
    return runtimeConfigErrorResponse(error)
  }
  if (bffSafety.originResponse) return bffSafety.originResponse

  const ownerFundedIdempotencyResponse = requireOwnerFundedIdempotency(request, auth)
  if (ownerFundedIdempotencyResponse) return ownerFundedIdempotencyResponse

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
  let resourceAuthorization = await evaluateResourceRoute({
    authorization: serverContext.authorizationService,
    evaluation: authorizationEvaluation,
    mode: authorizationEvaluation.mode,
    params: routeParams,
    parsedJson: parsedInput.parsedJson,
    parsedQuery: parsedInput.parsedQuery,
    policy: authorizationPolicy,
  })
  const workspaceShareResourceType = workspaceResourceType(authorizationPolicy.resource?.type)
  if (authorizationPolicy.access === 'resource' && workspaceShareResourceType) {
    const action = authorizationPolicy.resource!.action
    if (resourceAuthorization.resourceId && resourceAuthorization.decision?.allowed === false) {
      const shared = await serverContext.workspaceSharingService.checkAccess({
        action,
        actorUserId: auth.userId,
        workspaceId: workspace.workspace.id,
        resourceType: workspaceShareResourceType,
        resourceId: resourceAuthorization.resourceId,
      })
      if (shared.allowed && shared.ownerUserId) {
        resourceAuthorization = {
          ...resourceAuthorization,
          ownerUserId: shared.ownerUserId,
          decision: {
            ...resourceAuthorization.decision,
            allowed: true,
            effectiveAccessRole: shared.accessRole === 'viewer' ? 'viewer' : 'editor',
            reason: 'resource_access_granted',
          },
        }
      }
    } else if (!resourceAuthorization.resourceId && authorizationPolicy.resource?.optional) {
      const shared = await serverContext.workspaceSharingService.listAccessibleResources({
        action,
        actorUserId: auth.userId,
        workspaceId: workspace.workspace.id,
        resourceType: workspaceShareResourceType,
      })
      const merged = new Map((resourceAuthorization.grantedResources ?? [])
        .map((item) => [item.resourceId, item]))
      for (const item of shared) merged.set(item.resourceId, item)
      resourceAuthorization = {
        ...resourceAuthorization,
        grantedResources: [...merged.values()],
      }
    }
  }
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
  addDefaultAuthenticatedRouteRateLimits(rateLimits, bffSafety.defaultRateLimitEnabled, clientIp, auth.userId)
  if (auth.authType === 'api-key' && auth.apiKeyId) {
    rateLimits.push({ ...API_KEY_REQUEST_RATE_LIMIT, key: auth.apiKeyId })
  }
  const rateLimitResponse = await enforceBffRouteRateLimits(request, rateLimits)
  if (rateLimitResponse) return rateLimitResponse

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
    requestFingerprint: await fingerprintApiRequest(request),
    requestIdempotencyKey: request.headers.get('idempotency-key')?.trim() || null,
  } as AppApiRouteContext

  const response = await handleIdempotentMutation(
    request,
    auth.userId,
    async () => await withObservabilityContext(
      contextForRequest(request, {
        provider: appDataCapabilities.provider,
        tenantId: auth.organizationId,
      }),
      async () => await service(request, serviceContext),
    ),
    { repository: idempotencyRepository },
  )
  const standardizedResponse = await standardizePaginatedListResponse(request, response)
  await recordBffMutationAuditIfNeeded({
    auth,
    clientIp,
    enabled: bffSafety.mutationAuditEnabled,
    request,
    response: standardizedResponse,
    serverContext,
  })
  return standardizedResponse
}

async function resolveBffSafety(
  request: NextRequest,
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthenticatedAppUser>>>,
): Promise<{
  defaultRateLimitEnabled: boolean
  mutationAuditEnabled: boolean
  originResponse: Response | null
}> {
  const runtimeConfig = await getOverlayRuntimeConfig()
  return {
    defaultRateLimitEnabled: runtimeConfig.features.apiDefaultRateLimit !== false,
    mutationAuditEnabled: runtimeConfig.features.apiMutationAudit !== false,
    originResponse: runtimeConfig.features.apiMutationOriginGuard !== false
      ? rejectCrossSiteBrowserMutation(request, auth)
      : null,
  }
}

async function enforceApiKeyCandidateRateLimit(
  request: NextRequest,
  bearer: string | undefined,
  clientIp: string,
): Promise<Response | null> {
  if (!isApiKeyCandidate(bearer)) return null
  try {
    return await enforceRateLimits(
      request,
      API_KEY_CANDIDATE_RATE_LIMITS.map((rule) => ({ ...rule, key: clientIp })),
    )
  } catch (error) {
    if (isOverlayConfigError(error)) return runtimeConfigErrorResponse(error)
    throw error
  }
}

async function resolveBffRouteAuth(
  request: NextRequest,
  parsedJson: Record<string, unknown>,
  bearer: string | undefined,
  clientIp: string,
): Promise<AuthenticatedAppUser | Response> {
  try {
    const auth = await resolveAuthenticatedAppUser(request, parsedJson, {
      clientIp,
      requiredApiKeyScopes: getRequiredApiKeyScopesForRoute(
        request.method,
        request.nextUrl.pathname,
      ),
    })
    if (auth) return auth
  } catch (error) {
    if (isOverlayConfigError(error)) return runtimeConfigErrorResponse(error)
    throw error
  }

  return NextResponse.json(
    { error: 'Unauthorized' },
    {
      status: 401,
      headers: {
        'Cache-Control': 'no-store',
        'WWW-Authenticate': bearer ? 'Bearer error="invalid_token"' : 'Bearer',
      },
    },
  )
}

function requireOwnerFundedIdempotency(
  request: NextRequest,
  auth: AuthenticatedAppUser,
): Response | null {
  const operation = getOwnerFundedOperation(request.method, request.nextUrl.pathname)
  if (!ownerFundedOperationRequiresIdempotencyKey(operation) || request.headers.get('idempotency-key')?.trim()) {
    return null
  }
  logSecurityEvent('owner_funded_idempotency_missing', {
    authType: auth.authType,
    operation: operation.id,
    userHash: hashOperationalIdentifier('security-user:v1', auth.userId),
  })
  return NextResponse.json(
    {
      error: 'Idempotency-Key header is required for owner-funded operations',
      code: 'idempotency_key_required',
      operation: operation.id,
    },
    { status: 428 },
  )
}

function addDefaultAuthenticatedRouteRateLimits(
  rateLimits: Parameters<typeof enforceRateLimits>[1],
  enabled: boolean,
  clientIp: string,
  userId: string,
): void {
  if (!enabled || rateLimits.length > 0) return
  rateLimits.push(...DEFAULT_AUTHENTICATED_ROUTE_RATE_LIMITS.map((rule) => ({
    ...rule,
    key: rule.bucket.endsWith(':ip') ? clientIp : userId,
  })))
}

async function enforceBffRouteRateLimits(
  request: NextRequest,
  rateLimits: Parameters<typeof enforceRateLimits>[1],
): Promise<Response | null> {
  if (rateLimits.length === 0) return null
  try {
    const response = await enforceRateLimits(request, rateLimits)
    if (!response) markRateLimitsSatisfied(request)
    return response
  } catch (error) {
    if (isOverlayConfigError(error)) return runtimeConfigErrorResponse(error)
    throw error
  }
}

async function recordBffMutationAuditIfNeeded(args: {
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthenticatedAppUser>>>
  clientIp: string
  enabled: boolean
  request: NextRequest
  response: Response
  serverContext: ReturnType<typeof getOverlayServerContext>
}): Promise<void> {
  if (!args.enabled || SAFE_METHODS.has(args.request.method.toUpperCase())) return
  await recordBffMutationAudit(args)
}

async function recordBffMutationAudit(args: {
  auth: NonNullable<Awaited<ReturnType<typeof resolveAuthenticatedAppUser>>>
  clientIp: string
  request: NextRequest
  response: Response
  serverContext: ReturnType<typeof getOverlayServerContext>
}): Promise<void> {
  const actorType = args.auth.authType === 'api-key'
    ? 'api_key'
    : args.auth.authType === 'service'
      ? 'service'
      : 'user'
  try {
    await args.serverContext.auditService.record({
      action: 'api.mutation.completed',
      actorType,
      actorUserId: args.auth.userId,
      ...(actorType === 'api_key' ? { actorApiKeyId: args.auth.apiKeyId } : {}),
      ipAddress: args.clientIp,
      metadata: {
        method: args.request.method.toUpperCase(),
        path: args.request.nextUrl.pathname,
        statusCode: args.response.status,
      },
      outcome: args.response.ok ? 'success' : 'failure',
      resourceId: args.request.nextUrl.pathname,
      resourceType: 'api_route',
    })
  } catch (_error) {
    // Audit infrastructure must not turn a completed customer mutation into a second,
    // externally visible failure. The security event preserves an actionable signal.
    logSecurityEvent('api_mutation_audit_failed', {
      authType: args.auth.authType,
      method: args.request.method.toUpperCase(),
      path: args.request.nextUrl.pathname,
      userHash: hashOperationalIdentifier('security-user:v1', args.auth.userId),
    })
  }
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

function workspaceResourceType(value: string | undefined): WorkspaceShareResourceType | undefined {
  return WORKSPACE_SHARE_RESOURCE_TYPES.find((type) => type === value)
}
