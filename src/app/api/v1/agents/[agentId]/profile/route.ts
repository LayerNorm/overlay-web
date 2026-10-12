import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/agents/[agentId]/profile/route'

// Applying a profile wakes the agent's machine and writes its files.
export const maxDuration = 300

export async function GET(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.GET as BffDomainService, { sensitiveResponse: true })
}

export async function POST(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.POST as BffDomainService, { sensitiveResponse: true })
}
