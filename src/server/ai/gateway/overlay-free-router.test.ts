import assert from 'node:assert/strict'
import test from 'node:test'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { getGatewayLanguageModel } from './ai-gateway'
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import {
  createOverlayFreeLanguageModel,
  type OverlayFreeRepository,
  type OverlayFreeRoute,
} from './overlay-free-router'

const now = Date.now()

function route(transport: 'gateway' | 'openrouter', modelId: string, provider: string): OverlayFreeRoute {
  return {
    routeKey: `${transport}:${modelId}:${provider}`,
    transport,
    modelId,
    provider,
    capabilitiesJson: JSON.stringify({
      contextWindow: 100_000,
      maxOutputTokens: 4_096,
      supportsTools: true,
      supportsVision: true,
      supportsJson: true,
    }),
    pricingJson: JSON.stringify({ input: '0', output: '0' }),
    catalogVerifiedAt: now,
    catalogExpiresAt: now + 3_600_000,
    generation: 1,
    canaryVerifiedAt: transport === 'gateway' ? now : undefined,
    canaryExpiresAt: transport === 'gateway' ? now + 3_600_000 : undefined,
  }
}

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  }
}

function options(): LanguageModelV4CallOptions {
  return {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    providerOptions: { gateway: { only: ['caller'], tags: ['unsafe'] } },
    headers: { authorization: 'caller-secret' },
  }
}

function model(
  provider: string,
  generate: (options: LanguageModelV4CallOptions) => Promise<Awaited<ReturnType<LanguageModelV4['doGenerate']>>>,
  stream?: () => ReadableStream<LanguageModelV4StreamPart>,
): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider,
    modelId: provider,
    supportedUrls: {},
    doGenerate: generate,
    doStream: async () => {
      if (!stream) throw new Error('stream not used')
      return { stream: stream(), request: {}, response: { headers: {} } }
    },
  }
}

function dependencies(routes: OverlayFreeRoute[], calls: string[], overrides: Partial<OverlayFreeRepository> = {}) {
  const repository: OverlayFreeRepository = {
    listEligible: async () => routes,
    claim: async (routeKey, leaseToken) => ({
      status: 'claimed',
      route: { ...routes.find((value) => value.routeKey === routeKey)!, activeLeaseToken: leaseToken },
    }),
    settle: async ({ routeKey, safe }) => { calls.push(`settle:${routeKey}:${safe}`) },
    cooldown: async (routeKey) => { calls.push(`cooldown:${routeKey}`) },
    ...overrides,
  }
  return {
    repository,
    preflight: async (value: OverlayFreeRoute) => ({
      capabilities: JSON.parse(value.capabilitiesJson),
    }),
  }
}

function gatewayReceipt(modelId: string, provider: string, cost = '0') {
  return {
    content: [{ type: 'text' as const, text: 'free' }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: usage(),
    providerMetadata: {
      gateway: {
        cost,
        marketCost: cost,
        surchargeCost: '0',
        gatewayCost: cost,
        routing: { canonicalSlug: modelId, finalProvider: provider },
      },
    },
    response: { modelId, headers: {} },
    warnings: [],
  }
}

function openRouterReceipt(modelId = 'provider/free', cost = '0') {
  return {
    content: [{ type: 'text' as const, text: 'free' }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: usage(),
    providerMetadata: { openrouter: { usage: { cost } } },
    response: { modelId, headers: {} },
    warnings: [],
  }
}

test('claims, revalidates, pins one provider, strips caller controls, and settles before return', async () => {
  const routes = [route('gateway', 'second/model', 'second')]
  const calls: string[] = []
  const deps = dependencies(routes, calls)
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async (modelId, provider) => model(provider, async (request) => {
        calls.push(`generate:${modelId}`)
        assert.deepEqual(request.providerOptions, { gateway: { only: [provider], models: [] } })
        assert.equal(request.headers, undefined)
        return gatewayReceipt(modelId, provider)
      }),
      openrouter: async () => { throw new Error('unexpected OpenRouter call') },
    },
    now: () => now,
  })
  const result = await languageModel.doGenerate(options())
  assert.equal(result.content[0]?.type, 'text')
  assert.deepEqual(calls, [
    'generate:second/model',
    'settle:gateway:second/model:second:true',
  ])
})

