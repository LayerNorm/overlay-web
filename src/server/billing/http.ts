import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { publicEnv } from '@/shared/env/public-env'
import { DEFAULT_APP_URL, normalizeAppBaseUrl } from '@/shared/web/normalize-app-url'
import { BillingCheckoutService } from './BillingCheckoutService'
import { BillingCustomerService, BillingServiceError } from './BillingCustomerService'
import { WorkspaceBillingService } from './WorkspaceBillingService'
import type { BillingRepository } from './BillingRepository'
import type { UsageRepository } from '@/server/usage/UsageRepository'
import {
  resolveWorkspaceBillingRollout,
  workspaceBillingRolloutConfigFromEnv,
} from '@/shared/billing/workspace-billing-rollout'
import { LegalAcceptanceError } from '@/server/legal/legal-acceptance'

const billingRepository = repositoryProxy<BillingRepository>(
  () => getOverlayServerContext().appData.repositories.billing,
)
const usageRepository = repositoryProxy<UsageRepository>(
  () => getOverlayServerContext().appData.repositories.usage,
)

export const billingCustomerService = new BillingCustomerService({
  repository: billingRepository,
})

export const billingCheckoutService = new BillingCheckoutService({
  repository: billingRepository,
  baseUrl: getBillingBaseUrl,
  billingProvider: () => getOverlayServerContext().billing,
  lifecycleEvents: () => getOverlayServerContext().lifecycleEvents,
})

export const workspaceBillingService = new WorkspaceBillingService({
  repository: billingRepository,
  baseUrl: getBillingBaseUrl,
  billingProvider: () => getOverlayServerContext().billing,
  rollout: (workspaceId) => resolveWorkspaceBillingRollout(
    workspaceBillingRolloutConfigFromEnv(process.env),
    workspaceId,
  ),
  usage: usageRepository,
  workspaces: repositoryProxy(() => getOverlayServerContext().workspaceService),
})

function getBillingBaseUrl(): string {
  const vercelUrl = process.env.VERCEL_URL?.trim()
  return normalizeAppBaseUrl(
    publicEnv.appUrl || (vercelUrl ? `https://${vercelUrl}` : ''),
    DEFAULT_APP_URL,
  )
}

export function billingErrorResponse(error: unknown, fallback: string) {
  if (error instanceof LegalAcceptanceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof BillingServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}
