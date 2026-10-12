import type { Metadata } from 'next'
import { ScrollLanding } from '@/features/marketing/landing/ScrollLanding'

export const metadata: Metadata = {
  title: 'Overlay — The open source multiplayer cloud control plane for AI employees',
  description:
    'Create, deploy and manage AI employees with memory, tools and their own computer. Open source, multiplayer, and accessible from anywhere. Bring your own agents — Codex, Claude Code, Cursor.',
  alternates: {
    canonical: '/home',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function HomePage() {
  return <ScrollLanding />
}
