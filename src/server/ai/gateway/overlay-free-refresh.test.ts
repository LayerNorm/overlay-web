import assert from 'node:assert/strict'
import test from 'node:test'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import { preflightOverlayFreeRoute, refreshOverlayFreeCatalog } from './overlay-free-refresh'
import type { OverlayFreeRoute } from './overlay-free-router'

const modelId = 'minimax/minimax-m3.1-flash'
const endpoint = {
  provider_name: 'minimax',
  context_length: 1_000_000,
  max_completion_tokens: 524_288,
  tags: ['tool-use', 'vision', 'structured-output'],
  supported_parameters: ['tools', 'tool_choice', 'response_format', 'structured_outputs'],
  pricing: {
    prompt: '0', completion: '0', request: '0', image: '0', image_output: '0',
    web_search: '0', internal_reasoning: '0', input_cache_read: '0', discount: 0,
  },
}
const fetchers = {
  gatewayModels: async () => ({ data: [{ id: modelId, type: 'language', pricing: { input: '0', output: '0' } }] }),
  gatewayEndpoints: async () => ({ data: { id: modelId, endpoints: [
    endpoint,
    { ...endpoint, provider_name: 'paid', pricing: { prompt: '0', completion: '0.1' } },
  ] } }),
  openrouterModels: async () => ({ data: [{
    id: 'openrouter/free', context_length: 200_000,
    pricing: { prompt: '0', completion: '0' },
    supported_parameters: ['tools', 'tool_choice'],
  }] }),
}

function storage() {
  let routes: OverlayFreeRoute[] = []
  const operations: { name: string; args: Record<string, unknown> }[] = []
  const store: NonNullable<NonNullable<Parameters<typeof refreshOverlayFreeCatalog>[0]>['store']> = {
    mutation: async <T>(path: string, args: Record<string, unknown>) => {
      const name = path.split(':')[1]!
      operations.push({ name, args })
      let result: unknown = null
      if (name === 'acquireRefreshLockByServer') result = { generation: 1, leaseToken: args.leaseToken }
      if (name === 'publishByServer') routes = args.routes as OverlayFreeRoute[]
      if (name === 'claimByServer') result = {
        status: 'claimed',
        route: { ...routes.find(route => route.routeKey === args.routeKey), activeLeaseToken: args.leaseToken },
      }
      if (name === 'settleByServer') result = { status: 'settled' }
      return result as T
    },
  }
  return { store, operations, routes: () => routes }
}

test('refresh uses slash-separated Gateway URLs, pins a free provider, verifies its receipt, and keeps OpenRouter', async (t) => {
  const previous = process.env.INTERNAL_API_SECRET
  process.env.INTERNAL_API_SECRET = 'refresh-test-secret'
  t.after(() => { if (previous === undefined) delete process.env.INTERNAL_API_SECRET; else process.env.INTERNAL_API_SECRET = previous })
  const state = storage()
  const requestedUrls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url === 'https://ai-gateway.vercel.sh/v1/models') return Response.json(await fetchers.gatewayModels())
    if (url === `https://ai-gateway.vercel.sh/v1/models/${modelId}/endpoints`) return Response.json(await fetchers.gatewayEndpoints())
    if (url === 'https://openrouter.ai/api/v1/models') return Response.json(await fetchers.openrouterModels())
    return new Response('Not found', { status: 404 })
  })
  let requests = 0
  const canary: LanguageModelV4 = {
    specificationVersion: 'v4', provider: 'gateway', modelId, supportedUrls: {},
    doStream: async () => { throw new Error('not used') },
    doGenerate: async (options) => {
      requests++
      assert.deepEqual(options.providerOptions, { gateway: { only: ['minimax'], models: [] } })
      return {
        content: [{ type: 'text', text: 'OK' }],
        finishReason: { unified: 'stop', raw: 'stop' }, warnings: [],
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        providerMetadata: { gateway: {
          cost: '0', marketCost: '0', gatewayCost: '0', surchargeCost: '0',
          routing: { canonicalSlug: modelId, finalProvider: 'minimax' },
        } },
      }
    },
  }
  await refreshOverlayFreeCatalog({ store: state.store, loadGateway: async () => () => canary })
  assert.equal(requests, 1)
  assert.equal(requestedUrls.filter(url => url === `https://ai-gateway.vercel.sh/v1/models/${modelId}/endpoints`).length, 2)
  assert.equal(state.routes().length, 2)
  assert.ok(state.routes().find(route => route.transport === 'gateway')?.canaryExpiresAt)
  assert.ok(state.routes().find(route => route.modelId === 'openrouter/free'))
  assert.equal(state.operations.filter(op => op.name === 'settleByServer').length, 1)
  const verified = state.routes().find(route => route.transport === 'gateway')!
  assert.equal(await preflightOverlayFreeRoute(verified, {
    ...fetchers,
    gatewayEndpoints: async () => ({ data: { id: modelId, endpoints: [{
      ...endpoint, pricing: { ...endpoint.pricing, completion: '0.01' },
    }] } }),
  }), null)
})

test('failed Gateway discovery still publishes OpenRouter and explicit OpenRouter does not discover Gateway', async (t) => {
  const previous = process.env.INTERNAL_API_SECRET
  process.env.INTERNAL_API_SECRET = 'refresh-test-secret'
  t.after(() => { if (previous === undefined) delete process.env.INTERNAL_API_SECRET; else process.env.INTERNAL_API_SECRET = previous })
  for (const onlyOpenRouter of [false, true]) {
    const state = storage()
    let discoveries = 0
    await refreshOverlayFreeCatalog({
      onlyOpenRouter, store: state.store,
      fetchers: { ...fetchers, gatewayModels: async () => { discoveries++; throw new Error('catalog offline') } },
      loadGateway: async () => { throw new Error('must not construct Gateway') },
    })
    assert.equal(discoveries, onlyOpenRouter ? 0 : 1)
    assert.deepEqual(state.routes().map(route => route.modelId), ['openrouter/free'])
    assert.equal(state.operations.at(-1)?.args.partial, onlyOpenRouter)
  }
})
