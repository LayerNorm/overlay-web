import { NextResponse } from 'next/server'

import { getAdminServerContext } from '@/server/context'
import { adminRoute } from '@/server/guard'

import { authorizationActor } from '../_utils'

export const GET = adminRoute(async (request, context) => {
  const capabilities = await getAdminServerContext()
    .authorizationAdministrationService
    .listCapabilities(authorizationActor(request, context))
  return NextResponse.json({ capabilities })
}, { auditAction: 'authorization.capability.list', resourceType: 'authorization_capability' })
