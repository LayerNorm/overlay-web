import type { Metadata } from 'next'
import { PricingPage as WorkspacePricingPage } from '@/features/marketing/pricing/PricingPage'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Set up your workspace before choosing the $8/month usage credit. Payment is required before execution; there is no trial. Bring your own model credentials if preferred.',
  alternates: {
    canonical: '/pricing',
  },
  robots: {
    index: true,
    follow: true,
  },
}

/** Plans belong to workspaces; deployments without Overlay billing see the billing-unavailable notice. */
export default function PricingPage() {
  return <WorkspacePricingPage billingEnabled={getOverlayCapabilitiesSync().billing} />
}
