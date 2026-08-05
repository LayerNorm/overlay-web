import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService, type BffRouteContext } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/automations/[runId]/events/route'

// SSE streaming can run for the full duration of a workflow run.
// Vercel hobby plans cap at 60s; pro plans allow up to 300s.
export const maxDuration = 60

export async function GET(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.GET as BffDomainService)
}
