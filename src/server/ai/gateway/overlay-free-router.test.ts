import assert from 'node:assert/strict'
import test from 'node:test'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod/v3'
import { getGatewayLanguageModel } from './ai-gateway'
import { OverlayFreeRouteBusyError, OverlayFreeRouteInterruptedError } from './overlay-free-router-errors'
import { confirmOpenRouterGenerationCost as confirmGenerationCost } from './openrouter-generation-cost'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider'
import {
  createOverlayFreeLanguageModel,
  type OverlayFreeRepository,
  type OverlayFreeRoute,
} from './overlay-free-router'
import { FREE_ROUTE_IDLE_TIMEOUT_MS, FREE_ROUTE_LEASE_MS, FREE_ROUTE_TIMEOUT_MS } from '@/shared/ai/gateway/overlay-free-policy'

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
    pricingJson: JSON.stringify({ prompt: '0', completion: '0' }),
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
  stream?: (options: LanguageModelV4CallOptions) => ReadableStream<LanguageModelV4StreamPart>,
): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider,
    modelId: provider,
    supportedUrls: {},
    doGenerate: generate,
    doStream: async (options) => {
      if (!stream) throw new Error('stream not used')
      return { stream: stream(options), request: {}, response: { headers: {} } }
    },
  }
}

function abortableStream(
  options: LanguageModelV4CallOptions,
  emitFirstChunk: boolean,
  intervalMs?: number,
  finishAfterChunks?: number,
  generationId?: string,
): ReadableStream<LanguageModelV4StreamPart> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let chunkCount = 0
  let controllerRef: ReadableStreamDefaultController<LanguageModelV4StreamPart> | undefined
  const signal = options.abortSignal
  const onAbort = () => controllerRef?.error(signal?.reason ?? new Error('aborted'))
  return new ReadableStream({
    start(controller) {
      controllerRef = controller
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
      if (generationId) {
        controller.enqueue({
          type: 'response-metadata',
          id: generationId,
          modelId: 'openrouter/free',
          headers: {},
        })
      }
      if (emitFirstChunk) controller.enqueue({ type: 'text-delta', id: 'timed-text-0', delta: 'a' })
    },
    pull(controller) {
      if (intervalMs === undefined || timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        chunkCount += 1
        if (finishAfterChunks !== undefined && chunkCount > finishAfterChunks) {
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: usage(),
            providerMetadata: { openrouter: { usage: { cost: '0' } } },
          })
          controller.close()
        } else {
          controller.enqueue({ type: 'text-delta', id: `timed-text-${chunkCount}`, delta: 'a' })
        }
      }, intervalMs)
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  })
}

async function readAfterTimer(
  reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>,
  milliseconds: number,
  tick: (milliseconds: number) => void,
) {
  const pending = reader.read()
  await Promise.resolve()
  await Promise.resolve()
  tick(milliseconds)
  return await pending
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

function interruptionSetup(input: {
  candidate?: OverlayFreeRoute
  generationId?: string
  status: number
  body?: unknown
  leaseDurationMs?: number
  failAfterOutput?: boolean
}) {
  const calls: string[] = []
  const settlements: Parameters<NonNullable<OverlayFreeRepository['settle']>>[0][] = []
  const candidate = input.candidate ?? route('openrouter', 'openrouter/free', 'openrouter')
  const deps = dependencies([candidate], calls, {
    settle: async settlement => { settlements.push(settlement) },
  })
  if (input.leaseDurationMs !== undefined) {
    const claim = deps.repository.claim
    deps.repository.claim = async (routeKey, leaseToken, generation, purpose) => {
      const claimed = await claim(routeKey, leaseToken, generation, purpose)
      return {
        ...claimed,
        route: claimed.route
          ? { ...claimed.route, activeLeaseExpiresAt: Date.now() + input.leaseDurationMs! }
          : null,
      }
    }
  }
  let requests = 0
  const confirmOpenRouterGenerationCost = (generationId: string) => confirmGenerationCost(
    generationId,
    'server-key',
    {
      fetcher: async () => {
        requests += 1
        return new Response(input.body === undefined ? null : JSON.stringify(input.body), { status: input.status })
      },
      sleep: async () => undefined,
      timeoutSignal: () => new AbortController().signal,
    },
  )
  const routed = createOverlayFreeLanguageModel({
    ...deps,
    confirmOpenRouterGenerationCost,
    providers: {
      gateway: async () => model('gateway', async () => openRouterReceipt(), request =>
        abortableStream(request, true, undefined, undefined, input.generationId)),
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), request => {
        if (!input.failAfterOutput) return abortableStream(request, true, undefined, undefined, input.generationId)
        let emitted = false
        return new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({
              type: 'response-metadata',
              id: input.generationId,
              modelId: 'openrouter/free',
              headers: {},
            })
          },
          pull(controller) {
            if (!emitted) {
              emitted = true
              controller.enqueue({ type: 'text-delta', id: 'interrupt-text', delta: 'partial' })
            } else {
              controller.error(new Error('upstream stream interrupted'))
            }
          },
        })
      }),
    },
  })
  return { routed, requests: () => requests, settlements, calls }
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