test('rechecks current catalog before constructing a provider and tries the next route', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('openrouter', 'openrouter/free', 'openrouter'),
  ]
  const calls: string[] = []
  const deps = dependencies(routes, calls)
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    preflight: async (value) => value.transport === 'gateway' ? null : ({
      capabilities: JSON.parse(value.capabilitiesJson),
    }),
    providers: {
      gateway: async () => { calls.push('factory:gateway'); throw new Error('must not construct') },
      openrouter: async () => model('openrouter', async (request) => {
        calls.push('generate:openrouter')
        assert.deepEqual(request.providerOptions, { openrouter: { models: [], provider: { require_parameters: true } } })
        return openRouterReceipt()
      }),
    },
    now: () => now,
  })
  const result = await languageModel.doGenerate(options())
  assert.equal(result.providerMetadata?.overlayFree.safe, true)
  assert.deepEqual(calls, [
    'settle:gateway:first/model:first:false',
    'generate:openrouter',
    'settle:openrouter:openrouter/free:openrouter:true',
  ])
})

test('rejects unsupported privacy requirements before calling a provider', async () => {
  const routes = [route('openrouter', 'openrouter/free', 'openrouter')]
  const calls: string[] = []
  const deps = dependencies(routes, calls, {
    listEligible: async () => { calls.push('list'); return routes },
  })
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => { calls.push('gateway'); throw new Error('unexpected') },
      openrouter: async () => { calls.push('openrouter'); throw new Error('unexpected') },
    },
  })
  await assert.rejects(languageModel.doGenerate({
    ...options(),
    providerOptions: { gateway: { zeroDataRetention: true } },
  }), /overlay_free_zdr_unsupported/)
  await assert.rejects(languageModel.doGenerate({
    ...options(),
    providerOptions: { openrouter: { provider: { zdr: true } } },
  }), /overlay_free_zdr_unsupported/)
  await assert.rejects(languageModel.doGenerate({
    ...options(),
    providerOptions: { openrouter: { provider: { data_collection: 'deny' } } },
  }), /overlay_free_zdr_unsupported/)
  assert.deepEqual(calls, [])
})

test('returns a completed nonzero-receipt answer without retrying another provider', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('openrouter', 'openrouter/free', 'openrouter'),
  ]
  const calls: string[] = []
  const deps = dependencies(routes, calls)
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => model('first', async () => gatewayReceipt('first/model', 'first', '0.0001')),
      openrouter: async () => { calls.push('openrouter'); throw new Error('must not retry') },
    },
  })

  const result = await languageModel.doGenerate(options())

  assert.equal(result.content[0]?.type, 'text')
  assert.equal(result.providerMetadata?.overlayFree.safe, false)
  assert.deepEqual(calls, ['settle:gateway:first/model:first:false'])
})

test('explicit OpenRouter Free is fallback-only and retains its model identity', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('openrouter', 'openrouter/free', 'openrouter'),
  ]
  const calls: string[] = []
  const deps = dependencies(routes, calls)
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    modelId: 'openrouter/free',
    fallbackOnly: true,
    providers: {
      gateway: async () => { calls.push('gateway'); throw new Error('must not call Gateway') },
      openrouter: async () => model('openrouter', async () => openRouterReceipt()),
    },
  })
  assert.equal(languageModel.modelId, 'openrouter/free')
  await languageModel.doGenerate(options())
  assert.equal(calls.includes('gateway'), false)
})

test('streams fall back after an early error in the same pull', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('openrouter', 'openrouter/free', 'openrouter'),
  ]
  const calls: string[] = []
  const deps = dependencies(routes, calls)
  const finish: LanguageModelV4StreamPart = {
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: usage(),
    providerMetadata: { openrouter: { usage: { cost: '0' } } },
  }
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => model('first', async () => gatewayReceipt('first/model', 'first'), () =>
        new ReadableStream({ start(controller) { controller.enqueue({ type: 'error', error: new Error('before output') }) ; controller.close() } })),
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), () =>
        new ReadableStream({ start(controller) {
          controller.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' })
          controller.enqueue(finish)
          controller.close()
        } })),
    },
  })
  const result = await languageModel.doStream(options())
  const reader = result.stream.getReader()
  const parts: LanguageModelV4StreamPart[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) break
    if (next.value.type === 'finish') {
      assert.ok(calls.includes('settle:openrouter:openrouter/free:openrouter:true'))
    }
    parts.push(next.value)
  }
  assert.ok(parts.some((part) => part.type === 'text-delta' && part.delta === 'ok'))
  assert.deepEqual(calls, [
    'settle:gateway:first/model:first:false',
    'settle:openrouter:openrouter/free:openrouter:true',
  ])
})

