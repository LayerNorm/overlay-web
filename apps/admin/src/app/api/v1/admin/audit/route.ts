import { NextResponse } from 'next/server'

import { getAdminServerContext } from '@/server/context'
import { adminRoute, optionalNumber, optionalString, queryParams } from '@/server/guard'

export const GET = adminRoute(async (request, context) => {
  const server = getAdminServerContext()
  await server.administrativeService.assertCanViewAudit(context.operator.user.id)
  const query = queryParams(request)
  const events = await server.auditService.list({
    action: optionalString(query.action),
    actorUserId: optionalString(query.actorUserId),
    before: optionalNumber(query.before),
    limit: optionalNumber(query.limit),
    resourceType: optionalString(query.resourceType),
  })
  return NextResponse.json({ events })
}, { auditAction: 'administration.audit.list', resourceType: 'audit_event' })
