import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AdministrativeAuthorizationError } from '@/server/admin'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AuthorizationAdministrationActor } from '@/server/authorization'
import { getClientIp } from '@/server/security/rate-limit'

export function authorizationAdministrationService() {
  return getOverlayServerContext().authorizationAdministrationService
}

export function authorizationActor(
  request: NextRequest,
  context: AppApiRouteContext,
): AuthorizationAdministrationActor {
  return {
    actorApiKeyId: context.auth.apiKeyId,
    actorType: context.auth.authType === 'api-key' ? 'api_key' : 'user',
    actorUserId: context.auth.userId,
    ipAddress: getClientIp(request),
    requestId: request.headers.get('x-request-id') ?? undefined,
  }
}

export async function authorizationAdminErrorResponse(
  error: unknown,
  request: NextRequest,
  context: AppApiRouteContext,
  action: string,
  resourceType: string,
): Promise<Response> {
  if (error instanceof AdministrativeAuthorizationError) {
    await getOverlayServerContext().auditService.record({
      action,
      actorApiKeyId: context.auth.apiKeyId,
      actorType: context.auth.authType === 'api-key' ? 'api_key' : 'user',
      actorUserId: context.auth.userId,
      ipAddress: getClientIp(request),
      outcome: 'denied',
      requestId: request.headers.get('x-request-id') ?? undefined,
      resourceType,
    })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (isUniqueConstraintError(error)) {
    return NextResponse.json({ error: 'An authorization record with that name already exists' }, { status: 409 })
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
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === '23505',
  ) || (error instanceof Error && /already exists|duplicate/i.test(error.message))
}
