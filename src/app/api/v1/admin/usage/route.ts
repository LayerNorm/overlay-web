import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AdministrativeAuthorizationError } from '@/server/admin'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getClientIp } from '@/server/security/rate-limit'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'

// The people in this deployment (id and email), for the admin console's directory. Personal budgets are gone: plans
// and credit belong to workspaces.
const listUsage: BffDomainService = async (request, context) => {
  const server = getOverlayServerContext()
  try {
    if (!await server.administrativeService.canManageBilling(context.auth.userId)) {
      throw new AdministrativeAuthorizationError()
    }
    const { convex } = await import('@/server/database/convex')
    const usage = await convex.query<Array<{ userId: string; email?: string }>>('auth/users:listUserDirectoryByServer', {
      serverSecret: getInternalApiSecret(),
      limit: optionalNumber(context.parsedQuery.limit),
      userId: optionalString(context.parsedQuery.userId),
    }, { throwOnError: true })
    return NextResponse.json({ usage: usage ?? [] })
  } catch (error) {
    return await authorizationResponse(error, request, context, 'administration.usage.list')
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listUsage)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function authorizationResponse(
  error: unknown,
  request: NextRequest,
  context: AppApiRouteContext,
  action: string,
): Promise<Response> {
  const server = getOverlayServerContext()
  if (error instanceof AdministrativeAuthorizationError) {
    await server.auditService.record({
      action,
      actorApiKeyId: context.auth.apiKeyId,
      actorType: context.auth.authType === 'api-key' ? 'api_key' : 'user',
      actorUserId: context.auth.userId,
      ipAddress: getClientIp(request),
      outcome: 'denied',
      requestId: request.headers.get('x-request-id') ?? undefined,
      resourceType: 'usage_budget',
    })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  throw error
}
