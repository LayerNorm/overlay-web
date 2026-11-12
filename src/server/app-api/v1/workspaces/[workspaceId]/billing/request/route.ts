import { NextResponse } from 'next/server'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { billingErrorResponse, workspaceBillingService } from '@/server/billing/http'
import { BillingServiceError } from '@/server/billing/BillingCustomerService'
import { WorkspaceBillingRequestService } from '@/server/billing/WorkspaceBillingRequestService'
import { ConvexWorkspaceRepository } from '@/server/workspaces/ConvexWorkspaceRepository'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

export async function POST(_request: Request, context: AccountAppApiRouteContext) {
  try {
    if (context.auth.authType !== 'session') throw new BillingServiceError({ error: 'Sign in to request workspace billing.' }, 403)
    const server = getOverlayServerContext()
    const result = await new WorkspaceBillingRequestService({
      repository: new ConvexWorkspaceRepository(), workspaces: server.workspaceService,
      billing: workspaceBillingService, events: server.lifecycleEvents,
    }).request({ actorUserId: context.auth.userId, workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId') })
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    return billingErrorResponse(error, 'Could not request workspace billing.')
  }
}
