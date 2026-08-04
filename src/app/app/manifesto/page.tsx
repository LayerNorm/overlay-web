import type { Metadata } from 'next'
import ManifestoMarketingPage from '@/features/marketing/pages/ManifestoMarketingPage'
import { PublicMarketingPageFrame } from '@/features/showcase/PublicMarketingPageFrame'

export const metadata: Metadata = {
  title: 'Manifesto — Overlay',
  description:
    'Why AI should amplify human potential through an open, private, and controllable interface.',
  alternates: {
    canonical: '/manifesto',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function PublicManifestoPage() {
  return (
    <PublicMarketingPageFrame title="Manifesto">
      <ManifestoMarketingPage />
    </PublicMarketingPageFrame>
  )
}
