import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../_utils/bff'
import { requireOverlayRouteCapability } from '@/server/capabilities'

export async function GET(request: NextRequest) {
  const capabilityResponse = await requireOverlayRouteCapability(request)
  if (capabilityResponse) return capabilityResponse
  const domainService = await import('@/server/app-api/v1/imports/slack/route')
  return handleBffRoute(request, {}, domainService.GET as BffDomainService)
}

export async function POST(request: NextRequest) {
  const capabilityResponse = await requireOverlayRouteCapability(request)
  if (capabilityResponse) return capabilityResponse
  const domainService = await import('@/server/app-api/v1/imports/slack/route')
  return handleBffRoute(request, {}, domainService.POST as BffDomainService)
}
