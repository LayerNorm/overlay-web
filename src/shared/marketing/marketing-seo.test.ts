import assert from 'node:assert/strict'
import test from 'node:test'
import robots from '../../app/robots'
import sitemap from '../../app/sitemap'
import { MARKETING_DOCS_URL } from './marketing'

test('marketing navigation uses the canonical documentation URL', () => {
  assert.equal(MARKETING_DOCS_URL, 'https://overlay.works/docs')
})

test('the sitemap publishes canonical marketing, comparison, docs and legal URLs', () => {
  const urls = sitemap().map(({ url }) => new URL(url))
  const paths = new Set(urls.map(({ pathname }) => pathname))
  const expectedPaths = [
    '/home',
    '/pricing',
    '/self-hosting',
    '/blog',
    '/changelog',
    '/manifesto',
    '/download',
    '/compare',
    '/compare/devin-alternatives',
    '/compare/devin',
    '/compare/openhands',
    '/compare/lindy',
    '/compare/ai-employee-platforms',
    '/docs/introduction',
    '/docs/help',
    '/docs/help/billing',
    '/docs/self-hosting/configure/authentication',
    '/docs/developer/api/guides/bootstrap',
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
  for (const path of expectedPaths) assert.ok(paths.has(path), `Missing sitemap path: ${path}`)
  assert.equal(paths.size, urls.length)
  assert.ok(urls.every(({ origin, search, hash }) => origin === 'https://overlay.works' && !search && !hash))
  assert.ok(urls.every(({ pathname }) => pathname !== '/app' && !pathname.startsWith('/app/')))
  assert.equal(paths.has('/docs'), false)
  assert.ok(urls.every(({ pathname }) => !pathname.endsWith('/index')))
})

test('robots keeps app surfaces out of the index and advertises the sitemap', () => {
  const result = robots()
  assert.equal(result.sitemap, 'https://overlay.works/sitemap.xml')
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
  assert.equal(
    rules.some((rule) => rule.disallow?.includes('/app/')),
    true,
  )
})


test('every crawler group excludes private application and authentication paths', () => {
  const result = robots()
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
  for (const rule of rules) {
    for (const path of ['/app/', '/api/', '/auth/', '/share/']) {
      assert.ok(rule.disallow?.includes(path), `${String(rule.userAgent)} must exclude ${path}`)
    }
  }
})