test('stream errors after semantic output settle unsafe and never retry', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('openrouter', 'openrouter/free', 'openrouter'),
  ]
  const calls: string[] = []
  const deps = dependencies(routes, calls)
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => model('first', async () => gatewayReceipt('first/model', 'first'), () =>
        new ReadableStream({ start(controller) {
          controller.enqueue({ type: 'text-delta', id: 't1', delta: 'partial' })
          controller.enqueue({ type: 'error', error: new Error('after output') })
        } })),
      openrouter: async () => { calls.push('openrouter'); throw new Error('must not retry') },
    },
  })
  const result = await languageModel.doStream(options())
  const reader = result.stream.getReader()

  assert.equal((await reader.read()).value?.type, 'text-delta')
  await assert.rejects(reader.read(), /after output/)
  assert.deepEqual(calls, ['settle:gateway:first/model:first:false'])
})

test('rejects media in actual V4 tool-result history before provider calls', async () => {
  const gateway = route('gateway', 'first/model', 'first')
  gateway.capabilitiesJson = JSON.stringify({
    contextWindow: 100_000, maxOutputTokens: 4_096,
    supportsTools: true, supportsVision: false, supportsJson: true,
  })
  const calls: string[] = []
  const deps = dependencies([gateway], calls)
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => { calls.push('gateway'); throw new Error('unexpected') },
      openrouter: async () => { calls.push('openrouter'); throw new Error('unexpected') },
    },
  })

  await assert.rejects(languageModel.doGenerate({
    ...options(),
    prompt: [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: '{}' }] },
      { role: 'tool', content: [{
        type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup',
        output: { type: 'content', value: [{
          type: 'image-data', data: 'AQID', mediaType: 'image/png',
        }] },
      }] },
    ],
  }), /overlay_free_no_eligible_route/)
  assert.deepEqual(calls, [])
})

test('preserves V4 tool-call history, tool definitions, and tool choice', async () => {
  const routes = [route('gateway', 'first/model', 'first')]
  const calls: string[] = []
  const deps = dependencies(routes, calls)
  const prompt: LanguageModelV4CallOptions['prompt'] = [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: '{"query":"x"}' }] },
    { role: 'tool', content: [{
      type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup',
      output: { type: 'content', value: [{ type: 'text', text: 'result' }] },
    }] },
  ]
  const tools: NonNullable<LanguageModelV4CallOptions['tools']> = [{
    type: 'function',
    name: 'lookup',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }]
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async (modelId, provider) => model(provider, async (request) => {
        assert.deepEqual(request.prompt, prompt)
        assert.deepEqual(request.tools, tools)
        assert.deepEqual(request.toolChoice, { type: 'tool', toolName: 'lookup' })
        return gatewayReceipt(modelId, provider)
      }),
      openrouter: async () => { throw new Error('unexpected OpenRouter call') },
    },
  })

  await languageModel.doGenerate({
    ...options(),
    prompt,
    tools,
    toolChoice: { type: 'tool', toolName: 'lookup' },
  })
})

test('awaits stream cancellation and settles its lease as unsafe', async () => {
  const calls: string[] = []
  const deps = dependencies([route('gateway', 'first/model', 'first')], calls)
  let cancelled = false
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => model('first', async () => gatewayReceipt('first/model', 'first'), () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'partial' })
          },
          cancel() { cancelled = true },
        })),
      openrouter: async () => { throw new Error('unexpected OpenRouter call') },
    },
  })
  const result = await languageModel.doStream(options())
  const reader = result.stream.getReader()

  await reader.read()
  await reader.cancel()
  assert.equal(cancelled, true)
  assert.deepEqual(calls, ['settle:gateway:first/model:first:false'])
})

