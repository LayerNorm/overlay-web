import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/providers/connections/test/route'
import { requestExceedsByteLimit } from '../../request-size'

const MAX_PROVIDER_REQUEST_BYTES = 100_000

export async function POST(request: NextRequest) {
  if (await requestExceedsByteLimit(request, MAX_PROVIDER_REQUEST_BYTES)) {
    return Response.json({ error: 'Request body too large' }, { status: 413 })
  }
  return handleBffRoute(request, {}, domainService.POST as BffDomainService)
}
