import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { repositoryProxy } from '@/server/app-data/errors'
import { AutomationService, AutomationServiceError } from './AutomationService'
import { ConfiguredAutomationEntitlementPolicy } from './AutomationEntitlementPolicy'
import type { AutomationRepository } from './AutomationRepository'
import { getOverlayRuntimeConfigSync } from '@/server/config'

const entitlementPolicy = new ConfiguredAutomationEntitlementPolicy({
  billingDisabled: () => {
    const config = getOverlayRuntimeConfigSync()
    return config.billing.provider === 'none'
  },
  getPlanKind: async (userId) => {
    const entitlements = await getOverlayServerContext().appData.repositories.billing
      .getEntitlementsByServer({ userId })
    return entitlements?.planKind === 'paid' ? 'paid' : 'free'
  },
})

export const automationService = new AutomationService({
  entitlementPolicy,
  lifecycleEvents: () => getOverlayServerContext().lifecycleEvents,
  repository: repositoryProxy<AutomationRepository>(
    () => getOverlayServerContext().appData.repositories.automations,
  ),
})

export function automationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AutomationServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}
