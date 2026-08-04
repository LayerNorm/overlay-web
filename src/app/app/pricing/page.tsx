import type { Metadata } from 'next'
import PricingClient from '@/app/pricing/PricingClient'
import { PublicMarketingPageFrame } from '@/features/showcase/PublicMarketingPageFrame'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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
