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

test('deep search falls back to Elo when TinyFish is unavailable', async () => {
  const output = { results: [{ excerpts: ['full excerpt'] }] }
  assert.deepEqual(await searchDeepWithFallback({ objective: 'research' }, undefined, {
    elo: async (provider) => { assert.equal(provider, 'parallel'); return output },
    tinyfish: async () => { throw new Error('TinyFish unavailable') },
    tinyfishFetch: async () => { throw new Error('Fetch must not run') },
  }), { output, providerCalls: 1 })
})

test('deep search prefers TinyFish search and page text with filters, caps and call accounting', async () => {
  const { output, providerCalls } = await searchDeepWithFallback({
    objective: 'research goal', searchQueries: ['one', 'two'], includeDomains: ['example.com'],
    excludeDomains: ['bad.com'], afterDate: '2026-01-01', maxCharsPerResult: 200, maxCharsTotal: 2000,
    maxAgeSeconds: 600,
  }, undefined, {
    elo: async () => { throw new Error('Elo must not run') },
    tinyfish: async (query, options, purpose) => {
      assert.deepEqual(options.searchDomainFilter, ['example.com', '-bad.com'])
      assert.equal(options.searchAfterDate, '2026-01-01')
      assert.equal(purpose, 'research goal')
      return { results: [{ title: query, url: 'https://example.com', content: 'x'.repeat(300) }] }
    },
    tinyfishFetch: async (body) => {
      assert.deepEqual(body.urls, ['https://example.com/'])
      assert.equal(body.ttl, 600)
      assert.equal(body.format, 'markdown')
      assert.equal(body.purpose, 'research goal')
      assert.equal(body.per_url_timeout_ms, 45000)
      return { results: [{ url: 'https://example.com/', text: 'real page '.repeat(100) }] }
    },
  })
  assert.equal(providerCalls, 4)
  const result = output as Record<string, unknown>
  assert.equal(result.search_strategy, 'deep_search_search_and_fetch')
  assert.equal(result.partial, false)
  assert.equal(searchResults(output).length, 1)
  assert.equal(String(searchResults(output)[0].content).length, 200)
  assert.match(String(searchResults(output)[0].content), /^real page/)
  assert.equal(searchResults(output)[0].source_type, 'page_text')
})

test('deep search keeps readable pages and labels partial snippet evidence', async () => {
  const { output, providerCalls } = await searchDeepWithFallback({ objective: 'goal', searchQueries: ['failed'] }, undefined, {
    tinyfish: async (query) => {
      if (query === 'failed') throw new Error('timeout')
      return { results: [
        { url: 'https://example.com/a', title: 'A', content: 'snippet A' },
        { url: 'https://example.com/b', title: 'B', content: 'snippet B' },
      ] }
    },
    tinyfishFetch: async () => ({ results: [{ url: 'https://example.com/b', text: 'page B' }], errors: [{ url: 'https://example.com/a', error: 'timeout' }] }),
    elo: async () => { throw new Error('Elo must not run') },
  })
  assert.equal(providerCalls, 2)
  assert.deepEqual(searchResults(output).map((r) => [r.content, r.source_type]), [
    ['page B', 'page_text'], ['snippet A', 'search_snippet'],
  ])
  assert.equal((output as Record<string, unknown>).partial, true)
})

test('deep search falls back to Elo when page fetch times out', async () => {
  const output = { results: [{ url: 'https://elo.example', excerpts: ['Elo research'] }] }
  const response = await searchDeepWithFallback({ objective: 'goal' }, undefined, {
    tinyfish: async () => ({ results: [{ title: 'A', url: 'https://example.com/a', content: 'snippet' }] }),
    tinyfishFetch: async () => {
      const error = new Error('The operation timed out')
      error.name = 'TimeoutError'
      throw error
    },
    elo: async (provider) => {
      assert.equal(provider, 'parallel')
      return output
    },
  })
  assert.deepEqual(response, { output, providerCalls: 2 })
})

test('deep search filters source domains and rejects out-of-scope redirects', async () => {
  const fetchedUrls: string[][] = []
  const output = { results: [{ url: 'https://elo.example', excerpts: ['Elo research'] }] }
  const response = await searchDeepWithFallback({
    objective: 'goal',
    searchQueries: ['supplement'],
    includeDomains: ['example.com'],
    excludeDomains: ['blocked.example.com'],
    maxResults: 3,
  }, undefined, {
    tinyfish: async (_query, options) => {
      assert.deepEqual(options.searchDomainFilter, ['example.com', '-blocked.example.com'])
      return { results: [
        { title: 'Allowed', url: 'https://example.com/article#source', content: 'snippet' },
        { title: 'Duplicate', url: 'https://example.com/article#other', content: 'snippet' },
        { title: 'Excluded', url: 'https://blocked.example.com/article', content: 'snippet' },
        { title: 'Outside', url: 'https://outside.test/article', content: 'snippet' },
      ] }
    },
    tinyfishFetch: async (body) => {
      const urls = body.urls as string[]
      fetchedUrls.push(urls)
      assert.deepEqual(urls, ['https://example.com/article'])
      return { results: [{
        url: urls[0],
        final_url: 'https://blocked.example.com/redirected',
        text: 'out-of-scope page text',
      }] }
    },
    elo: async () => output,
  })
  assert.deepEqual(fetchedUrls, [['https://example.com/article']])
  assert.deepEqual(response, { output, providerCalls: 4 })
})

