import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AdministrativeAuthorizationError } from '@/server/admin'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getClientIp } from '@/server/security/rate-limit'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'

const listUsage: BffDomainService = async (request, context) => {
  const server = getOverlayServerContext()
  try {
    if (!await server.administrativeService.canViewUsage(context.auth.userId)) {
      throw new AdministrativeAuthorizationError()
    }
    return NextResponse.json({
      usage: await server.appData.repositories.billing.listAdministrativeUsage({
        limit: optionalNumber(context.parsedQuery.limit),
        userId: optionalString(context.parsedQuery.userId),
      }),
    })
  } catch (error) {
    return await authorizationResponse(error, request, context, 'administration.usage.list')
  }
}

const adjustBudget: BffDomainService = async (request, context) => {
  const server = getOverlayServerContext()
  try {
    if (!await server.administrativeService.canManageBilling(context.auth.userId)) {
      throw new AdministrativeAuthorizationError()
    }
    const amountCents = requiredNumber(context, 'amountCents')
    const userId = requiredString(context, 'userId')
    const usage = await server.appData.repositories.billing.adjustAdministrativeBudget({ amountCents, userId })
    await server.auditService.record({
      action: 'administration.budget.adjust',
      actorApiKeyId: context.auth.apiKeyId,
      actorType: context.auth.authType === 'api-key' ? 'api_key' : 'user',
      actorUserId: context.auth.userId,
      ipAddress: getClientIp(request),
      metadata: { amountCents },
      outcome: 'success',
      requestId: request.headers.get('x-request-id') ?? undefined,
      resourceId: userId,
      resourceType: 'usage_budget',
    })
    return NextResponse.json({ usage })
  } catch (error) {
    return await authorizationResponse(error, request, context, 'administration.budget.adjust')
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listUsage)
}

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, adjustBudget)
}

function requiredString(context: AppApiRouteContext, field: string): string {
  const value = context.parsedJson[field]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function requiredNumber(context: AppApiRouteContext, field: string): number {
  const value = Number(context.parsedJson[field])
  if (!Number.isFinite(value) || value === 0) throw new Error(`${field} must be a non-zero number`)
  return value
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
  if (error instanceof Error && /required|non-zero|not found/.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  throw error
}
