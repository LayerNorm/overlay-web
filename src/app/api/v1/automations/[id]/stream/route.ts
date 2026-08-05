import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/automations/[runId]/stream/route'

export const maxDuration = 30

export async function GET(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.GET as BffDomainService)
}
