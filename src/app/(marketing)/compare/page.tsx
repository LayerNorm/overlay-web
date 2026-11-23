import type { Metadata } from 'next'
import { CompareIndexView } from '@/features/marketing/compare/ComparePageView'
import { COMPARE_PAGES } from '@/features/marketing/compare/comparePages'

export const metadata: Metadata = {
  title: 'Overlay compared: Devin, OpenHands, Lindy and AI agent platforms',
  description:
    'How Overlay, the open-source control plane for AI employees, compares with Devin, OpenHands, Lindy and other AI agent platforms.',
  alternates: { canonical: '/compare' },
  robots: { index: true, follow: true },
}

export default function CompareIndexPage() {
  return (
    <CompareIndexView
      pages={COMPARE_PAGES.map(({ slug, title, description }) => ({ slug, title, description }))}
    />
  )
}
