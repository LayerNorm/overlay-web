import type { NextRequest } from 'next/server'
import type { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import type { getOverlayServerContext } from '@/server/bootstrap'
import { logSecurityEvent } from '@/server/observability/security-events'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function recordBffMutationAuditIfNeeded(args: {
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
