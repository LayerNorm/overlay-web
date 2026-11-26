import type { Metadata } from 'next'
import { StaticLanding } from '@/features/marketing/landing/StaticLanding'

export const metadata: Metadata = {
  title: { absolute: 'Overlay: The AI Chief of Staff that works with your team' },
  description:
    'Create, manage and deploy swarms of AI coworkers to solve your hardest problems. Overlay runs your agents like a chief of staff, in the app, in Slack and anywhere you work.',
  alternates: {
    canonical: '/home',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function HomePage() {
  return <StaticLanding />
}
