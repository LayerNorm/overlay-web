import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handleBffRoute, type BffDomainService } from '../../../_utils/bff'
import {
  authorizationActor,
  authorizationAdministrationService,
  authorizationAdminErrorResponse,
} from '../_utils'

const listCapabilities: BffDomainService = async (request, context) => {
  try {
    return NextResponse.json({
      capabilities: await authorizationAdministrationService().listCapabilities(
        authorizationActor(request, context),
      ),
    })
  } catch (error) {
    return await authorizationAdminErrorResponse(
      error,
      request,
      context,
      'authorization.capability.list',
      'authorization_capability',
    )
  }
}

export async function GET(request: NextRequest) {
  return handleBffRoute(request, {}, listCapabilities)
}
