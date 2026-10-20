import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OverlayFreeRouter, isFreePricing, reportedCost } from './overlay-free-router.mjs'

test('free pricing requires explicit zeros and excludes extra charges', () => {
  assert.equal(isFreePricing({ prompt: '0', completion: '0', input_cache_read: '0' }), true)
  for (const pricing of [{ prompt: '0' }, { prompt: '', completion: 0 }, { prompt: null, completion: 0 },
    { prompt: 0, completion: 0, input_cache_read: '.01' }, { prompt: 0, completion: 0, tiers: [] }]) {
    assert.equal(isFreePricing(pricing), false)
  }
})

test('cost guard catches gateway surcharges even when model cost is zero', () => {
  assert.equal(reportedCost({ usage: { cost: 0, gateway_cost: .000075, reporting_tag_write_cost: .000075 } }), .000075)
  assert.equal(reportedCost({ usage: { cost: 0, gateway_cost: 0 } }), 0)
  assert.equal(reportedCost({ usage: { cost: null } }), null)
  assert.equal(reportedCost({ usage: { cost: null, gateway_cost: 0 } }), null)
  assert.equal(reportedCost({ usage: { cost: '' } }), null)
  assert.equal(reportedCost({ usage: { cost: -1 } }), null)
})

function fixture({ cost = 0, fail = false, changedPrice = false, clock = 1000000 } = {}) {
  const calls = []
  let now = clock
  const endpoint = { provider_name: 'free-provider', pricing: { prompt: '0', completion: '0' } }
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/endpoints')) return Response.json({ data: { endpoints: [{ ...endpoint,
      pricing: changedPrice ? { prompt: '.01', completion: '0' } : endpoint.pricing }] } })
    if (url.endsWith('/models')) return Response.json({ data: [{ type: 'language', id: 'example/free', name: 'Free', pricing: { input: 0, output: 0 } }] })
    const body = JSON.parse(options.body)
    calls.push(body)
    if (fail && body.model !== 'openrouter/free') return new Response('{}', { status: 429 })
    return Response.json({ id: 'generation-test', model: body.model, usage: cost === null ? {} : { cost, gateway_cost: cost },
      choices: [{ message: { content: 'Hello', ...(body.model !== 'openrouter/free' ? {
        provider_metadata: { gateway: { routing: { finalProvider: 'free-provider' } } } } : {}) } }] })
  }
  const router = new OverlayFreeRouter({ gatewayKey: 'test-only', openRouterKey: 'test-only', fetchImpl, now: () => now })
  router.lastRefresh = now
  router.pool = [{ key: 'example/free@free-provider', id: 'example/free', provider: 'free-provider', verifiedAt: now, status: 'ready' }]
  return { router, calls, advance: ms => { now += ms } }
}
const messages = [{ role: 'user', content: 'Hello' }]

test('Vercel is first with hard provider pinning and no reporting tags', async () => {
  const { router, calls } = fixture()
  assert.equal((await router.generate(messages)).text, 'Hello')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].providerOptions.gateway, { only: ['free-provider'], models: [] })
})

test('rate-limited Vercel falls back to OpenRouter and enters cooldown', async () => {
  const { router, calls } = fixture({ fail: true })
  const result = await router.generate(messages)
  assert.deepEqual(calls.map(call => call.model), ['example/free', 'openrouter/free'])
  assert.equal(result.trace.model, 'openrouter/free')
  await router.generate(messages)
  assert.deepEqual(calls.map(call => call.model), ['example/free', 'openrouter/free', 'openrouter/free'])
})

test('nonzero and unknown receipts quarantine before the next request, including after refresh', async () => {
  for (const cost of [.01, null]) {
    const { router, calls } = fixture({ cost })
    const first = await router.generate(messages)
    assert.match(first.warning, /quarantined/)
    await router.refresh()
    assert.equal(calls.length, 1)
    const second = await router.generate(messages)
    assert.equal(second.trace.model, 'openrouter/free')
    assert.equal(calls[1].model, 'openrouter/free')
    assert.ok((await router.generate(messages)).error)
    assert.equal(calls.length, 2)
  }
})

test('repriced or expired Vercel candidates cannot receive requests', async () => {
  for (const changedPrice of [true, false]) {
    const { router, calls, advance } = fixture({ changedPrice })
    if (!changedPrice) advance(60 * 60 * 1000)
    await router.generate(messages)
    assert.deepEqual(calls.map(call => call.model), ['openrouter/free'])
  }
})

test('concurrent calls cannot bypass receipt quarantine', async () => {
  const { router, calls } = fixture({ cost: .01 })
  await Promise.all([router.generate(messages), router.generate(messages)])
  assert.deepEqual(calls.map(call => call.model), ['example/free', 'openrouter/free'])
})

test('failed catalog refresh clears previously verified routes', async () => {
  const { router, calls } = fixture()
  const fetchImpl = router.fetch
  router.fetch = async (url, options) => url.endsWith('/models')
    ? new Response('{}', { status: 503 }) : fetchImpl(url, options)
  await router.refresh()
  assert.equal(router.pool.length, 0)
  await router.generate(messages)
  assert.deepEqual(calls.map(call => call.model), ['openrouter/free'])
})

test('unexpected provider is quarantined even with a zero-cost receipt', async () => {
  const { router } = fixture()
  const fetchImpl = router.fetch
  router.fetch = async (url, options) => {
    const response = await fetchImpl(url, options)
    if (!url.endsWith('/chat/completions')) return response
    const completion = await response.json()
    completion.choices[0].message.provider_metadata.gateway.routing.finalProvider = 'unexpected'
    return Response.json(completion)
  }
  const result = await router.generate(messages)
  assert.equal(result.trace.status, 'quarantined')
  assert.equal(result.trace.reason, 'Unexpected provider')
})
