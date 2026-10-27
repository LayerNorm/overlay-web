import { beforeEach, expect, test, vi } from 'vitest'
import { MockLanguageModelV3, MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde'
import { getLanguageModel } from '@/server/ai/model-runtime'
import { generateHarnessModel, HarnessLanguageModel, streamHarnessModel } from './secure-model'
import { authorizePersonalHarnessModelDispatch, type PersonalHarnessModelDispatch } from './personal-model-dispatch'

vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: vi.fn() }))
vi.mock('./personal-model-dispatch', () => ({ authorizePersonalHarnessModelDispatch: vi.fn() }))

const reference = {
  modelId: 'fixture/model',
  credentialOwnerId: 'fixture-user',
  sessionId: 'fixture-session',
  allowLowBalanceFallback: false,
}
const options: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }],
  providerOptions: { fixture: { route: 'private' } },
}
const result: LanguageModelV4GenerateResult = {
  content: [{ type: 'text', text: 'complete' }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 10, noCache: 2, cacheRead: 8, cacheWrite: 0 },
    outputTokens: { total: 2, text: 2, reasoning: 0 },
  },
  warnings: [],
}

beforeEach(() => { vi.mocked(getLanguageModel).mockReset(); vi.mocked(authorizePersonalHarnessModelDispatch).mockReset() })

const personal: PersonalHarnessModelDispatch = {
  access: { actorUserId: 'fixture-user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation',
    workspaceId: 'workspace', principalId: 'principal', agentRunId: 'delivery', authentication: { type: 'api-key', apiKeyId: 'key-reference' } },
  receiptId: 'model:0', memoryEnabled: true, requestFingerprint: 'fingerprint', inputTokenBudget: 10_000,
  maxOutputTokens: 100, contextWindow: 100_000,
}

test('personal dispatch serializes only references, and reauthorizes before resolving provider credentials', async () => {
  const guarded = new HarnessLanguageModel({ ...reference, personal: { ...personal,
    access: { ...personal.access, accessToken: 'fixture-secret', authentication: { ...personal.access.authentication, rawKey: 'fixture-secret' } },
  } } as typeof reference & { personal: PersonalHarnessModelDispatch })
  const serialized = HarnessLanguageModel[WORKFLOW_SERIALIZE](guarded)
  expect(serialized.personal).toEqual(personal)
  expect(JSON.stringify(serialized)).not.toContain('fixture-secret')
  vi.mocked(authorizePersonalHarnessModelDispatch).mockRejectedValueOnce(new Error('revoked'))
  await expect(guarded.doGenerate(options)).rejects.toThrow('revoked')
  expect(getLanguageModel).not.toHaveBeenCalled()
  vi.mocked(getLanguageModel).mockResolvedValue(new MockLanguageModelV4({ doGenerate: result }))
  await guarded.doGenerate(options)
  expect(authorizePersonalHarnessModelDispatch).toHaveBeenCalledTimes(2)
  expect(streamHarnessModel).toHaveProperty('maxRetries', 0)
  expect(generateHarnessModel).toHaveProperty('maxRetries', 0)
})

test('serialization contains references only and does not resolve credentials', () => {
  const model = new HarnessLanguageModel({ ...reference, apiKey: 'fixture-secret' } as typeof reference)
  Object.assign(model, { credential: 'another-fixture-secret' })
  const serialized = HarnessLanguageModel[WORKFLOW_SERIALIZE](model)
  expect(serialized).toEqual(reference)
  expect(JSON.stringify(serialized)).not.toContain('secret')
  const restored = HarnessLanguageModel[WORKFLOW_DESERIALIZE](serialized)
  expect(restored.modelId).toBe(reference.modelId)
  expect(getLanguageModel).not.toHaveBeenCalled()
})

test('resolves credentials anew on execution and preserves v4 calls, streaming and usage', async () => {
  const stream = new ReadableStream({ start(controller) { controller.close() } })
  const first = new MockLanguageModelV4({ doGenerate: result })
  const second = new MockLanguageModelV4({ doStream: { stream } })
  vi.mocked(getLanguageModel).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  const restored = HarnessLanguageModel[WORKFLOW_DESERIALIZE](reference)
  expect(await restored.doGenerate(options)).toBe(result)
  expect((await restored.doStream(options)).stream).toBe(stream)
  expect(first.doGenerateCalls).toEqual([options])
  expect(second.doStreamCalls).toEqual([options])
  expect(getLanguageModel).toHaveBeenCalledTimes(2)
  expect(getLanguageModel).toHaveBeenNthCalledWith(2, reference.modelId, undefined, reference.credentialOwnerId, {
    sessionId: reference.sessionId, allowLowBalanceFallback: false,
  })
})

test('uses the SDK compatibility adapter for existing v3 providers', async () => {
  const provider = new MockLanguageModelV3({ doGenerate: result })
  vi.mocked(getLanguageModel).mockResolvedValue(provider)
  const model = new HarnessLanguageModel(reference)
  expect(await model.doGenerate(options)).toBe(result)
  expect(provider.doGenerateCalls).toEqual([options])
})

test('revoked provider credentials fail without returning a cached model', async () => {
  vi.mocked(getLanguageModel).mockRejectedValue(new Error('BYOK connection not found.'))
  const restored = HarnessLanguageModel[WORKFLOW_DESERIALIZE](reference)
  await expect(restored.doGenerate(options)).rejects.toThrow('BYOK connection not found.')
  expect(getLanguageModel).toHaveBeenCalledTimes(1)
})
