import type { Metadata } from 'next'
import { PricingPage } from '@/features/marketing/pricing/PricingPage'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'

export const metadata: Metadata = {
  title: 'Pricing preview — Overlay',
  robots: { index: false, follow: false },
}

/** The workspace pricing page, before workspace billing is switched on for everyone. */
export default function PricingPreviewPage() {
  return <PricingPage billingEnabled={getOverlayCapabilitiesSync().billing} itemized />
}
