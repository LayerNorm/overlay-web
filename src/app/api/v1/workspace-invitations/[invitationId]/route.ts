import type { NextRequest } from 'next/server'
import type { BffRouteContext } from '../../_utils/bff'
import { rateLimitByIp } from '@/server/security/rate-limit'
import * as domainService from '@/server/app-api/v1/workspace-invitations/[invitationId]/route'

export async function GET(request: NextRequest, context: BffRouteContext) {
  const limited = await rateLimitByIp(request, 'workspace-invitation-preview:ip', 60, 60_000)
  const response = limited ?? await domainService.GET(request, context)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
