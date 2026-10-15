import type { NextRequest } from 'next/server'

import type { AuthorizationAdministrationActor } from '@/server/authorization/AuthorizationAdministrationService'
import type { AdminRouteContext } from '@/server/guard'
import { getClientIp } from '@/server/guard'

export function authorizationActor(
  request: NextRequest,
  context: AdminRouteContext,
): AuthorizationAdministrationActor {
  return {
    actorType: 'user',
    actorUserId: context.operator.user.id,
    ipAddress: getClientIp(request),
    requestId: request.headers.get('x-request-id') ?? undefined,
  }
}