function gatewayReceiptWithContent(
  modelId: string,
  provider: string,
  content: LanguageModelV4GenerateResult['content'],
) {
  return { ...gatewayReceipt(modelId, provider), content }
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

for (const method of ['doStream', 'doGenerate'] as const) {
  test(`${method} identifies busy capacity only when no provider inference was attempted`, async () => {
    const calls: string[] = []
    const routes = [route('gateway', 'provider/model', 'provider'), route('openrouter', 'openrouter/free', 'openrouter')]
    let firstRouteBusy = true
    const deps = dependencies(routes, calls, { claim: async (key, token) => firstRouteBusy || key.startsWith('openrouter:')
      ? { status: 'busy', route: null }
      : { status: 'claimed', route: { ...routes[0], activeLeaseToken: token } } })
    const dispatch = async () => { calls.push('inference'); throw new Error('ambiguous timeout') }
    const languageModel = createOverlayFreeLanguageModel({ ...deps, providers: {
      gateway: async () => ({ ...model('provider', dispatch), doStream: dispatch }),
      openrouter: async () => { throw new Error('busy route must not dispatch') },
    } })
    await assert.rejects(languageModel[method](options()), OverlayFreeRouteBusyError)
    assert.deepEqual(calls, [])
    firstRouteBusy = false
    await assert.rejects(languageModel[method](options()), error => {
      assert.ok(error instanceof Error)
      assert.ok(!(error instanceof OverlayFreeRouteBusyError))
      return true
    })
    assert.deepEqual(calls, ['inference', `settle:${routes[0].routeKey}:false`])
  })
}

for (const method of ['doStream', 'doGenerate'] as const) {
  test(`${method} treats a listed cooled route as busy capacity`, async () => {
    const calls: string[] = []
    const routes = [{ ...route('openrouter', 'openrouter/free', 'openrouter'), cooldownUntil: now + 60_000 }]
    const deps = dependencies(routes, calls, {
      claim: async () => ({ status: 'cooldown', route: null }),
    })
    const languageModel = createOverlayFreeLanguageModel({
      ...deps,
      providers: {
        gateway: async () => { throw new Error('unexpected Gateway call') },
        openrouter: async () => { throw new Error('cooled route must not dispatch') },
      },
    })
    await assert.rejects(languageModel[method](options()), OverlayFreeRouteBusyError)
    assert.deepEqual(calls, [])
  })
}

for (const method of ['doStream', 'doGenerate'] as const) {
  test(`${method} classifies a pre-response 429 as busy capacity and cools the route`, async () => {
    const calls: string[] = []
    const routes = [route('openrouter', 'openrouter/free', 'openrouter')]
    const rateLimit = Object.assign(new Error('upstream 429'), { statusCode: 429 })
    const deps = dependencies(routes, calls)
    const languageModel = createOverlayFreeLanguageModel({
      ...deps,
      providers: {
        gateway: async () => { throw new Error('unexpected Gateway call') },
        openrouter: async () => model('openrouter', async () => { throw rateLimit }, () => { throw rateLimit }),
      },
    })
    await assert.rejects(languageModel[method](options()), OverlayFreeRouteBusyError)
    assert.deepEqual(calls, [`cooldown:${routes[0]!.routeKey}`])
  })
}

for (const method of ['doStream', 'doGenerate'] as const) {
  test(`${method} preserves a post-generation 500 and settles a missing receipt`, async () => {
    const calls: string[] = []
    const routes = [route('openrouter', 'openrouter/free', 'openrouter')]
    const upstreamFailure = new Error('upstream 500')
    const deps = dependencies(routes, calls)
    const languageModel = createOverlayFreeLanguageModel({
      ...deps,
      providers: {
        gateway: async () => { throw new Error('unexpected Gateway call') },
        openrouter: async () => method === 'doGenerate'
          ? model('openrouter', async () => { throw upstreamFailure })
          : model('openrouter', async () => openRouterReceipt(), () => new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'error', error: upstreamFailure })
              controller.close()
            },
          })),
      },
    })
    if (method === 'doGenerate') {
      await assert.rejects(languageModel.doGenerate(options()), /upstream 500/)
    } else {
      const response = await languageModel.doStream(options())
      await assert.rejects(response.stream.getReader().read(), /upstream 500/)
    }
    assert.deepEqual(calls, [`settle:${routes[0]!.routeKey}:false`])
  })
}

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

