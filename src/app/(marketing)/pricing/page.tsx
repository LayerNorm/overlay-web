import type { Metadata } from 'next'
import { PricingPage as WorkspacePricingPage } from '@/features/marketing/pricing/PricingPage'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'

export const metadata: Metadata = {
  title: 'Pricing — Overlay',
  description:
    'Every workspace is free or paid. Paid starts at $8 a month, becomes credit, and is billed as you go, one line per resource.',
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
