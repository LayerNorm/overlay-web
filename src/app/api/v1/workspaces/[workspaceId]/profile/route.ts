import { NextRequest } from 'next/server'
import * as domainService from '@/server/app-api/v1/workspaces/[workspaceId]/profile/route'
import { handleBffRoute } from '@/app/api/v1/_utils/bff'

export async function GET(request: NextRequest, context: unknown) {
  return handleBffRoute(request, context, domainService.GET)
}

export async function PATCH(request: NextRequest, context: unknown) {
  return handleBffRoute(request, context, domainService.PATCH)
}
