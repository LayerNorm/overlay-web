import { NextResponse } from 'next/server'

import { AdministrativeAuthorizationError } from '@/server/admin/AdministrativeService'
import { adminConvexQuery } from '@/server/convex-admin'
import { getAdminServerContext } from '@/server/context'
import { adminRoute } from '@/server/guard'
import type { AdminGrowthSummary } from '@/shared/admin-types'

export const GET = adminRoute(async (_request, context) => {
  const server = getAdminServerContext()
  if (!await server.administrativeService.canViewGrowth(context.operator.user.id)) {
    throw new AdministrativeAuthorizationError()
  }
  const growth = await adminConvexQuery<AdminGrowthSummary>('admin/console:getGrowthSummary')
  return NextResponse.json({ growth })
}, { auditAction: 'administration.growth.read', resourceType: 'growth_summary' })
