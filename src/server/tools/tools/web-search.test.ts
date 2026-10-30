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
  buildTinyfishSearchParams,
  fetchTinyfishSearch,
  searchWebWithFallback,
  searchDeepWithFallback,
} from './web-search'

test('TinyFish maps domain, country, recency and explicit date filters', () => {
  const params = buildTinyfishSearchParams('a & b', {
    country: 'gb', searchDomainFilter: ['example.com', '-bad.com'], searchRecencyFilter: 'week',
  }, 'find evidence')
  assert.equal(params.get('query'), 'a & b')
  assert.equal(params.get('location'), 'GB')
  assert.equal(params.get('include_domains'), 'example.com')
  assert.equal(params.get('exclude_domains'), 'bad.com')
  assert.equal(params.get('recency_minutes'), '10080')
  assert.equal(params.get('purpose'), 'find evidence')
  const dated = buildTinyfishSearchParams('q', {
    searchAfterDate: '2026-01-01', searchBeforeDate: '2026-02-01', searchRecencyFilter: 'day',
  })
  assert.equal(dated.get('after_date'), '2026-01-01')
  assert.equal(dated.get('before_date'), '2026-02-01')
  assert.equal(dated.has('recency_minutes'), false)
})

test('TinyFish uses server-side header auth, normalizes snippets and caps results', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(new URL(url).origin, 'https://api.search.tinyfish.ai')
    assert.equal(new URL(url).searchParams.get('query'), 'hello & world')
    assert.equal(url.includes('test-key'), false)
    assert.deepEqual(options.headers, { 'X-API-Key': 'test-key' })
    assert.ok(options.signal)
    return Response.json({ results: [
      { title: 'Hello', url: 'https://example.com', snippet: 'Useful content' },
      { title: 'Other', url: 'https://example.org', snippet: 'Other content' },
    ] })
  })
  const output = await fetchTinyfishSearch('hello & world', { maxResults: 1 }, 'test-key')
  assert.equal(searchResults(output).length, 1)
  assert.equal(searchResults(output)[0].content, 'Useful content')
})

test('TinyFish empty results succeed; invalid payloads and HTTP errors fail', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [] }))
  assert.deepEqual(searchResults(await fetchTinyfishSearch('q', {}, 'test-key')), [])
  fetchMock.mock.mockImplementation(async () => Response.json({ error: 'bad response' }))
  await assert.rejects(fetchTinyfishSearch('q', {}, 'test-key'), /invalid response/)
  fetchMock.mock.mockImplementation(async () => new Response('private diagnostic', { status: 500 }))
  await assert.rejects(fetchTinyfishSearch('q', {}, 'test-key'), { message: 'Web search failed (TinyFish, HTTP 500)' })
})

test('web search prefers TinyFish and does not fall back on empty results', async () => {
  const result = { results: [] }
  assert.equal(await searchWebWithFallback('q', {}, {
    tinyfish: async () => result,
    elo: async () => { throw new Error('Elo must not run') },
  }), result)
})

test('web search falls back to Elo with original filters on provider failures', async () => {
  for (const reason of ['missing key', 'HTTP 401', 'HTTP 402', 'HTTP 429', 'HTTP 500', 'timeout', 'invalid response']) {
    const calls: string[] = []
    const result = { results: [{ url: 'https://example.com' }] }
    assert.equal(await searchWebWithFallback('hello', { searchRecencyFilter: 'day' }, {
      tinyfish: async () => { calls.push('tinyfish'); throw new Error(reason) },
      elo: async (provider, body) => {
        calls.push(provider)
        assert.equal(body.query, 'hello')
        assert.equal(body.time_range, 'day')
        return result
      },
    }), result)
    assert.deepEqual(calls, ['tinyfish', 'tavily'])
  }
  await assert.rejects(searchWebWithFallback('q', {}, {
    tinyfish: async () => { throw new Error('TinyFish down') },
    elo: async () => { throw new Error('Elo down') },
  }), /Elo down/)
})

test('deep search preserves rich Elo results when available', async () => {
  const output = { results: [{ excerpts: ['full excerpt'] }] }
  assert.deepEqual(await searchDeepWithFallback({ objective: 'research' }, undefined, {
    elo: async (provider) => { assert.equal(provider, 'parallel'); return output },
    tinyfish: async () => { throw new Error('TinyFish must not run') },
  }), { output, providerCalls: 1 })
})

test('deep search falls back to deduplicated, bounded and labeled snippets with call accounting', async () => {
  const { output, providerCalls } = await searchDeepWithFallback({
    objective: 'research goal', searchQueries: ['one', 'two'], includeDomains: ['example.com'],
    excludeDomains: ['bad.com'], afterDate: '2026-01-01', maxCharsPerResult: 200, maxCharsTotal: 2000,
  }, undefined, {
    elo: async () => { throw new Error('HTTP 500') },
    tinyfish: async (query, options, purpose) => {
      assert.deepEqual(options.searchDomainFilter, ['example.com', '-bad.com'])
      assert.equal(options.searchAfterDate, '2026-01-01')
      assert.equal(purpose, 'research goal')
      return { results: [{ title: query, url: 'https://example.com', content: 'x'.repeat(300) }] }
    },
  })
  assert.equal(providerCalls, 2)
  const result = output as Record<string, unknown>
  assert.equal(result.search_strategy, 'deep_search_snippet_fallback')
  assert.match(String(result.search_note), /not full-page research excerpts/)
  assert.equal(searchResults(output).length, 1)
  assert.equal(String(searchResults(output)[0].content).length, 200)
})

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
