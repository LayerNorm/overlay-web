import assert from 'node:assert/strict'
import test from 'node:test'
import robots from '../../app/robots'
import sitemap from '../../app/sitemap'
import { MARKETING_DOCS_URL } from './marketing'

test('marketing navigation uses the canonical documentation URL', () => {
  assert.equal(MARKETING_DOCS_URL, 'https://overlay.works/docs')
})

test('the sitemap publishes clean marketing and legal URLs instead of app showcase URLs', () => {
  const urls = sitemap().map((entry) => entry.url)
  assert.deepEqual(urls, [
    'https://overlay.works/home',
    'https://overlay.works/pricing',
    'https://overlay.works/self-hosting',
    'https://overlay.works/blog',
    'https://overlay.works/changelog',
    'https://overlay.works/manifesto',
    'https://overlay.works/docs',
    'https://overlay.works/terms',
    'https://overlay.works/privacy',
    'https://overlay.works/acceptable-use',
    'https://overlay.works/cookies',
    'https://overlay.works/commercial-license',
    'https://overlay.works/dpa',
    'https://overlay.works/subprocessors',
    'https://overlay.works/refunds',
    'https://overlay.works/dmca',
  ])
  assert.equal(urls.some((url) => url.includes('/app/') || url.includes('showcase=1')), false)
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
