import { NextResponse } from 'next/server'

import { AdministrativeAuthorizationError } from '@/server/admin/AdministrativeService'
import { adminConvexQuery } from '@/server/convex-admin'
import { getAdminServerContext } from '@/server/context'
import { adminRoute, optionalNumber, optionalString, queryParams } from '@/server/guard'

export const GET = adminRoute(async (request, context) => {
  const server = getAdminServerContext()
  const query = queryParams(request)
  if (!await server.administrativeService.canManageBilling(context.operator.user.id)) {
    throw new AdministrativeAuthorizationError()
  }
  const usage = await adminConvexQuery<Array<{ email?: string; userId: string }>>(
    'auth/users:listUserDirectoryByServer',
    {
      limit: optionalNumber(query.limit),
      userId: optionalString(query.userId),
    },
  )
  return NextResponse.json({ usage: usage ?? [] })
}, { auditAction: 'administration.usage.list', resourceType: 'usage_budget' })
