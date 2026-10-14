import { NextResponse, type NextRequest } from 'next/server'

import { isAdministrativeRole } from '@/server/admin/AdministrativeRepository'
import { getAdminServerContext } from '@/server/context'
import {
  adminRoute,
  getClientIp,
  optionalString,
  parseJson,
  requiredString,
} from '@/server/guard'

export const GET = adminRoute(async (_request, context) => {
  const server = getAdminServerContext()
  const principals = await server.administrativeService.list(context.operator.user.id)
  return NextResponse.json({ principals })
}, { auditAction: 'administration.principal.list', resourceType: 'administrative_principal' })

export const POST = adminRoute(async (request: NextRequest, context) => {
  const body = await parseJson(request)
  const role = body.role
  if (!isAdministrativeRole(role)) {
    return NextResponse.json({ error: 'Invalid administrative role' }, { status: 400 })
  }
  const server = getAdminServerContext()
  const principal = await server.administrativeService.grant({
    actorUserId: context.operator.user.id,
    ipAddress: getClientIp(request),
    reason: optionalString(body.reason),
    requestId: request.headers.get('x-request-id') ?? undefined,
    role,
    userId: requiredString(body.userId),
  })
  return NextResponse.json({ principal }, { status: 201 })
}, { auditAction: 'administration.principal.grant', mutation: true, resourceType: 'administrative_principal' })

export const DELETE = adminRoute(async (request: NextRequest, context) => {
  const body = await parseJson(request)
  const server = getAdminServerContext()
  const revoked = await server.administrativeService.revoke({
    actorUserId: context.operator.user.id,
    ipAddress: getClientIp(request),
    requestId: request.headers.get('x-request-id') ?? undefined,
    userId: requiredString(body.userId),
  })
  return revoked
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: 'Administrative principal not found' }, { status: 404 })
}, { auditAction: 'administration.principal.revoke', mutation: true, resourceType: 'administrative_principal' })
