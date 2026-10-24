import type { NextRequest } from 'next/server'
import { handleAccountBffRoute, type AccountBffDomainService } from '../../_utils/bff'
import * as domainService from '@/server/app-api/v1/workspace-handles/[handle]/route'

export async function GET(request: NextRequest, context: { params: Promise<{ handle: string }> }) {
  return handleAccountBffRoute(request, context, domainService.GET as AccountBffDomainService, {
    requireSession: true,
  })
}
