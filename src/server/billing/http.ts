import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { publicEnv } from '@/shared/env/public-env'
import { DEFAULT_APP_URL, normalizeAppBaseUrl } from '@/shared/web/normalize-app-url'
import { BillingCheckoutService } from './BillingCheckoutService'
import { BillingCustomerService, BillingServiceError } from './BillingCustomerService'
import type { BillingRepository } from './BillingRepository'

const billingRepository = repositoryProxy<BillingRepository>(
  () => getOverlayServerContext().appData.repositories.billing,
)

export const billingCustomerService = new BillingCustomerService({
  repository: billingRepository,
})

export const billingCheckoutService = new BillingCheckoutService({
  repository: billingRepository,
  baseUrl: getBillingBaseUrl,
  billingProvider: () => getOverlayServerContext().billing,
})

function getBillingBaseUrl(): string {
  const vercelUrl = process.env.VERCEL_URL?.trim()
  return normalizeAppBaseUrl(
    publicEnv.appUrl || (vercelUrl ? `https://${vercelUrl}` : ''),
    DEFAULT_APP_URL,
  )
}

export function billingErrorResponse(error: unknown, fallback: string) {
  if (error instanceof BillingServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}
