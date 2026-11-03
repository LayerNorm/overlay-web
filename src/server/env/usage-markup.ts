import 'server-only'

import { parseUsageMarkupBasisPoints } from '@/shared/billing/billing-pricing'

export function configuredUsageMarkupBasisPoints(): number {
  return parseUsageMarkupBasisPoints(process.env.OVERLAY_USAGE_MARKUP_BPS)
}
