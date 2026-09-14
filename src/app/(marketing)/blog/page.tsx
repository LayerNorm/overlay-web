import type { Metadata } from 'next'
import { MarketingPlaceholderPage } from '@/features/marketing/pages/MarketingPlaceholderPage'

export const metadata: Metadata = {
  title: 'Blog — Overlay',
  description: 'Notes on building the workspace for AI agents.',
}

export default function BlogPage() {
  return (
    <MarketingPlaceholderPage
      title="Blog"
      description="Notes on building the workspace for AI agents — product updates, engineering, and what we learn running an agent workforce."
    />
  )
}
