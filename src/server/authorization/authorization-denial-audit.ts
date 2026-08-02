import 'server-only'

import type { AuditService } from '@/server/admin/AuditService'
import { logger } from '@/server/observability/logger'

type DenialActor = {
  authType: string
  apiKeyId?: string
  userId: string
}

export async function recordAuthorizationDenial(args: {
  auditService: Pick<AuditService, 'record'>
  actor: DenialActor
  capability?: string
  clientIp: string
  method: string
  pathname: string
  reason: string
  requestId?: string
  resourceId?: string
  resourceType?: string
}): Promise<boolean> {
  if (args.method === 'GET' || args.method === 'HEAD') return false
  try {
    await args.auditService.record({
      action: 'authorization.request.denied',
      actorApiKeyId: args.actor.apiKeyId,
      actorType: args.actor.authType === 'api-key' ? 'api_key' : 'user',
      actorUserId: args.actor.userId,
      ipAddress: args.clientIp,
      metadata: {
        capability: args.capability,
        method: args.method,
        pathname: args.pathname,
        reason: args.reason,
      },
      outcome: 'denied',
      requestId: args.requestId,
      resourceId: args.resourceId,
      resourceType: args.resourceType ?? 'authorization_route',
    })
    return true
  } catch (error) {
    logger.error('[Authorization] Failed to record denial audit', {
      error: error instanceof Error ? error.message : String(error),
      method: args.method,
      pathname: args.pathname,
    })
    return false
  }
}