test('fails over after a safe empty gateway completion', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('gateway', 'second/model', 'second'),
  ]
  const calls: string[] = []
  const languageModel = createOverlayFreeLanguageModel({
    ...dependencies(routes, calls),
    providers: {
      gateway: async (modelId, provider) => model(provider, async () => {
        calls.push(`generate:${provider}`)
        return provider === 'first'
          ? gatewayReceiptWithContent(modelId, provider, [])
          : gatewayReceiptWithContent(modelId, provider, [{ type: 'text', text: 'Ocean Tides' }])
      }),
      openrouter: async () => { throw new Error('unexpected OpenRouter call') },
    },
    now: () => now,
  })

  const result = await languageModel.doGenerate(options())

  assert.deepEqual(result.content, [{ type: 'text', text: 'Ocean Tides' }])
  assert.ok(calls.includes('generate:second'))
  assert.ok(calls.includes('settle:gateway:first/model:first:true'))
  assert.ok(calls.includes('settle:gateway:second/model:second:true'))
})

test('fails over after reasoning-only content', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('gateway', 'second/model', 'second'),
  ]
  const calls: string[] = []
  const languageModel = createOverlayFreeLanguageModel({
    ...dependencies(routes, calls),
    providers: {
      gateway: async (modelId, provider) => model(provider, async () => {
        calls.push(`generate:${provider}`)
        return provider === 'first'
          ? gatewayReceiptWithContent(modelId, provider, [{ type: 'reasoning', text: 'working it out' }])
          : gatewayReceiptWithContent(modelId, provider, [{ type: 'text', text: 'Ocean Tides' }])
      }),
      openrouter: async () => { throw new Error('unexpected OpenRouter call') },
    },
    now: () => now,
  })

  const result = await languageModel.doGenerate(options())

  assert.deepEqual(result.content, [{ type: 'text', text: 'Ocean Tides' }])
  assert.ok(calls.includes('generate:second'))
})

test('returns the last safe empty completion after trying every candidate', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('gateway', 'second/model', 'second'),
  ]
  const calls: string[] = []
  const languageModel = createOverlayFreeLanguageModel({
    ...dependencies(routes, calls),
    providers: {
      gateway: async (modelId, provider) => model(provider, async () => {
        calls.push(`generate:${provider}`)
        return provider === 'first'
          ? gatewayReceiptWithContent(modelId, provider, [])
          : gatewayReceiptWithContent(modelId, provider, [{ type: 'reasoning', text: 'last empty result' }])
      }),
      openrouter: async () => { throw new Error('unexpected OpenRouter call') },
    },
    now: () => now,
  })

  const result = await languageModel.doGenerate(options())

  assert.deepEqual(result.content, [{ type: 'reasoning', text: 'last empty result' }])
  assert.ok(calls.includes('generate:first'))
  assert.ok(calls.includes('generate:second'))
  assert.ok(calls.includes('settle:gateway:first/model:first:true'))
  assert.ok(calls.includes('settle:gateway:second/model:second:true'))
})

