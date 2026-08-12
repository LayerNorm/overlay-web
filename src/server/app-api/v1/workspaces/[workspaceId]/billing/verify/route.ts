import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { billingErrorResponse, workspaceBillingService } from '@/server/billing/http'
import { requiredWorkspaceParam } from '@/server/app-api/v1/workspaces/inputs'
import { BillingServiceError } from '@/server/billing/BillingCustomerService'

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const kind = context.parsedJson.kind
    const sessionId = typeof context.parsedJson.sessionId === 'string'
      ? context.parsedJson.sessionId.trim()
      : ''
    if ((kind !== 'paid_plan' && kind !== 'budget_topup') || !sessionId) {
      throw new BillingServiceError({ error: 'A valid kind and sessionId are required.' }, 400)
    }
    return NextResponse.json(await workspaceBillingService.verify({
      actorUserId: context.auth.userId,
      workspaceId: requiredWorkspaceParam(await context.params, 'workspaceId'),
      kind,
      sessionId,
    }))
  } catch (error) {
    return billingErrorResponse(error, 'Failed to verify workspace checkout.')
  }
}
