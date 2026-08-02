import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/conversations/[conversationId]/presence/route'

export async function GET(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.GET as BffDomainService)
}
export async function PATCH(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.PATCH as BffDomainService)
}