test('returns an empty completion from the only candidate without waiting for capacity', async () => {
  const candidate = route('gateway', 'only/model', 'only')
  const calls: string[] = []
  const languageModel = createOverlayFreeLanguageModel({
    ...dependencies([candidate], calls),
    providers: {
      gateway: async (modelId, provider) => model(provider, async () => {
        calls.push('generate:only')
        return gatewayReceiptWithContent(modelId, provider, [])
      }),
      openrouter: async () => { throw new Error('unexpected OpenRouter call') },
    },
    now: () => now,
  })

  const result = await languageModel.doGenerate(options())

  assert.deepEqual(result.content, [])
  assert.deepEqual(calls, [
    'generate:only',
    'settle:gateway:only/model:only:true',
  ])
})

test('does not fail over after a tool-call-only completion', async () => {
  const routes = [
    route('gateway', 'first/model', 'first'),
    route('gateway', 'second/model', 'second'),
  ]
  const calls: string[] = []
  const languageModel = createOverlayFreeLanguageModel({
    ...dependencies(routes, calls),
    providers: {
      gateway: async (modelId, provider) => model(provider, async () => {
        calls.push(`generate:${provider}`)
        return gatewayReceiptWithContent(modelId, provider, [{
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'lookup',
          input: '{}',
        }])
      }),
      openrouter: async () => { throw new Error('unexpected OpenRouter call') },
    },
    now: () => now,
  })

  const result = await languageModel.doGenerate(options())

  assert.equal(result.content[0]?.type, 'tool-call')
  assert.deepEqual(calls, [
    'generate:first',
    'settle:gateway:first/model:first:true',
  ])
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

test('streams long OpenRouter Free replies with repeated response metadata', async () => {
  const routes = [route('openrouter', 'openrouter/free', 'openrouter')]
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
      gateway: async () => { throw new Error('unexpected Gateway call') },
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), () =>
        new ReadableStream<LanguageModelV4StreamPart>({ start(controller) {
          for (let index = 0; index < 1_000; index += 1) {
            controller.enqueue({ type: 'response-metadata', id: 'response-id' })
            controller.enqueue({ type: 'response-metadata', modelId: 'openrouter/free' })
            controller.enqueue({ type: 'text-delta', id: 'text', delta: 'x' })
          }
          controller.enqueue(finish)
          controller.close()
        } })),
    },
    now: () => now,
  })
  const result = await languageModel.doStream(options())
  const reader = result.stream.getReader()
  let text = ''
  while (true) {
    const next = await reader.read()
    if (next.done) break
    if (next.value.type === 'text-delta') text += next.value.delta
  }

  assert.equal(text, 'x'.repeat(1_000))
  assert.deepEqual(calls, ['settle:openrouter:openrouter/free:openrouter:true'])
})

test('deduplicates repeated response metadata before semantic output', async () => {
  const routes = [route('openrouter', 'openrouter/free', 'openrouter')]
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
      gateway: async () => { throw new Error('unexpected Gateway call') },
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), () =>
        new ReadableStream<LanguageModelV4StreamPart>({ start(controller) {
          for (let index = 0; index < 40; index += 1) {
            controller.enqueue({ type: 'response-metadata', id: 'response-id' })
            controller.enqueue({ type: 'response-metadata', modelId: 'openrouter/free' })
          }
          controller.enqueue({ type: 'text-delta', id: 'text', delta: 'ok' })
          controller.enqueue(finish)
          controller.close()
        } })),
    },
    now: () => now,
  })
  const result = await languageModel.doStream(options())
  const reader = result.stream.getReader()
  let text = ''
  while (true) {
    const next = await reader.read()
    if (next.done) break
    if (next.value.type === 'text-delta') text += next.value.delta
  }

  assert.equal(text, 'ok')
  assert.deepEqual(calls, ['settle:openrouter:openrouter/free:openrouter:true'])
})

