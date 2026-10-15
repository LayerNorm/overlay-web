import type { MetadataRoute } from 'next'

const SITE_URL = 'https://getoverlay.io'

const PRIVATE_PATHS = [
  '/account',
  '/api/',
  '/app/',
  '/auth/',
  '/explore/',
  '/share/',
  '/dev-fixtures/',
]

// Search and answer-engine crawlers welcome everywhere except the private
// surfaces above — AI assistants citing Overlay is how the site gets found.
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Applebot',
  'Bingbot',
  'Amazonbot',
  'meta-externalagent',
  'cohere-ai',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: '/',
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
