import type { MetadataRoute } from 'next'

const SITE_URL = 'https://getoverlay.io'

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
      url: `${SITE_URL}/download`,
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

  return [...marketingRoutes, ...legalRoutes]
}
