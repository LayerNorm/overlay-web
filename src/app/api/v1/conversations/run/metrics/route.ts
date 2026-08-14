import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/conversations/run/metrics/route'

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.GET as BffDomainService)
}
