import { NextRequest, NextResponse } from 'next/server'
import * as domainService from '@/server/app-api/v1/account/profile/route'
import { handleAccountBffRoute } from '@/app/api/v1/_utils/bff'
import { limitIdentityUploadBody } from '@/server/identity/profile-media'

export async function GET(request: NextRequest, context: unknown) {
  return handleAccountBffRoute(request, context, domainService.GET_PHOTO, { requireSession: true })
}

export async function POST(request: NextRequest, context: unknown) {
  const bounded = await limitIdentityUploadBody(request)
  if (bounded instanceof NextResponse) return bounded
  return handleAccountBffRoute(bounded, context, domainService.POST, { requireSession: true })
}
