import type { NextRequest } from 'next/server'
import { handleAccountBffRoute, type AccountBffDomainService } from '../../_utils/bff'
import * as domainService from '@/server/app-api/v1/account/workspaces/route'

export async function GET(request: NextRequest) {
  return handleAccountBffRoute(request, {}, domainService.GET as AccountBffDomainService, {
    requireSession: true,
  })
}

export async function POST(request: NextRequest) {
  return handleAccountBffRoute(request, {}, domainService.POST as AccountBffDomainService, {
    requireSession: true,
  })
}
