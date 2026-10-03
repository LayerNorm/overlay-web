import type { Metadata } from 'next'
import { MarketingPlaceholderPage } from '@/features/marketing/pages/MarketingPlaceholderPage'

export const metadata: Metadata = {
  title: 'Self-hosting',
  description: 'Run Overlay — the control plane for AI agents — on infrastructure you control. Open source under AGPL-3.0, with commercial licensing available.',
}

export default function SelfHostingPage() {
  return (
    <MarketingPlaceholderPage
      title="Self-hosting"
      description="Overlay is open source under AGPL-3.0, with commercial licensing for organizations that need different terms. Deployment guides are being written."
    />
  )
}
