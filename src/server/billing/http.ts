import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexBillingRepository } from './ConvexBillingRepository'
import { lazyService } from '@/server/lazy-service'
import { ConvexUsageRepository } from '@/server/usage/ConvexUsageRepository'
import { publicEnv } from '@/shared/env/public-env'
import { DEFAULT_APP_URL, normalizeAppBaseUrl } from '@/shared/web/normalize-app-url'
import { BillingCustomerService, BillingServiceError } from './BillingCustomerService'
import { WorkspaceBillingService } from './WorkspaceBillingService'
import { LegalAcceptanceError } from '@/server/legal/legal-acceptance'
import { getOverlayCapabilities } from '@/server/capabilities'
import { WorkspaceExecutionError } from './WorkspaceExecutionPolicy'

const billingRepository = new ConvexBillingRepository()
const usageRepository = new ConvexUsageRepository()

export const billingCustomerService = new BillingCustomerService({
  repository: billingRepository,
})

export const workspaceBillingService = new WorkspaceBillingService({
  billingEnabled: async () => (await getOverlayCapabilities()).billing,
  repository: billingRepository,
  baseUrl: getBillingBaseUrl,
  billingProvider: () => getOverlayServerContext().billing,
  usage: usageRepository,
  workspaces: lazyService(() => getOverlayServerContext().workspaceService),
})

function getBillingBaseUrl(): string {
  const vercelUrl = process.env.VERCEL_URL?.trim()
  return normalizeAppBaseUrl(
    publicEnv.appUrl || (vercelUrl ? `https://${vercelUrl}` : ''),
    DEFAULT_APP_URL,
  )
}

export function billingErrorResponse(error: unknown, fallback: string) {
  if (error instanceof WorkspaceExecutionError) return NextResponse.json(error.payload, { status: error.statusCode })
  if (error instanceof LegalAcceptanceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof BillingServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/**
 * Plans, credit and top-ups belong to workspaces; an account is never free or paid. The old account-plan purchase
 * endpoints answer with this instead of starting a checkout.
 */
export function accountPlansRetiredResponse() {
  return NextResponse.json({
    code: 'account_plans_retired',
    error: 'Plans and credit belong to workspaces now. Add them in Workspace → Billing.',
  }, { status: 410 })
}
