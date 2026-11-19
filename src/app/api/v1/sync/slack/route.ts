import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'

export async function GET(request: NextRequest) {
  const domainService = await import('@/server/app-api/v1/sync/slack/route')
  return handleBffRoute(request, {}, domainService.GET as BffDomainService)
}

export async function POST(request: NextRequest) {
  const domainService = await import('@/server/app-api/v1/sync/slack/route')
  return handleBffRoute(request, {}, domainService.POST as BffDomainService)
}
