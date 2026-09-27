import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../_utils/bff'
import * as domainService from '@/server/app-api/v1/webhooks/route'

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.GET as BffDomainService)
}

// This is the outbound-webhook subscription management API, not an inbound
// webhook receiver — no signed payloads arrive here.
// react-doctor-disable-next-line react-doctor/webhook-signature-risk
export async function POST(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.POST as BffDomainService)
}

export async function PATCH(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.PATCH as BffDomainService)
}

export async function DELETE(request: NextRequest) {
  return handleBffRoute(request, {}, domainService.DELETE as BffDomainService)
}
