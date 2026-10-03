import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../_utils/bff'
import * as domainService from '@/server/app-api/v1/agent-asks/route'

// Asking can wait for the other agent's reply.
export const maxDuration = 120

export async function POST(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.POST as BffDomainService, { sensitiveResponse: true })
}
