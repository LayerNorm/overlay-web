import type { Metadata } from 'next'
import HomeMarketingPage from '@/features/marketing/pages/MarketingOverviewPage'
import '@/features/marketing/landing.css'

export const metadata: Metadata = {
  title: { absolute: 'Overlay: the control plane for AI agents' },
  description:
    'Overlay is the control plane for AI agents — create, deploy, and manage every agent in one workspace. Bring your own agents — Codex, Claude Code, Hermes — and put them to work on any platform.',
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
