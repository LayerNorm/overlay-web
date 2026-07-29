import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/conversations/[conversationId]/state/route'

export async function PATCH(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.PATCH as BffDomainService)
}
