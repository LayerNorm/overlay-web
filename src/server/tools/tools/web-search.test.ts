import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExactEntityFallbackPlan,
  filterExactEntityResults,
  mergeExactEntityFallbackResults,
  searchResults,
} from './web-search-entity'
import {
  buildParallelRequestBody,
  buildTavilyRequestBody,
  buildTinyfishRequestBody,
} from './web-search'

test('buildTavilyRequestBody maps filters and dates', () => {
  const body = buildTavilyRequestBody('overlay ai funding', {
    maxResults: 8,
    searchDomainFilter: ['example.com', '-bad.com'],
    searchRecencyFilter: 'week',
    country: 'US',
  })
  assert.equal(body.query, 'overlay ai funding')
  assert.equal(body.max_results, 8)
  assert.equal(body.search_depth, 'basic')
  assert.equal(body.include_answer, true)
  assert.deepEqual(body.include_domains, ['example.com'])
  assert.deepEqual(body.exclude_domains, ['bad.com'])
  assert.equal(body.time_range, 'week')
  assert.equal(body.country, 'United States')
})

test('buildTavilyRequestBody prefers explicit date range over recency', () => {
  const body = buildTavilyRequestBody('q', {
    searchAfterDate: '2026-01-01',
    searchBeforeDate: '2026-02-01',
    searchRecencyFilter: 'day',
  })
  assert.equal(body.start_date, '2026-01-01')
  assert.equal(body.end_date, '2026-02-01')
  assert.equal(body.time_range, undefined)
})

test('buildParallelRequestBody emits v1 mode and advanced_settings nesting', () => {
  const body = buildParallelRequestBody({
    objective: 'compare vector databases',
    effort: 'deep',
    searchQueries: ['vector db benchmarks', 'pgvector vs qdrant'],
    maxResults: 20,
    includeDomains: ['docs.db'],
    afterDate: '2026-01-01',
    maxCharsPerResult: 4000,
    maxCharsTotal: 12000,
    maxAgeSeconds: 60,
  }, 'claude-sonnet-4-6')
  assert.equal(body.objective, 'compare vector databases')
  assert.equal(body.mode, 'advanced')
  assert.deepEqual(body.search_queries, ['vector db benchmarks', 'pgvector vs qdrant'])
  assert.equal(body.max_chars_total, 12000)
  assert.equal(body.client_model, 'claude-sonnet-4-6')
  const advanced = body.advanced_settings as Record<string, unknown>
  assert.equal(advanced.max_results, 20)
  assert.deepEqual(advanced.source_policy, {
    include_domains: ['docs.db'],
    after_date: '2026-01-01',
  })
  assert.deepEqual(advanced.excerpt_settings, { max_chars_per_result: 4000 })
  assert.deepEqual(advanced.fetch_policy, { max_age_seconds: 600 })
})

test('buildParallelRequestBody defaults search_queries from objective and mode from effort', () => {
  const fast = buildParallelRequestBody({ objective: 'quick check', effort: 'fast' })
  assert.equal(fast.mode, 'fast')
  assert.deepEqual(fast.search_queries, ['quick check'])
  const standard = buildParallelRequestBody({ objective: 'x', effort: 'standard' })
  assert.equal(standard.mode, 'basic')
})

test('buildTinyfishRequestBody passes urls and selector scope', () => {
  const body = buildTinyfishRequestBody({
    urls: ['https://example.com/a', 'https://example.com/b'],
    ttl: 3600,
    includeSelectors: ['article'],
    excludeSelectors: ['.nav'],
  })
  assert.deepEqual(body.urls, ['https://example.com/a', 'https://example.com/b'])
  assert.equal(body.format, 'markdown')
  assert.equal(body.ttl, 3600)
  assert.deepEqual(body.include_selectors, ['article'])
  assert.deepEqual(body.exclude_selectors, ['.nav'])
})

test('buildExactEntityFallbackPlan detects who-is queries and strips decorations', () => {
  const plan = buildExactEntityFallbackPlan('who is the CEO of Anthropic?')
  assert.ok(plan)
  assert.equal(plan.label, 'the CEO of Anthropic')
  assert.match(plan.objective, /CEO of Anthropic/)
  assert.deepEqual(plan.searchQueries, ['"the CEO of Anthropic"', 'the CEO of Anthropic'])
  assert.equal(buildExactEntityFallbackPlan('latest tech news'), null)
})

test('filterExactEntityResults keeps identity matches only', () => {
  const plan = buildExactEntityFallbackPlan('who is Dario Amodei?')!
  const output = {
    results: [
      { url: 'https://example.com/dario-amodei', title: 'Dario Amodei profile' },
      { url: 'https://other.com/tech', title: 'Tech industry news' },
    ],
  }
  const filtered = filterExactEntityResults(output, plan) as { results: unknown[] }
  assert.equal(filtered.results.length, 1)
})

test('mergeExactEntityFallbackResults dedupes and marks augmentation', () => {
  const plan = buildExactEntityFallbackPlan('who is Dario Amodei?')!
  const primary = { results: [{ url: 'https://a.com/dario-amodei', title: 'Dario Amodei bio' }] }
  const fallback = {
    results: [
      { url: 'https://a.com/dario-amodei', title: 'dup', excerpts: ['e'] },
      { url: 'https://b.com/dario-amodei-profile', title: 'Dario Amodei profile' },
    ],
  }
  const merged = mergeExactEntityFallbackResults(primary, fallback, plan) as Record<string, unknown>
  assert.equal(merged.search_strategy, 'exact_entity_deep_augmentation')
  assert.equal(searchResults(merged).length, 2)
})
