import { NextRequest, NextResponse } from 'next/server'
import * as domainService from '@/server/app-api/v1/workspaces/[workspaceId]/icon/route'
import { handleBffRoute } from '@/app/api/v1/_utils/bff'
import { limitIdentityUploadBody } from '@/server/identity/profile-media'

export async function GET(request: NextRequest, context: unknown) {
  return handleBffRoute(request, context, domainService.GET)
}

export async function PATCH(request: NextRequest, context: unknown) {
  return handleBffRoute(request, context, domainService.PATCH)
}

export async function POST(request: NextRequest, context: unknown) {
  const bounded = await limitIdentityUploadBody(request)
  if (bounded instanceof NextResponse) return bounded
  return handleBffRoute(bounded, context, domainService.POST)
}
