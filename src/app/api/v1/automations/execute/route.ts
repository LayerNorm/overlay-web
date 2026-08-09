import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'
import * as domainService from '@/server/app-api/v1/automations/execute/route'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.POST as BffDomainService)
}

export async function PATCH(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.PATCH as BffDomainService)
}