test('keeps the prelude part limit for distinct response metadata', async () => {
  const routes = [route('openrouter', 'openrouter/free', 'openrouter')]
  const calls: string[] = []
  const deps = dependencies(routes, calls)
  const languageModel = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => { throw new Error('unexpected Gateway call') },
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), () =>
        new ReadableStream<LanguageModelV4StreamPart>({ start(controller) {
          for (let index = 0; index < 33; index += 1) {
            controller.enqueue({ type: 'response-metadata', id: `response-${index}` })
          }
          controller.close()
        } })),
    },
    now: () => now,
  })
  const result = await languageModel.doStream(options())
  const reader = result.stream.getReader()

  await assert.rejects(async () => {
    while (true) {
      const next = await reader.read()
      if (next.done) break
    }
  }, /overlay_free_stream_prelude_too_large/)
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

test('stream preflight catalog failures remain no-eligible-route', async () => {
  const calls: string[] = []
  const routed = createOverlayFreeLanguageModel({
    ...dependencies([route('gateway', 'first/model', 'first')], calls),
    preflight: async () => { throw new Error('catalog unavailable') },
    providers: {
      gateway: async () => { throw new Error('must not call') },
      openrouter: async () => { throw new Error('must not call') },
    },
  })
  await assert.rejects(routed.doStream(options()), /overlay_free_no_eligible_route/)
  assert.deepEqual(calls, ['cooldown:gateway:first/model:first'])
})

test('steady output can run beyond the first-output timeout and settles safely', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const calls: string[] = []
  const routed = createOverlayFreeLanguageModel({
    ...dependencies([route('openrouter', 'openrouter/free', 'openrouter')], calls),
    providers: {
      gateway: async () => { throw new Error('unexpected Gateway call') },
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), (request) =>
        abortableStream(request, true, 20_000, 3)),
    },
  })
  const response = await routed.doStream(options())
  const reader = response.stream.getReader()

  assert.equal((await reader.read()).value?.type, 'text-delta')
  for (let index = 0; index < 4; index += 1) {
    const next = await readAfterTimer(reader, 20_000, (milliseconds) => t.mock.timers.tick(milliseconds))
    assert.equal(next.value?.type, index === 3 ? 'finish' : 'text-delta')
  }
  assert.equal((await reader.read()).done, true)
  assert.ok(4 * 20_000 > FREE_ROUTE_TIMEOUT_MS)
  assert.deepEqual(calls, ['settle:openrouter:openrouter/free:openrouter:true'])
})

test('silence after semantic output aborts at the idle timeout and settles unsafe', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const calls: string[] = []
  const routed = createOverlayFreeLanguageModel({
    ...dependencies([route('openrouter', 'openrouter/free', 'openrouter')], calls),
    providers: {
      gateway: async () => { throw new Error('unexpected Gateway call') },
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), (request) =>
        abortableStream(request, true)),
    },
  })
  const response = await routed.doStream(options())
  const reader = response.stream.getReader()

  assert.equal((await reader.read()).value?.type, 'text-delta')
  await assert.rejects(readAfterTimer(
    reader,
    FREE_ROUTE_IDLE_TIMEOUT_MS,
    (milliseconds) => t.mock.timers.tick(milliseconds),
  ))
  assert.deepEqual(calls, ['settle:openrouter:openrouter/free:openrouter:false'])
})

test('no semantic output before the first-output timeout aborts and settles a missing receipt', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const calls: string[] = []
  const routed = createOverlayFreeLanguageModel({
    ...dependencies([route('openrouter', 'openrouter/free', 'openrouter')], calls),
    providers: {
      gateway: async () => { throw new Error('unexpected Gateway call') },
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), (request) =>
        abortableStream(request, false)),
    },
  })
  const response = await routed.doStream(options())
  const reader = response.stream.getReader()
  const pending = reader.read()
  await Promise.resolve()
  await Promise.resolve()

  await assert.rejects(async () => {
    t.mock.timers.tick(FREE_ROUTE_TIMEOUT_MS)
    await pending
  })
  assert.deepEqual(calls, ['settle:openrouter:openrouter/free:openrouter:false'])
})