test('the shared resolver creates both virtual models without provider access', async () => {
  for (const id of ['overlay-free', 'openrouter/free']) {
    const resolved = await getGatewayLanguageModel(id)
    assert.equal(resolved.modelId, id)
    assert.equal(resolved.specificationVersion, 'v4')
  }
})

test('AI SDK executes a two-step tool loop only after receipt settlement', async () => {
  const calls: string[] = []
  let generations = 0
  const routed = createOverlayFreeLanguageModel({
    ...dependencies([route('gateway', 'first/model', 'first')], calls),
    providers: {
      gateway: async () => model('first', async (request) => {
        generations++
        const result = gatewayReceipt('first/model', 'first')
        if (generations === 1) return {
          ...result,
          content: [{ type: 'tool-call', toolCallId: 'lookup-1', toolName: 'lookup', input: '{"query":"hello"}' }],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        }
        assert.ok(request.prompt.some(message => message.role === 'tool'))
        assert.deepEqual(calls, ['settle:gateway:first/model:first:true', 'execute:hello'])
        return result
      }),
      openrouter: async () => { throw new Error('unexpected fallback') },
    },
  })
  const result = await generateText({
    model: routed,
    prompt: 'Look up hello',
    maxRetries: 0,
    stopWhen: stepCountIs(2),
    tools: {
      lookup: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => { calls.push(`execute:${query}`); return 'found' },
      }),
    },
  })
  assert.equal(result.text, 'free')
  assert.equal(result.steps.length, 2)
  assert.equal(generations, 2)
  assert.equal(calls.at(-1), 'settle:gateway:first/model:first:true')
})

test('cancelling while waiting for first output cannot start fallback inference', async () => {
  const calls: string[] = []
  let reading!: () => void
  const started = new Promise<void>(resolve => { reading = resolve })
  const routed = createOverlayFreeLanguageModel({
    ...dependencies([
      route('gateway', 'first/model', 'first'),
      route('openrouter', 'openrouter/free', 'openrouter'),
    ], calls),
    providers: {
      gateway: async () => model('first', async () => gatewayReceipt('first/model', 'first'), () =>
        new ReadableStream({ pull() { reading() } })),
      openrouter: async () => { calls.push('fallback'); throw new Error('must not retry') },
    },
  })
  const response = await routed.doStream(options())
  const reader = response.stream.getReader()
  const pending = reader.read()
  await started
  await reader.cancel()
  assert.equal((await pending).done, true)
  assert.deepEqual(calls, ['settle:gateway:first/model:first:false'])
})

test('a storage failure during early stream fallback aborts all remaining attempts', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('gateway', 'second/model', 'second'),
    route('openrouter', 'openrouter/free', 'openrouter'),
  ]
  const calls: string[] = []
  let claims = 0
  const deps = dependencies(routes, calls)
  const originalClaim = deps.repository.claim
  deps.repository.claim = async (...args) => {
    claims++
    if (claims === 2) throw new Error('storage unavailable')
    return originalClaim(...args)
  }
  const routed = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => model('first', async () => gatewayReceipt('first/model', 'first'), () =>
        new ReadableStream({ start(controller) {
          controller.enqueue({ type: 'error', error: new Error('upstream failed') })
          controller.close()
        } })),
      openrouter: async () => { calls.push('fallback'); throw new Error('must not retry') },
    },
  })
  const response = await routed.doStream(options())
  await assert.rejects(response.stream.getReader().read(), /storage unavailable/)
  assert.equal(claims, 2)
  assert.deepEqual(calls, ['settle:gateway:first/model:first:false'])
})

test('preflight network failures cool down without quarantining an uncalled provider', async () => {
  const calls: string[] = []
  const routed = createOverlayFreeLanguageModel({
    ...dependencies([route('gateway', 'first/model', 'first')], calls),
    preflight: async () => { throw new Error('catalog unavailable') },
    providers: {
      gateway: async () => { throw new Error('must not call') },
      openrouter: async () => { throw new Error('must not call') },
    },
  })
  await assert.rejects(routed.doGenerate(options()), /overlay_free_no_eligible_route/)
  assert.deepEqual(calls, ['cooldown:gateway:first/model:first'])
})
