import type { MetadataRoute } from 'next'

const SITE_URL = 'https://getoverlay.io'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
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
}
