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
      '@id': 'https://overlay.works/#organization',
      name: 'LayerNorm Inc',
      alternateName: 'Overlay',
      url: 'https://overlay.works',
      logo: {
        '@type': 'ImageObject',
        url: 'https://overlay.works/assets/overlay-logo.png',
        width: 384,
        height: 384,
      },
      sameAs: ['https://github.com/LayerNorm/overlay-web'],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://overlay.works/#website',
      url: 'https://overlay.works',
      name: 'Overlay',
      description:
        'Overlay: The control plane for AI employees. Create, deploy, and manage every agent in one workspace.',
      publisher: { '@id': 'https://overlay.works/#organization' },
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://overlay.works/#application',
      name: 'Overlay',
      url: 'https://overlay.works',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        "Overlay is the control plane for AI employees: one workspace to create, deploy, and manage AI agents. Bring your own agents (Codex, Claude Code, Hermes) or run Overlay's, and put them to work in one shared workspace on the web and desktop. Open source under AGPL-3.0, with hosted and self-hosted options.",
      offers: {
        '@type': 'Offer',
        price: '8',
        priceCurrency: 'USD',
        description: '$8/month usage credit. No trial. Set up your workspace before payment; bring your own model credentials if preferred.',
      },
      creator: { '@id': 'https://overlay.works/#organization' },
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
