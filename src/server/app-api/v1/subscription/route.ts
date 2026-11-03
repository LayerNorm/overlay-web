import { logger } from '@/server/observability/logger'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { billingCustomerService, billingErrorResponse } from '@/server/billing/http'
import { getOverlayServerContext } from '@/server/bootstrap'
import { BillingPayerResolutionError } from '@/server/billing/BillingPayerResolver'

type SubscriptionRouteDependencies = {
  getAppSubscription: typeof billingCustomerService.getAppSubscription
  resolvePayer: ReturnType<typeof getOverlayServerContext>['billingPayerResolver']['resolve']
}

export async function GET(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies?: SubscriptionRouteDependencies,
) {
  const { auth } = context

  try {
    const server = dependencies ? null : getOverlayServerContext()
    const resolvePayer = dependencies?.resolvePayer
      ?? server!.billingPayerResolver.resolve.bind(server!.billingPayerResolver)
    const getAppSubscription = dependencies?.getAppSubscription
      ?? billingCustomerService.getAppSubscription.bind(billingCustomerService)
    const payer = await resolvePayer({
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
    }).catch((error: unknown) => {
      if (error instanceof BillingPayerResolutionError && error.code === 'workspace_wallet_not_configured') return null
      throw error
    })
    const response = await getAppSubscription({
      userId: auth.userId,
      ...(!payer ? { unfundedWorkspace: true } : payer.scope === 'workspace'
        ? { billingAccountId: payer.billingAccountId }
        : {}),
    })
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof Error && error.name === 'BillingServiceError') {
      return billingErrorResponse(error, 'Failed to fetch subscription')
    }
    logger.error('[app/subscription]', error)
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 })
  }
}
