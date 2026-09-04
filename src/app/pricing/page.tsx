import type { Metadata } from 'next'
import PricingClient from './PricingClient'
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

export default function PricingPage() {
  const capabilities = getOverlayCapabilitiesSync()
  return <PricingClient billingEnabled={capabilities.billing} />
}
