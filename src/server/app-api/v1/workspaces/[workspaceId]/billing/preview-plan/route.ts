import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { billingErrorResponse, workspaceBillingService } from '@/server/billing/http'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'
import { previewOrigin } from '@/shared/web/preview-origin'

/**
 * PR previews only: makes the workspace paid for testing without a card (internal/develop/workspace-billing.md).
 * Answers 404 everywhere else; the Convex mutation refuses on any non-preview deployment as well.
 */
export async function POST(_request: Request, context: AppApiRouteContext) {
  if (!previewOrigin(process.env)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await workspaceBillingService.grantPreviewTestPlan({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
    }))
  } catch (error) {
    return billingErrorResponse(error, 'Failed to make the workspace paid for testing.')
  }
}
