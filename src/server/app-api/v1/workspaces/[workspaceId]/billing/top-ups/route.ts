import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { billingErrorResponse, workspaceBillingService } from '@/server/billing/http'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'
import {
  recordLegalAcceptance,
  requireCurrentLegalAcceptance,
} from '@/server/legal/legal-acceptance'

export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const legalAcceptance = requireCurrentLegalAcceptance(context.parsedJson)
    const legalMetadata = await recordLegalAcceptance({
      acceptance: legalAcceptance,
      context: 'workspace_topup_checkout',
      request,
      userId: context.auth.userId,
      workspaceId,
    })
    return NextResponse.json(await workspaceBillingService.createTopUp({
      actorUserId: context.auth.userId,
      workspaceId,
      legalMetadata,
      amountCents: Number(context.parsedJson.amountCents),
    }))
  } catch (error) {
    return billingErrorResponse(error, 'Failed to create workspace top-up.')
  }
}
