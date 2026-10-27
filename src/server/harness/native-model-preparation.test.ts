import { beforeEach, expect, test, vi } from 'vitest'
import { prepareNativeHarnessModel } from './native-model-preparation'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), catalog: vi.fn(), zdr: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('./personal-access', () => ({ refreshPersonalHarnessAccess: vi.fn() }))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalogModel: mocks.catalog }))
vi.mock('@/shared/ai/gateway/model-data', () => ({ modelSupportsZeroDataRetention: mocks.zdr }))

const access = { actorUserId: 'user', runId: 'workspace:delivery', workflowRunId: 'workflow',
  workspaceId: 'workspace', principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal',
  conversationId: 'room', agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' }
const context = { modelId: 'fixture/model', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'request' }
const input = { access, context, receiptId: 'model:0', options: {
  prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Read the report.' }] }], maxOutputTokens: 100,
} }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refresh.mockResolvedValue({ requiresZeroDataRetention: true, entitlements: { confidential: 'must-not-persist' } })
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 32_000, maxTokens: 1_000,
    pricing: { input: '0.000001', output: '0.000002' } })
})

test('prepares native authority without credentials and quotes the exact ZDR-routed prompt', async () => {
  const prepared = await prepareNativeHarnessModel({ ...input, access: { ...access, accessToken: 'must-not-persist' } as typeof access })
  expect(prepared.model).toMatchObject({ modelId: context.modelId, credentialOwnerId: 'user', allowLowBalanceFallback: false,
    native: { access, receiptId: 'model:0', memoryEnabled: true, sharedRoom: true, maxOutputTokens: 100, contextWindow: 32_000 } })
  expect(prepared.model).not.toHaveProperty('personal')
  expect(JSON.stringify(prepared)).not.toContain('must-not-persist')
  expect(prepared.options.providerOptions).toEqual({ gateway: { zeroDataRetention: true } })
  expect(prepared.estimatedCostMicros).toBeGreaterThan(0)
  expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.catalog.mock.invocationCallOrder[0])
})

test('revocation precedes pricing and native calls reuse the shared capacity and fallback safeguards', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('Agent revoked'))
  await expect(prepareNativeHarnessModel(input)).rejects.toThrow(/revoked/)
  expect(mocks.catalog).not.toHaveBeenCalled()
  await expect(prepareNativeHarnessModel({ ...input, options: { ...input.options, maxOutputTokens: 1_001 } })).rejects.toThrow(/capacity/)
  await expect(prepareNativeHarnessModel({ ...input, options: { ...input.options,
    providerOptions: { gateway: { models: ['other/model'] } },
  } })).rejects.toThrow(/fallback/)
})
