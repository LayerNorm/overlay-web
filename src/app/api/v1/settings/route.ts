import type { NextRequest } from 'next/server'
import { handleAccountBffRoute, type AccountBffDomainService } from '../_utils/bff'
import * as domainService from '@/server/app-api/v1/settings/route'

export async function GET(request: NextRequest) {
  return handleAccountBffRoute(request, {}, domainService.GET as AccountBffDomainService)
}

export async function PATCH(request: NextRequest) {
  return handleAccountBffRoute(request, {}, domainService.PATCH as AccountBffDomainService)
}
