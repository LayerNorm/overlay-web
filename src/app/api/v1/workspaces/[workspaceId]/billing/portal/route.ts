import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/workspaces/[workspaceId]/billing/portal/route'

export async function POST(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.POST as BffDomainService)
}
