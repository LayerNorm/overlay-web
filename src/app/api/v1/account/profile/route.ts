import { NextRequest } from 'next/server'
import * as domainService from '@/server/app-api/v1/account/profile/route'
import { handleAccountBffRoute } from '@/app/api/v1/_utils/bff'

export async function PATCH(request: NextRequest, context: unknown) {
  return handleAccountBffRoute(request, context, domainService.PATCH, { requireSession: true })
}
