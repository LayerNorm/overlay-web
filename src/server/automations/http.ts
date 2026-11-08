import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexAutomationRepository } from './ConvexAutomationRepository'
import { AutomationService, AutomationServiceError } from './AutomationService'
import { ConfiguredAutomationEntitlementPolicy } from './AutomationEntitlementPolicy'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { start } from 'workflow/api'
import { automationScheduleWorkflow } from '@/server/workflows/automation-schedule'

const entitlementPolicy = new ConfiguredAutomationEntitlementPolicy({
  billingDisabled: () => {
    const config = getOverlayRuntimeConfigSync()
    return config.billing.provider === 'none'
  },
  // The plan of the workspace the person is working in (falls back to their own when it has none).
  getPlanKind: async (userId) => {
    const entitlements = await getOverlayServerContext().chatUsagePolicy.getEntitlements({ userId })
    return entitlements?.planKind === 'paid' ? 'paid' : 'free'
  },
})

export const automationService = new AutomationService({
  automationWorkflowStarter: (input) => start(automationScheduleWorkflow, [input]),
  entitlementPolicy,
  lifecycleEvents: () => getOverlayServerContext().lifecycleEvents,
  repository: new ConvexAutomationRepository(),
})

export function automationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AutomationServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}
