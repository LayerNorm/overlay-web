import type { Metadata } from 'next'
import { StaticLanding } from '@/features/marketing/landing/StaticLanding'

export const metadata: Metadata = {
  title: { absolute: 'Overlay: The control plane for AI employees' },
  description:
    'Create, deploy and manage AI employees with memory, tools and their own computer. Open source, multiplayer, and accessible from anywhere. Bring your own agents (Codex, Claude Code, Cursor).',
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
