import type { NextRequest } from 'next/server'
import {
  handleBffRoute,
  type BffDomainService,
  type BffRouteContext,
} from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/workspaces/[workspaceId]/lifecycle/route'

export async function DELETE(request: NextRequest, context: BffRouteContext) {
  return handleBffRoute(request, context, domainService.DELETE as BffDomainService)
}
