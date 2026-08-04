import type { Metadata } from 'next'
import PricingClient from '@/app/pricing/PricingClient'
import { PublicMarketingPageFrame } from '@/features/showcase/PublicMarketingPageFrame'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'

export const metadata: Metadata = {
  title: 'Pricing — Overlay',
  description:
    'Choose an Overlay plan for private AI chat, files, agents, browser tasks, and automations.',
  alternates: {
    canonical: '/pricing',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function PublicPricingPage() {
  const capabilities = getOverlayCapabilitiesSync()
  return (
    <PublicMarketingPageFrame title="Pricing">
      <PricingClient billingEnabled={capabilities.billing} />
    </PublicMarketingPageFrame>
  )
}
