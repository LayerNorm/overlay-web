import type { NextRequest } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import * as domainService from '@/server/app-api/v1/workspaces/[workspaceId]/handle/route'

export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  return handleBffRoute(request, context, domainService.PATCH as BffDomainService)
}
