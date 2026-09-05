import 'server-only'

import type { Entitlements } from '@overlay/billing'
import { getPersonalPlanPresentation } from '@/shared/billing/billing-pricing'

export function buildNativeSubscriptionResponse(entitlements: Entitlements) {
  return {
    ...entitlements,
    ...getPersonalPlanPresentation(entitlements),
    creditsUsed: entitlements.budgetUsedCents ?? entitlements.creditsUsed,
    creditsTotal:
      entitlements.budgetTotalCents !== undefined
        ? entitlements.budgetTotalCents / 100
        : entitlements.creditsTotal,
  }
}
