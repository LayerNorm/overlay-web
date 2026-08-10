import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { billingErrorResponse, workspaceBillingService } from '@/server/billing/http'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    return NextResponse.json(await workspaceBillingService.summary({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
    }))
  } catch (error) {
    return billingErrorResponse(error, 'Failed to load workspace billing.')
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    return NextResponse.json(await workspaceBillingService.initialize({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
    }), { status: 201 })
  } catch (error) {
    return billingErrorResponse(error, 'Failed to initialize workspace billing.')
  }
}
