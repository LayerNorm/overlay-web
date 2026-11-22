import type { MetadataRoute } from 'next'
import docsConfig from '../../docs/docs.json'
import webApiSpec from '../../docs/openapi/overlay-web.openapi.json'
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
      const openapi = record.openapi as { source?: unknown; directory?: unknown } | undefined
      if (openapi?.source === 'openapi/overlay-web.openapi.json' && typeof openapi.directory === 'string') {
        for (const page of getApiReferencePaths(openapi.directory)) pages.add(page)
      }
      for (const key of ['tabs', 'groups', 'pages']) {
        if (key in record) visit(record[key])
      }
    }
  }
  visit(node)
  return [...pages]
}

// Match Mintlify's generated paths for the tagged, titled operations in our OpenAPI spec.
function mintlifyFilename(value: string): string {
  return value
    .replaceAll(' ', '-')
    .replace(/\{.*?\}/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/[{}(),.'\n/]/g, '')
    .replaceAll('--', '-')
    .toLowerCase()
}

function getApiReferencePaths(directory: string): string[] {
  const paths = new Set<string>()
  for (const methods of Object.values(webApiSpec.paths)) {
    for (const operation of Object.values(methods)) {
      const base = `${directory}/${mintlifyFilename(operation.tags[0])}/${mintlifyFilename(operation.summary)}`
      let path = base
      for (let suffix = 1; paths.has(path); suffix++) path = `${base}-${suffix}`
      paths.add(path)
    }
  }
  return [...paths]
}
