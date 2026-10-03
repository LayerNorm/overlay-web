import type { Metadata } from 'next'
import { AuthBoundary } from '@/contexts/AuthContext'
import { LandingThemeProvider } from '@/contexts/LandingThemeContext'

export const metadata: Metadata = {
  robots: {
    index: true,
    follow: true,
  },
}

// Structured data for search and answer engines: tells Google, Perplexity,
// ChatGPT, and friends what Overlay is, who makes it, and what it does.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://getoverlay.io/#organization',
      name: 'LayerNorm Inc',
      alternateName: 'Overlay',
      url: 'https://getoverlay.io',
      logo: {
        '@type': 'ImageObject',
        url: 'https://getoverlay.io/assets/overlay-logo.png',
        width: 384,
        height: 384,
      },
      sameAs: ['https://github.com/LayerNorm/overlay-web'],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://getoverlay.io/#website',
      url: 'https://getoverlay.io',
      name: 'Overlay',
      description:
        'Overlay: the control plane for AI agents — create, deploy, and manage every agent in one workspace.',
      publisher: { '@id': 'https://getoverlay.io/#organization' },
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://getoverlay.io/#application',
      name: 'Overlay',
      url: 'https://getoverlay.io',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, macOS',
      description:
        "Overlay is the control plane for AI agents: one workspace to create, deploy, and manage AI agents. Bring your own agents — Codex, Claude Code, Hermes — or run Overlay's, and put them to work in chat, Slack, Telegram, iMessage, and the web. Open source under AGPL-3.0, with hosted and self-hosted options.",
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free tier included — no card required. Paid plans available.',
      },
      creator: { '@id': 'https://getoverlay.io/#organization' },
    },
  ],
}

/**
 * Standalone marketing frame. These pages render outside the application
 * shell: no sidebar, no session resolution, no showcase demo state. Page
 * components bring their own content and footer; the shared shell below
 * provides the navbar, auth context, and landing theme.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthBoundary>
      <LandingThemeProvider>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </LandingThemeProvider>
    </AuthBoundary>
  )
}
