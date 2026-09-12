import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/computers/[computerId]/desktop/route'

export async function POST(request: NextRequest, context: BffRouteContext) {
  // The desktop ticket URL is a bearer secret — never persisted by the
  // idempotency store.
  return handleBffRoute(request, context, domainService.POST as BffDomainService, {
    sensitiveResponse: true,
  })
}
