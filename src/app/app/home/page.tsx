import type { Metadata } from 'next'
import HomeMarketingPage from '@/features/marketing/pages/MarketingOverviewPage'
import { PublicMarketingPageFrame } from '@/features/showcase/PublicMarketingPageFrame'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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

export default function PublicHomePage() {
  return (
    <PublicMarketingPageFrame title="Home">
      <HomeMarketingPage />
    </PublicMarketingPageFrame>
  )
}
