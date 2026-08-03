import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'
import * as domainService from '@/server/app-api/v1/providers/connections/route'
import { requestExceedsByteLimit } from '../request-size'

const MAX_PROVIDER_REQUEST_BYTES = 2_000_000

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.GET as BffDomainService)
}

export async function POST(request: NextRequest) {
  if (await requestExceedsByteLimit(request, MAX_PROVIDER_REQUEST_BYTES)) {
    return Response.json({ error: 'Request body too large' }, { status: 413 })
  }
  return handleBffRoute(request, {}, domainService.POST as BffDomainService)
}

export async function PATCH(request: NextRequest) {
  if (await requestExceedsByteLimit(request, MAX_PROVIDER_REQUEST_BYTES)) {
    return Response.json({ error: 'Request body too large' }, { status: 413 })
  }
  return handleBffRoute(request, {}, domainService.PATCH as BffDomainService)
}

export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.DELETE as BffDomainService)
}
