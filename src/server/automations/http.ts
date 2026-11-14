import 'server-only'

import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConvexAutomationRepository } from './ConvexAutomationRepository'
import { AutomationService, AutomationServiceError } from './AutomationService'
import { ConfiguredAutomationEntitlementPolicy } from './AutomationEntitlementPolicy'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { start } from 'workflow/api'
import { BillingPayerResolutionError } from '@/server/billing/BillingPayerResolver'
import { automationRunWorkflow } from '@/server/workflows/automation-run'

const entitlementPolicy = new ConfiguredAutomationEntitlementPolicy({
  billingDisabled: () => {
    const config = getOverlayRuntimeConfigSync()
    return config.billing.provider === 'none'
  },
  // The plan of the workspace the automation is enabled in (falls back to the
  // person's own when it has none). A workspace that cannot pay is not paid:
  // the caller answers "requires a paid plan", never a server error.
  getPlanKind: async (userId, workspaceId) => {
    try {
      const entitlements = await getOverlayServerContext().chatUsagePolicy.getEntitlements({ userId, workspaceId })
      return entitlements?.planKind === 'paid' ? 'paid' : 'free'
    } catch (error) {
      if (error instanceof BillingPayerResolutionError) return 'free'
      throw error
    }
  },
})

export const automationService = new AutomationService({
  automationWorkflowStarter: (input) => start(automationRunWorkflow, [input]),
  entitlementPolicy,
  repository: new ConvexAutomationRepository(),
})

export function automationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AutomationServiceError) {
    return NextResponse.json(error.payload, { status: error.statusCode })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}
