import { beforeEach, expect, test, vi } from 'vitest'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { preparePersonalHarnessModel } from './model-preparation'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), catalog: vi.fn(), zdr: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./personal-access', () => ({ refreshPersonalHarnessAccess: mocks.refresh }))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalogModel: mocks.catalog }))
vi.mock('@/shared/ai/gateway/model-data', () => ({ modelSupportsZeroDataRetention: mocks.zdr }))

const access = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
  workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' as const } }
const context: Omit<PersonalChatWorkToolingContext, 'entitlements' | 'paid'> = {
  userId: 'user', workspaceId: 'workspace', conversationId: 'conversation', effectiveModelId: 'fixture/model',
  baseUrl: 'https://example.test', memoryEnabled: true, requestedToolIds: [], turnId: 'turn', requestFingerprint: 'request',
}
const input = { access, context, receiptId: 'model:0', options: {
  prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Read the document.' }] }], maxOutputTokens: 100,
} }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.zdr.mockReturnValue(false)
  mocks.refresh.mockImplementation(async (_access, supplied) => ({ ...supplied, entitlements: { confidential: 'must-not-persist' } }))
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 32_000, maxTokens: 1_000,
    pricing: { input: '0.000001', output: '0.000002' } })
})

test('quotes the complete prompt and constructs a credential-free dispatch reference with explicit limits', async () => {
  const prepared = await preparePersonalHarnessModel({ ...input, access: { ...access, accessToken: 'must-not-persist' } as typeof access })
  expect(prepared.model).toMatchObject({ modelId: 'fixture/model', credentialOwnerId: 'user', allowLowBalanceFallback: false,
    personal: { receiptId: 'model:0', contextWindow: 32_000, maxOutputTokens: 100, memoryEnabled: true } })
  expect(prepared.model.personal!.inputTokenBudget).toBeGreaterThan(1_024)
  expect(prepared.estimatedCostMicros).toBeGreaterThan(1_224)
  expect(JSON.stringify(prepared)).not.toContain('must-not-persist')
  expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.catalog.mock.invocationCallOrder[0])
})

test('enforces fresh ZDR routing without losing other provider settings', async () => {
  mocks.refresh.mockResolvedValue({ ...context, requiresZeroDataRetention: true })
  const prepared = await preparePersonalHarnessModel({ ...input, options: { ...input.options, providerOptions: {
    gateway: { zeroDataRetention: false, order: ['fixture-provider'] }, anthropic: { thinking: { type: 'disabled' } },
  } } })
  expect(prepared.options.providerOptions).toEqual({ gateway: { zeroDataRetention: true, order: ['fixture-provider'] },
    anthropic: { thinking: { type: 'disabled' } } })
})

test('forces ZDR for each supported active candidate even when account policy does not require it', async () => {
  mocks.zdr.mockReturnValue(true)
  mocks.refresh.mockResolvedValue({ ...context, requiresZeroDataRetention: false })
  const prepared = await preparePersonalHarnessModel(input)
  expect(prepared.options.providerOptions).toEqual({ gateway: { zeroDataRetention: true } })
})

test('rejects unauthenticated, unsupported, unpriced and oversized dispatches before admission', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('Access revoked'))
  await expect(preparePersonalHarnessModel(input)).rejects.toThrow(/revoked/)
  expect(mocks.catalog).not.toHaveBeenCalled()
  await expect(preparePersonalHarnessModel({ ...input, options: { ...input.options, maxOutputTokens: 1_001 } })).rejects.toThrow(/capacity/)
  await expect(preparePersonalHarnessModel({ ...input, options: { ...input.options, providerOptions: { gateway: { models: ['unapproved'] } } } })).rejects.toThrow(/fallback/)
  mocks.catalog.mockResolvedValue(null)
  await expect(preparePersonalHarnessModel(input)).rejects.toThrow(/pricing/)
})

test('unknown BYOK context stays unknown, and media is refused without a known bound', async () => {
  mocks.catalog.mockResolvedValue(null)
  const external = { ...input, context: { ...context, effectiveModelId: 'byok/connection/model' } }
  const prepared = await preparePersonalHarnessModel(external)
  expect(prepared.contextWindow).toBeNull()
  expect(prepared.estimatedCostMicros).toBe(0)
  await expect(preparePersonalHarnessModel({ ...external, options: { ...input.options, prompt: [{ role: 'user', content: [
    { type: 'file', data: new URL('https://example.test/image.png'), mediaType: 'image/png' },
  ] }] } })).rejects.toThrow(/known context limit/)
})
