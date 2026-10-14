import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AdministrativeAuthorizationError } from '@/server/admin/AdministrativeService'
import type { AuthorizationAdministrationActor } from '@/server/authorization/AuthorizationAdministrationService'
import { adminServices } from '@/server/bootstrap'
import { checkOperator, type OperatorContext } from '@/server/operator-gate'
import { getClientIp } from '@/server/request'

/**
 * Minimal stand-in for the web app's `AppApiRouteContext`, shaped so the
 * copied admin routes need no body changes. `auth` mirrors the BFF shape;
 * the admin app has no API keys, so authType is always 'user'.
 */
export type AdminRouteContext = {
  auth: {
    userId: string
    accessToken: string
    apiKeyId: undefined
    /** Always 'user' in this app; unioned so copied routes comparing to
     * 'api-key' still typecheck identically to the web originals. */
    authType: 'user' | 'api-key'
  }
  operator: OperatorContext
  parsedJson: Record<string, unknown>
  parsedQuery: Record<string, unknown>
}

export type AdminDomainService = (
  request: NextRequest,
  context: AdminRouteContext,
) => Promise<Response>

/**
 * Gate + context builder for every /api/v1/admin/* route in this app.
 * Route handlers mutate cookies (idle renewal, token refresh) so the gate
 * runs with mutableCookies.
 */
export async function handleAdminRoute(
  request: NextRequest,
  _config: Record<string, never>,
  service: AdminDomainService,
): Promise<Response> {
  const gate = await checkOperator({ mutableCookies: true })
  if (!gate.ok) {
    if (gate.reason === 'no-session') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const context: AdminRouteContext = {
    auth: {
      userId: gate.operator.userId,
      accessToken: gate.operator.accessToken,
      apiKeyId: undefined,
      authType: 'user',
    },
    operator: gate.operator,
    parsedJson: await parseJsonBody(request),
    parsedQuery: parseQuery(request),
  }
  return service(request, context)
}

function parseQuery(request: NextRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (params[key] !== undefined) {
      params[key] = [...(Array.isArray(params[key]) ? (params[key] as unknown[]) : [params[key]]), value]
    } else {
      params[key] = value === 'true' ? true : value === 'false' ? false : value
    }
  }
  return params
}

async function parseJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'HEAD') return {}
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function authorizationAdministrationService() {
  return adminServices().authorizationAdministrationService
}

export function authorizationActor(
  request: NextRequest,
  context: AdminRouteContext,
): AuthorizationAdministrationActor {
  return {
    actorApiKeyId: context.auth.apiKeyId,
    actorType: 'user',
    actorUserId: context.auth.userId,
    ipAddress: getClientIp(request),
    requestId: request.headers.get('x-request-id') ?? undefined,
  }
}

export async function authorizationAdminErrorResponse(
  error: unknown,
  request: NextRequest,
  context: AdminRouteContext,
  action: string,
  resourceType: string,
): Promise<Response> {
  if (error instanceof AdministrativeAuthorizationError) {
    await adminServices().auditService.record({
      action,
      actorApiKeyId: context.auth.apiKeyId,
      actorType: 'user',
      actorUserId: context.auth.userId,
      ipAddress: getClientIp(request),
      outcome: 'denied',
      requestId: request.headers.get('x-request-id') ?? undefined,
      resourceType,
    })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (isUniqueConstraintError(error)) {
    return NextResponse.json(
      { error: 'An authorization record with that name already exists' },
      { status: 409 },
    )
  }
  if (error instanceof Error) {
    if (/not found/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (/cannot|archived|externally managed|system authorization/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
  }
  throw error
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === '23505',
    ) ||
    (error instanceof Error && /already exists|duplicate/i.test(error.message))
  )
}
