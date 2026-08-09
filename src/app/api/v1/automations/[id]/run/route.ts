import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/automations/[id]/run/route'

export const maxDuration = 60

export async function POST(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.POST as BffDomainService)
}