test('the absolute lease cap aborts a never-ending steady stream before lease expiry', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const calls: string[] = []
  const deps = dependencies([route('openrouter', 'openrouter/free', 'openrouter')], calls)
  const claim = deps.repository.claim
  let leaseExpiresAt = 0
  deps.repository.claim = async (routeKey, leaseToken, generation, purpose) => {
    const claimed = await claim(routeKey, leaseToken, generation, purpose)
    leaseExpiresAt = Date.now() + FREE_ROUTE_LEASE_MS
    return {
      ...claimed,
      route: claimed.route ? { ...claimed.route, activeLeaseExpiresAt: leaseExpiresAt } : null,
    }
  }
  const routed = createOverlayFreeLanguageModel({
    ...deps,
    providers: {
      gateway: async () => { throw new Error('unexpected Gateway call') },
      openrouter: async () => model('openrouter', async () => openRouterReceipt(), (request) =>
        abortableStream(request, true, 10_000)),
    },
  })
  const response = await routed.doStream(options())
  const reader = response.stream.getReader()

  assert.equal((await reader.read()).value?.type, 'text-delta')
  for (let index = 0; index < 16; index += 1) {
    assert.equal((await readAfterTimer(reader, 10_000, (milliseconds) =>
      t.mock.timers.tick(milliseconds))).value?.type, 'text-delta')
  }
  await assert.rejects(readAfterTimer(reader, 5_000, (milliseconds) =>
    t.mock.timers.tick(milliseconds)))
  assert.ok(Date.now() < leaseExpiresAt)
  assert.deepEqual(calls, ['settle:openrouter:openrouter/free:openrouter:false'])
})

test('a confirmed zero-cost interruption settles safely and the idle timer remains 90 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const body = {
    data: { id: 'gen-confirmed', total_cost: 0, is_byok: false, upstream_inference_cost: null },
  }
  const setup = interruptionSetup({ generationId: 'gen-confirmed', status: 200, body })
  const response = await setup.routed.doStream(options())
  const reader = response.stream.getReader()
  let part: ReadableStreamReadResult<LanguageModelV4StreamPart>
  do {
    part = await reader.read()
  } while (!part.done && part.value?.type !== 'text-delta')

  const interrupted = reader.read()
  await Promise.resolve()
  await Promise.resolve()
  t.mock.timers.tick(30_000)
  await Promise.resolve()
  assert.equal(setup.requests(), 0)
  t.mock.timers.tick(60_000)
  await assert.rejects(interrupted, OverlayFreeRouteInterruptedError)

  assert.equal(setup.requests(), 1)
  assert.equal(setup.settlements.length, 1)
  assert.equal(setup.settlements[0]?.safe, true)
  assert.equal(setup.settlements[0]?.cost, 0)
  assert.equal(setup.settlements[0]?.reason, 'interrupted after output; zero cost confirmed')
  assert.deepEqual(setup.settlements[0]?.receipt, {
    safe: true, cost: 0, reason: 'interrupted after output; zero cost confirmed',
  })
})

test('skips cost confirmation when the bounded lookup cannot fit before the lease margin', async () => {
  const setup = interruptionSetup({
    generationId: 'gen-short-lease',
    status: 200,
    body: { data: { id: 'gen-short-lease', total_cost: 0, is_byok: false, upstream_inference_cost: 0 } },
    leaseDurationMs: 45_000,
    failAfterOutput: true,
  })
  const reader = (await setup.routed.doStream(options())).stream.getReader()
  let part: ReadableStreamReadResult<LanguageModelV4StreamPart>
  do {
    part = await reader.read()
  } while (!part.done && part.value?.type !== 'text-delta')
  await assert.rejects(reader.read())

  assert.equal(setup.requests(), 0)
  assert.equal(setup.settlements[0]?.safe, false)
  assert.equal(setup.settlements[0]?.reason, 'stream interrupted after output')
})

const invalidGenerationCases = [
  {
    name: '404 on every poll',
    status: 404,
    expectedRequests: 6,
    body: undefined,
  },
  {
    name: 'positive total cost',
    status: 200,
    expectedRequests: 1,
    body: { data: { id: 'gen-case', total_cost: 0.01, is_byok: false, upstream_inference_cost: 0 } },
  },
  {
    name: 'BYOK generation',
    status: 200,
    expectedRequests: 1,
    body: { data: { id: 'gen-case', total_cost: 0, is_byok: true, upstream_inference_cost: 0 } },
  },
  {
    name: 'generation ID mismatch',
    status: 200,
    expectedRequests: 1,
    body: { data: { id: 'gen-other', total_cost: 0, is_byok: false, upstream_inference_cost: 0 } },
  },
  {
    name: 'nonzero upstream inference cost',
    status: 200,
    expectedRequests: 1,
    body: { data: { id: 'gen-case', total_cost: 0, is_byok: false, upstream_inference_cost: 0.01 } },
  },
] as const