test('deep search falls back on empty, failed or malformed extraction and accounts completed calls', async () => {
  for (const fetched of [{ results: [], errors: [] }, { error: 'invalid response' }, { results: [{ url: 'https://other.com', text: 'unrequested' }] }]) {
    const output = { results: [{ url: 'https://elo.example', excerpts: ['Elo research'] }] }
    const response = await searchDeepWithFallback({ objective: 'goal', effort: 'standard' }, undefined, {
      tinyfish: async () => ({ results: [{ title: 'A', url: 'https://example.com', content: 'snippet' }] }),
      tinyfishFetch: async () => fetched,
      elo: async (provider, body) => {
        assert.equal(provider, 'parallel')
        assert.equal(body.mode, 'basic')
        return output
      },
    })
    assert.deepEqual(response, { output, providerCalls: 3 })
  }
  await assert.rejects(searchDeepWithFallback({ objective: 'goal' }, undefined, {
    tinyfish: async () => ({ results: [] }),
    tinyfishFetch: async () => { throw new Error('Fetch must not run') },
    elo: async () => { throw new Error('Elo unavailable') },
  }), /Elo unavailable/)
})

test('deep search maximum TinyFish work plus Elo fallback stays within the reservation', async () => {
  const queries: string[] = []
  const batches: string[][] = []
  const output = { results: [{ url: 'https://elo.example', excerpts: ['Elo research'] }] }
  const response = await searchDeepWithFallback({
    objective: 'objective',
    searchQueries: ['one', 'two', 'three', 'four', 'five', 'six'],
    effort: 'deep',
    maxResults: 20,
  }, undefined, {
    tinyfish: async (query) => {
      queries.push(query)
      return {
        results: Array.from({ length: 20 }, (_, index) => ({
          title: `${query} ${index}`,
          url: `https://example.com/${query}/${index}`,
          content: 'snippet',
        })),
      }
    },
    tinyfishFetch: async (body) => {
      const urls = body.urls as string[]
      batches.push(urls)
      assert.ok(urls.length <= 10)
      return { results: [] }
    },
    elo: async (provider) => {
      assert.equal(provider, 'parallel')
      return output
    },
  })
  assert.deepEqual(queries, ['objective', 'one', 'two', 'three', 'four', 'five'])
  assert.equal(batches.length, 2)
  assert.equal(batches.flat().length, 20)
  assert.deepEqual(response, { output, providerCalls: 9 })
  assert.ok(response.providerCalls * 0.005 <= 0.05)
})

test('deep search bounds effort, fetch batches and total text within the reservation', async () => {
  for (const [effort, expectedQueries, expectedPages] of [['fast', 2, 3], ['standard', 4, 6], ['deep', 6, 20]] as const) {
    let queries = 0
    const batches: string[][] = []
    const { output, providerCalls } = await searchDeepWithFallback({
      objective: 'goal', searchQueries: ['a', 'b', 'c', 'd', 'e', 'f'],
      effort, maxResults: 20, maxCharsTotal: 2000,
    }, undefined, {
      tinyfish: async (query) => {
        queries++
        return { results: Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/${query}/${i}`, title: query, content: 'snippet' })) }
      },
      tinyfishFetch: async (body) => {
        const urls = body.urls as string[]
        batches.push(urls)
        assert.ok(urls.length <= 10)
        return { results: urls.map((url) => ({ url, text: 'x'.repeat(1000) })) }
      },
      elo: async () => { throw new Error('Elo must not run') },
    })
    assert.equal(queries, expectedQueries)
    assert.equal(batches.flat().length, expectedPages)
    assert.equal(providerCalls, expectedQueries + Math.ceil(expectedPages / 10))
    assert.ok(providerCalls * 0.005 <= 0.05)
    assert.equal(searchResults(output).reduce((sum, r) => sum + String(r.content).length, 0), 2000)
    assert.match(batches[0][1], /\/a\/0$/)
  }
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
    search_note: 'Entries labeled search_snippet are not page text.',
  }
  const merged = mergeExactEntityFallbackResults(primary, fallback, plan) as Record<string, unknown>
  assert.equal(merged.search_strategy, 'exact_entity_deep_augmentation')
  assert.match(String(merged.search_note), /Entries labeled search_snippet are not page text/)
  assert.equal(searchResults(merged).length, 2)
})
