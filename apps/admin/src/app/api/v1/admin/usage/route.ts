import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AdministrativeAuthorizationError } from '@/server/admin/AdministrativeService'
import type { AdminRouteContext as AppApiRouteContext } from '../_utils'
import { adminServices as getOverlayServerContext } from '@/server/bootstrap'
import { getClientIp } from '@/server/request'
import { adminServerSecret, convexAdmin } from '@/server/convex-admin'
import { handleAdminRoute as handleBffRoute, type AdminDomainService as BffDomainService } from '../_utils'

// The people in this deployment (id and email), for the admin console's directory. Personal budgets are gone: plans
// and credit belong to workspaces.
const listUsage: BffDomainService = async (request, context) => {
  const server = getOverlayServerContext()
  try {
    if (!await server.administrativeService.canManageBilling(context.auth.userId)) {
      throw new AdministrativeAuthorizationError()
    }
    const convex = convexAdmin
    const usage = await convex.query<Array<{ userId: string; email?: string }>>('auth/users:listUserDirectoryByServer', {
      serverSecret: adminServerSecret(),
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