for (const scenario of invalidGenerationCases) {
  test(`unconfirmed ${scenario.name} retains unsafe settlement and quarantine reason`, async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const setup = interruptionSetup({
      generationId: 'gen-case',
      status: scenario.status,
      body: scenario.body,
    })
    const reader = (await setup.routed.doStream(options())).stream.getReader()
    let part: ReadableStreamReadResult<LanguageModelV4StreamPart>
    do {
      part = await reader.read()
    } while (!part.done && part.value?.type !== 'text-delta')
    const interrupted = reader.read()
    await Promise.resolve()
    await Promise.resolve()
    t.mock.timers.tick(FREE_ROUTE_IDLE_TIMEOUT_MS)
    await assert.rejects(interrupted)

    assert.equal(setup.requests(), scenario.expectedRequests)
    assert.equal(setup.settlements.length, 1)
    assert.equal(setup.settlements[0]?.safe, false)
    assert.equal(setup.settlements[0]?.reason, 'stream interrupted after output')
  })
}

test('missing IDs, nonzero pricing and non-OpenRouter routes skip cost lookup', async t => {
  const candidates = [
    {
      name: 'missing generation ID',
      candidate: route('openrouter', 'openrouter/free', 'openrouter'),
      generationId: undefined,
    },
    {
      name: 'nonzero route pricing',
      candidate: {
        ...route('openrouter', 'openrouter/free', 'openrouter'),
        pricingJson: JSON.stringify({ prompt: '0.01', completion: '0' }),
      },
      generationId: 'gen-route-pricing',
    },
    {
      name: 'non-OpenRouter transport',
      candidate: route('gateway', 'provider/free', 'provider'),
      generationId: 'gen-gateway',
    },
  ] as const

  for (const scenario of candidates) {
    await t.test(scenario.name, async t => {
      t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
      const setup = interruptionSetup({
        candidate: scenario.candidate,
        generationId: scenario.generationId,
        status: 200,
        body: { data: { id: scenario.generationId, total_cost: 0, is_byok: false, upstream_inference_cost: 0 } },
      })
      const reader = (await setup.routed.doStream(options())).stream.getReader()
      let part: ReadableStreamReadResult<LanguageModelV4StreamPart>
      do {
        part = await reader.read()
      } while (!part.done && part.value?.type !== 'text-delta')
      const interrupted = reader.read()
      await Promise.resolve()
      await Promise.resolve()
      t.mock.timers.tick(FREE_ROUTE_IDLE_TIMEOUT_MS)
      await assert.rejects(interrupted)

      assert.equal(setup.requests(), 0)
      assert.equal(setup.settlements[0]?.safe, false)
      assert.equal(setup.settlements[0]?.reason, 'stream interrupted after output')
    })
  }
})

test('caller aborts after output never query OpenRouter generation cost', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const setup = interruptionSetup({
    generationId: 'gen-caller-abort',
    status: 200,
    body: { data: { id: 'gen-caller-abort', total_cost: 0, is_byok: false, upstream_inference_cost: 0 } },
  })
  const abort = new AbortController()
  const reader = (await setup.routed.doStream({ ...options(), abortSignal: abort.signal })).stream.getReader()
  let part: ReadableStreamReadResult<LanguageModelV4StreamPart>
  do {
    part = await reader.read()
  } while (!part.done && part.value?.type !== 'text-delta')
  const interrupted = reader.read()
  await Promise.resolve()
  abort.abort(new Error('caller stopped'))
  await assert.rejects(interrupted)
  assert.equal(setup.requests(), 0)
  assert.equal(setup.settlements[0]?.safe, false)
  assert.equal(setup.settlements[0]?.reason, 'stream interrupted after output')
})
