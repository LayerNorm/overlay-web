import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { AdministrativeAuthorizationError } from '@/server/admin'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { GovernanceActor } from '@/server/governance'
import { GovernanceServiceError } from '@/server/governance'
import { getClientIp } from '@/server/security/rate-limit'

export function governanceService() {
  return getOverlayServerContext().governanceService
}

export function governanceActor(
  request: NextRequest,
  context: AppApiRouteContext,
): GovernanceActor {
  return {
    actorApiKeyId: context.auth.apiKeyId,
    actorType: context.auth.authType === 'api-key' ? 'api_key' : 'user',
    actorUserId: context.auth.userId,
    ipAddress: getClientIp(request),
    requestId: request.headers.get('x-request-id') ?? undefined,
  }
}

export function governanceErrorResponse(error: unknown): Response {
  if (error instanceof AdministrativeAuthorizationError) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (error instanceof GovernanceServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  throw error
}
