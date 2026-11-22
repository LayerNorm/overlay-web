import type { MetadataRoute } from 'next'
import docsConfig from '../../docs/docs.json'
import { COMPARE_PAGES } from '@/features/marketing/compare/comparePages'

const SITE_URL = 'https://overlay.works'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  const marketingRoutes: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/home`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/self-hosting`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/changelog`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/manifesto`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/download`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/compare`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/docs`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ]

  const legalRoutes = [
    'terms',
    'privacy',
    'acceptable-use',
    'cookies',
    'commercial-license',
    'dpa',
    'subprocessors',
    'refunds',
    'dmca',
  ].map((path) => ({
    url: `${SITE_URL}/${path}`,
    lastModified,
    changeFrequency: 'yearly' as const,
    priority: 0.3,
  }))

  // Comparison pages answer "X alternative" and "Overlay vs X" questions.
  const compareRoutes: MetadataRoute.Sitemap = COMPARE_PAGES.map((page) => ({
    url: `${SITE_URL}/compare/${page.slug}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  // Every Mintlify docs page (served under /docs by the rewrite in next.config.ts),
  // so search and answer engines discover the docs, not just the docs home.
  const docsRoutes: MetadataRoute.Sitemap = collectDocsPages(docsConfig.navigation).map((page) => ({
    url: `${SITE_URL}/docs/${page}`,
    lastModified,
    changeFrequency: 'weekly',
    priority: 0.5,
  }))

  return [...marketingRoutes, ...compareRoutes, ...docsRoutes, ...legalRoutes]
}

/** Every page slug in docs.json navigation (tabs, groups, nested groups). */
function collectDocsPages(node: unknown): string[] {
  const pages = new Set<string>()
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      pages.add(value)
    } else if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key of ['tabs', 'groups', 'pages']) {
        if (key in record) visit(record[key])
      }
    }
  }
  visit(node)
  return [...pages]
}
