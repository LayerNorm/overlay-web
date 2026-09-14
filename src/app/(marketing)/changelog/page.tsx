import type { Metadata } from 'next'
import { MarketingPlaceholderPage } from '@/features/marketing/pages/MarketingPlaceholderPage'

export const metadata: Metadata = {
  title: 'Changelog — Overlay',
  description: 'What shipped, what changed, and what is next in Overlay.',
}

export default function ChangelogPage() {
  return (
    <MarketingPlaceholderPage
      title="Changelog"
      description="What shipped, what changed, and what is next in Overlay."
    />
  )
}
