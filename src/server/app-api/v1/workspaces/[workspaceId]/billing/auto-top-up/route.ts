import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { billingErrorResponse, workspaceBillingService } from '@/server/billing/http'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'

/** Owners and admins choose a hard stop or automatic top-ups (amount and monthly limit) for when credit runs out. */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const workspaceId = requiredWorkspaceParam(await context.params, 'workspaceId')
    const body = context.parsedJson
    return NextResponse.json(await workspaceBillingService.updateAutoTopUp({
      actorUserId: context.auth.userId,
      workspaceId,
      enabled: body.enabled === true,
      amountCents: Number(body.amountCents),
      monthlyLimitCents: Number(body.monthlyLimitCents),
    }))
  } catch (error) {
    return billingErrorResponse(error, 'Failed to update automatic top-ups.')
  }
}
