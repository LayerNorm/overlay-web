import type { NextRequest } from 'next/server'
import {
  handleAccountBffRoute,
  type AccountBffDomainService,
  type BffRouteContext,
} from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/workspace-invitations/[invitationId]/accept/route'

export async function POST(request: NextRequest, context: BffRouteContext) {
  return handleAccountBffRoute(request, context, domainService.POST as AccountBffDomainService, {
    requireSession: true,
  })
}
