import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { billingErrorResponse, workspaceBillingService } from '@/server/billing/http'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    return NextResponse.json(await workspaceBillingService.createPortal({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
    }))
  } catch (error) {
    return billingErrorResponse(error, 'Failed to create workspace billing portal.')
  }
}
