import assert from 'node:assert/strict'
import test from 'node:test'
import robots from '../../app/robots'
import sitemap from '../../app/sitemap'
import { MARKETING_DOCS_URL } from './marketing'

test('marketing navigation uses the canonical documentation URL', () => {
  assert.equal(MARKETING_DOCS_URL, 'https://overlay.works/docs')
})

test('the sitemap publishes canonical marketing, comparison, docs and legal URLs', () => {
  const urls = sitemap().map((entry) => entry.url)
  const expected = [
    'https://overlay.works/home',
    'https://overlay.works/pricing',
    'https://overlay.works/self-hosting',
    'https://overlay.works/blog',
    'https://overlay.works/changelog',
    'https://overlay.works/manifesto',
    'https://overlay.works/download',
    'https://overlay.works/compare',
    'https://overlay.works/compare/devin-alternatives',
    'https://overlay.works/compare/devin',
    'https://overlay.works/compare/openhands',
    'https://overlay.works/compare/lindy',
    'https://overlay.works/compare/ai-employee-platforms',
    'https://overlay.works/docs/introduction',
    'https://overlay.works/docs/help',
    'https://overlay.works/docs/help/billing',
    'https://overlay.works/docs/self-hosting/configure/authentication',
    'https://overlay.works/docs/developer/api/guides/bootstrap',
    'https://overlay.works/terms',
    'https://overlay.works/privacy',
    'https://overlay.works/acceptable-use',
    'https://overlay.works/cookies',
    'https://overlay.works/commercial-license',
    'https://overlay.works/dpa',
    'https://overlay.works/subprocessors',
    'https://overlay.works/refunds',
    'https://overlay.works/dmca',
  ]
  for (const url of expected) assert.ok(urls.includes(url), `Missing sitemap URL: ${url}`)
  assert.equal(new Set(urls).size, urls.length)
  assert.ok(urls.every((url) => new URL(url).origin === 'https://overlay.works'))
  assert.ok(urls.every((url) => !new URL(url).search && !new URL(url).hash))
  assert.ok(urls.every((url) => !new URL(url).pathname.startsWith('/app')))
  assert.equal(urls.includes('https://overlay.works/docs'), false)
  assert.ok(urls.every((url) => !url.endsWith('/index')))
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
