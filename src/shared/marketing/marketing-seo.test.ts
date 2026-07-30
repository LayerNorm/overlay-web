import assert from 'node:assert/strict'
import test from 'node:test'
import robots from '../../app/robots'
import sitemap from '../../app/sitemap'
import { MARKETING_DOCS_URL } from './marketing'

test('marketing navigation uses the canonical documentation URL', () => {
  assert.equal(MARKETING_DOCS_URL, 'https://getoverlay.io/docs')
})

test('the sitemap publishes clean marketing URLs instead of app showcase URLs', () => {
  const urls = sitemap().map((entry) => entry.url)
  assert.deepEqual(urls, [
    'https://getoverlay.io/home',
    'https://getoverlay.io/pricing',
    'https://getoverlay.io/manifesto',
    'https://getoverlay.io/docs',
  ])
  assert.equal(urls.some((url) => url.includes('/app/') || url.includes('showcase=1')), false)
})

test('robots keeps app surfaces out of the index and advertises the sitemap', () => {
  const result = robots()
  assert.equal(result.sitemap, 'https://getoverlay.io/sitemap.xml')
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
  assert.equal(
    rules.some((rule) => rule.disallow?.includes('/app/')),
    true,
  )
})
