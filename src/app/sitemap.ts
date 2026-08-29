import type { MetadataRoute } from 'next'

const SITE_URL = 'https://getoverlay.io'

export default function sitemap(): MetadataRoute.Sitemap {
  const marketingRoutes: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/home`,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/pricing`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/manifesto`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/docs`,
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
    changeFrequency: 'yearly' as const,
    priority: 0.3,
  }))

  return [...marketingRoutes, ...legalRoutes]
}
