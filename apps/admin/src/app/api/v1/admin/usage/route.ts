import { NextResponse } from 'next/server'

import { AdministrativeAuthorizationError } from '@/server/admin/AdministrativeService'
import { adminConvexQuery } from '@/server/convex-admin'
import { getAdminServerContext } from '@/server/context'
import { adminRoute, optionalNumber, optionalString, queryParams } from '@/server/guard'
import type { AdminUsageRow } from '@/shared/admin-types'

export const GET = adminRoute(async (request, context) => {
  const server = getAdminServerContext()
  const query = queryParams(request)
  if (!await server.administrativeService.canManageBilling(context.operator.user.id)
    && !await server.administrativeService.canAccessSupportControls(context.operator.user.id)) {
    throw new AdministrativeAuthorizationError()
  }
  const usage = await adminConvexQuery<AdminUsageRow[]>(
    'admin/console:listUserDirectory',
    {
      limit: optionalNumber(query.limit),
      query: optionalString(query.q),
      userId: optionalString(query.userId),
    },
  )
  return NextResponse.json({ usage: usage ?? [] })
}, { auditAction: 'administration.usage.list', resourceType: 'usage_budget' })
