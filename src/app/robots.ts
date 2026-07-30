import type { MetadataRoute } from 'next'

const SITE_URL = 'https://getoverlay.io'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [
        '/',
        '/home',
        '/pricing',
        '/manifesto',
        '/docs/',
      ],
      disallow: [
        '/account',
        '/api/',
        '/app/',
        '/auth/',
        '/explore/',
        '/share/',
        '/%5F_fixtures/',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
