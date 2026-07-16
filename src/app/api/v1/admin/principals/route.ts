import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  AdministrativeAuthorizationError,
  isAdministrativeRole,
} from '@/server/admin'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getClientIp } from '@/server/security/rate-limit'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'

const listPrincipals: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({
      principals: await adminService().list(context.auth.userId),
    })
  } catch (error) {
    return await authorizationResponse(error, request, context, 'administration.principal.list')
  }
}

const grantPrincipal: BffDomainService = async (request, context) => {
  const role = context.parsedJson.role
  if (!isAdministrativeRole(role)) {
    return NextResponse.json({ error: 'Invalid administrative role' }, { status: 400 })
  }
  try {
    const principal = await adminService().grant({
      actorUserId: context.auth.userId,
      ipAddress: getClientIp(request),
      reason: optionalString(context.parsedJson.reason),
      requestId: request.headers.get('x-request-id') ?? undefined,
      role,
      userId: requiredString(context, 'userId'),
    })
    return NextResponse.json({ principal }, { status: 201 })
  } catch (error) {
    return await authorizationResponse(error, request, context, 'administration.principal.grant')
  }
}

const revokePrincipal: BffDomainService = async (request, context) => {
  try {
    const revoked = await adminService().revoke({
      actorUserId: context.auth.userId,
      ipAddress: getClientIp(request),
      requestId: request.headers.get('x-request-id') ?? undefined,
      userId: requiredString(context, 'userId'),
    })
    return revoked
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Administrative principal not found' }, { status: 404 })
  } catch (error) {
    return await authorizationResponse(error, request, context, 'administration.principal.revoke')
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listPrincipals)
}

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, grantPrincipal)
}

export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, revokePrincipal)
}

function adminService() {
  return getOverlayServerContext().administrativeService
}

function requiredString(context: AppApiRouteContext, field: string): string {
  const value = context.parsedJson[field]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function authorizationResponse(
  error: unknown,
  request: NextRequest,
  context: AppApiRouteContext,
  action: string,
): Promise<Response> {
  if (error instanceof AdministrativeAuthorizationError) {
    const server = getOverlayServerContext()
    await server.auditService.record({
        action,
        actorApiKeyId: context.auth.apiKeyId,
        actorType: context.auth.authType === 'api-key' ? 'api_key' : 'user',
        actorUserId: context.auth.userId,
        ipAddress: getClientIp(request),
        outcome: 'denied',
        requestId: request.headers.get('x-request-id') ?? undefined,
        resourceType: 'administrative_principal',
      })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (error instanceof Error && /required|cannot revoke/.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  throw error
}
