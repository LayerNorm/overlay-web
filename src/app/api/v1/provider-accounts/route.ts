import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../_utils/bff'
import * as domainService from '@/server/app-api/v1/provider-accounts/route'
import { requestExceedsByteLimit } from '../providers/request-size'

const MAX_REQUEST_BYTES = 16_384

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.GET as BffDomainService, { sensitiveResponse: true })
}

export async function POST(request: NextRequest) {
  if (await requestExceedsByteLimit(request, MAX_REQUEST_BYTES)) {
    return Response.json({ error: 'Request body too large' }, { status: 413 })
  }
  return handleBffRoute(request, {}, domainService.POST as BffDomainService, { sensitiveResponse: true })
}

export async function PATCH(request: NextRequest) {
  if (await requestExceedsByteLimit(request, MAX_REQUEST_BYTES)) {
    return Response.json({ error: 'Request body too large' }, { status: 413 })
  }
  return handleBffRoute(request, {}, domainService.PATCH as BffDomainService, { sensitiveResponse: true })
}

export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.DELETE as BffDomainService, { sensitiveResponse: true })
}
