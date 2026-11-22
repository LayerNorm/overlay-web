import type { MetadataRoute } from 'next'
import docsConfig from '../../docs/docs.json'
import { COMPARE_PAGES } from '@/features/marketing/compare/comparePages'

const SITE_URL = 'https://overlay.works'

const MARKETING_PATHS = [
  '/home',
  '/pricing',
  '/self-hosting',
  '/blog',
  '/changelog',
  '/manifesto',
  '/download',
  '/compare',
  '/terms',
  '/privacy',
  '/acceptable-use',
  '/cookies',
  '/commercial-license',
  '/dpa',
  '/subprocessors',
  '/refunds',
  '/dmca',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const comparePaths = COMPARE_PAGES.map(({ slug }) => `/compare/${slug}`)
  // Use the directory URL Mintlify declares as canonical for index pages.
  const docsPaths = collectDocsPages(docsConfig.navigation).map((page) =>
    `/docs/${page.replace(/\/index$/, '')}`,
  )
  const paths = new Set([...MARKETING_PATHS, ...comparePaths, ...docsPaths])
  return [...paths].map((path) => ({ url: `${SITE_URL}${path}` }))
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
