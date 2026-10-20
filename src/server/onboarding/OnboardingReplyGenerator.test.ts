import assert from 'node:assert/strict'
import test from 'node:test'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { preparedOnboardingReply } from '@/shared/onboarding/session'
import { createOnboardingReplyGenerator } from './OnboardingReplyGenerator'

const profile = { name: 'Dev', about: 'Engineer', daily: 'Review changes' }

function fixture(options: { zdr?: boolean; denied?: boolean; disabled?: boolean; unsafe?: boolean; missingReceipt?: boolean; unavailable?: boolean; invalid?: boolean } = {}) {
  const calls: string[] = []
  const model: LanguageModelV4 = {
    specificationVersion: 'v4', provider: 'overlay-free', modelId: 'overlay-free', supportedUrls: {},
    async doGenerate(request) {
      calls.push('generate')
      assert.equal(request.responseFormat?.type, 'json')
      if (options.unavailable) throw new Error('No eligible routes')
      return {
        content: [{ type: 'text', text: JSON.stringify(options.invalid ? { unexpected: true } : { message: 'Hi Dev. What are you working on?' }) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
        response: { id: 'reply', modelId: 'another-provider/free-model', timestamp: new Date() },
        providerMetadata: options.missingReceipt ? {} : { overlayFree: { safe: !options.unsafe, cost: options.unsafe ? 0.01 : 0 } },
        warnings: [],
      }
    },
    async doStream() { throw new Error('Not used') },
  }
  const policy = {
    getEntitlements: async () => ({}),
    reserve: async (args: { modelId: string; providerCostUsd: number }) => {
      assert.equal(args.modelId, 'overlay-free')
      assert.equal(args.providerCostUsd, 0)
      calls.push('reserve')
      return { ok: true, reservationId: 'reservation' }
    },
    markStarted: async () => { calls.push('started') },
    finalize: async () => { calls.push('finalize') },
    release: async () => { calls.push('release') },
  }
  type Dependencies = NonNullable<Parameters<typeof createOnboardingReplyGenerator>[1]>
  const reply = createOnboardingReplyGenerator({
    auth: { userId: 'user' }, workspace: { workspace: { id: 'workspace' } },
    capabilities: { chat: true }, requestFingerprint: 'request',
  } as AppApiRouteContext, {
    disabled: () => options.disabled === true,
    settings: async () => ({ onlyAllowZdrModels: options.zdr }) as never,
    server: (() => ({ generationUsagePolicy: policy })) as Dependencies['server'],
    authorize: async () => ({ chat: new Set(options.denied ? [] : ['overlay-free']), image: new Set<string>(), video: new Set<string>() }),
    model: async (modelId) => {
      assert.equal(modelId, 'overlay-free')
      calls.push('resolve')
      return model
    },
  })
  return { reply, calls }
}

test('shared router output from any provider personalizes onboarding through the real SDK', async () => {
  const { reply, calls } = fixture()
  const result = await reply('about', profile, true, {})
  assert.equal(result.mode, 'live')
  assert.equal(result.message, 'Hi Dev. What are you working on?')
  assert.deepEqual(calls, ['resolve', 'reserve', 'started', 'generate', 'finalize'])
})

test('consent, hosted access, model authorization, and ZDR gate generation', async () => {
  for (const options of [{}, { disabled: true }, { denied: true }, { zdr: true }]) {
    const { reply, calls } = fixture(options)
    assert.deepEqual(await reply('about', profile, Object.keys(options).length > 0, {}), preparedOnboardingReply('about', profile))
    assert.deepEqual(calls, [])
  }
})

test('unsafe or missing receipts, unavailable routing, and invalid JSON use prepared replies', async () => {
  for (const options of [{ unsafe: true }, { missingReceipt: true }, { unavailable: true }, { invalid: true }]) {
    const { reply, calls } = fixture(options)
    assert.deepEqual(await reply('about', profile, true, {}), preparedOnboardingReply('about', profile))
    assert.equal(calls.filter((call) => call === 'generate').length, 1)
    if (!options.invalid) {
      assert.equal(calls.includes('finalize'), false)
      assert.equal(calls.includes('release'), true)
    }
  }
})
