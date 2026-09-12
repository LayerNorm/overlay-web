import type { Metadata } from 'next'
import HomeMarketingPage from '@/features/marketing/pages/MarketingOverviewPage'

export const metadata: Metadata = {
  title: 'Overlay — Own the interface to intelligence',
  description:
    'One private, open workspace for AI models, knowledge, tools, agents, and automations.',
  alternates: {
    canonical: '/home',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function HomePage() {
  return <HomeMarketingPage />
}
