import type { Metadata } from 'next'
import PricingClient from '@/app/pricing/PricingClient'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Choose an Overlay plan — the control plane for AI agents with private chat, files, browser tasks, and automations. Free tier included.',
  alternates: {
    canonical: '/pricing',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function PricingPage() {
  const capabilities = getOverlayCapabilitiesSync()
  return <PricingClient billingEnabled={capabilities.billing} />
}
