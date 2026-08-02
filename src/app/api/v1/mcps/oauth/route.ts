import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'
import * as domainService from '@/server/app-api/v1/mcps/oauth/route'

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.POST as BffDomainService)
}

export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.DELETE as BffDomainService)
}
