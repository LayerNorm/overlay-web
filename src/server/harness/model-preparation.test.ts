import { beforeEach, expect, test, vi } from 'vitest'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { preparePersonalHarnessModel, readHarnessModelLimits } from './model-preparation'
import { WORKFLOW_SERIALIZE } from '@workflow/serde'
import { HarnessLanguageModel } from './secure-model'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), catalog: vi.fn(), zdr: vi.fn(), deploymentEnv: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/env/deployment-env', () => ({ deploymentEnv: mocks.deploymentEnv }))
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
  mocks.deploymentEnv.mockReturnValue({})
  mocks.zdr.mockReturnValue(false)
  mocks.refresh.mockImplementation(async (_access, supplied) => ({ ...supplied, entitlements: { confidential: 'must-not-persist' } }))
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 32_000, maxTokens: 1_000,
    pricing: { input: '0.000001', output: '0.000002' } })
})

test('model limits expose the scoped QA budget without changing provider limits', async () => {
  mocks.deploymentEnv.mockReturnValue({
    VERCEL_ENV: 'preview', OVERLAY_DEPLOYMENT_ENV: 'preview',
    NEXT_PUBLIC_APP_URL: 'https://pr-384.preview.getoverlay.io',
    VERCEL_GIT_PULL_REQUEST_ID: '384', PREVIEW_LOGIN_USER_ID: 'user_qa',
    HARNESS_PREVIEW_CONTEXT_TOKENS: '16000',
  })
  expect(await readHarnessModelLimits('fixture/model', 'user_qa')).toEqual({
    contextWindow: 32_000, maxOutputTokens: 1_000, previewContextBudgetTokens: 16_000,
  })
  expect(await readHarnessModelLimits('fixture/model', 'user_other')).toEqual({
    contextWindow: 32_000, maxOutputTokens: 1_000,
  })
})

test.each([undefined, 4])('preserves personal execution generation %s through preparation and serialization', async executionGeneration => {
  const prepared = await preparePersonalHarnessModel({ ...input, access: { ...access, executionGeneration } })
  expect(prepared.model.personal?.access.executionGeneration).toBe(executionGeneration ?? 0)
  const serialized = HarnessLanguageModel[WORKFLOW_SERIALIZE](new HarnessLanguageModel(prepared.model))
  expect(serialized.personal?.access.executionGeneration).toBe(executionGeneration ?? 0)
})

test('constructs a credential-free dispatch reference with explicit limits and no cost estimate', async () => {
  const prepared = await preparePersonalHarnessModel({ ...input, access: { ...access, accessToken: 'must-not-persist' } as typeof access })
  expect(prepared.model).toMatchObject({ modelId: 'fixture/model', credentialOwnerId: 'user',
    personal: { receiptId: 'model:0', contextWindow: 32_000, maxOutputTokens: 100, memoryEnabled: true } })
  expect(prepared).not.toHaveProperty('estimatedCostMicros')
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

test('automation preparation preserves the original turn and grant snapshot for provider reauthorization', async () => {
  const automationAccess = { ...access, authentication: {
    type: 'automation' as const, automationId: 'automation', automationRunId: 'automation-run',
    originWorkflowRunId: 'workflow',
  } }
  const automationContext = {
    ...context, turnId: 'automation-run:automation-run', automationExecution: true,
    automationId: 'automation', automationRunId: 'automation-run',
    billingProgrammaticSubjectId: 'automation:automation',
    accountAllowedToolIds: ['read_file'], accountAllowedConnectorIds: ['gmail'], integrationToolIds: ['gmail_send'],
  }
  const prepared = await preparePersonalHarnessModel({ ...input, access: automationAccess, context: automationContext })
  expect(prepared.model.personal?.automationContext).toEqual({
    turnId: automationContext.turnId, accountAllowedToolIds: ['read_file'],
    accountAllowedConnectorIds: ['gmail'], integrationToolIds: ['gmail_send'],
  })
  expect(prepared.model.personal?.receiptId).toBe('model:0')
  expect(JSON.stringify(prepared)).not.toContain('must-not-persist')
})

test('forces ZDR for each supported active candidate even when account policy does not require it', async () => {
  mocks.zdr.mockReturnValue(true)
  mocks.refresh.mockResolvedValue({ ...context, requiresZeroDataRetention: false })
  const prepared = await preparePersonalHarnessModel(input)
  expect(prepared.options.providerOptions).toEqual({ gateway: { zeroDataRetention: true } })
})

test('rejects unauthenticated, unsupported and oversized dispatches before admission', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('Access revoked'))
  await expect(preparePersonalHarnessModel(input)).rejects.toThrow(/revoked/)
  expect(mocks.catalog).not.toHaveBeenCalled()
  await expect(preparePersonalHarnessModel({ ...input, options: { ...input.options, maxOutputTokens: 1_001 } })).rejects.toThrow(/capacity/)
  await expect(preparePersonalHarnessModel({ ...input, options: { ...input.options, providerOptions: { gateway: { models: ['unapproved'] } } } })).rejects.toThrow(/fallback/)
})

test('unknown BYOK context stays unknown, including for media', async () => {
  mocks.catalog.mockResolvedValue(null)
  const external = { ...input, context: { ...context, effectiveModelId: 'byok/connection/model' } }
  const prepared = await preparePersonalHarnessModel(external)
  expect(prepared.contextWindow).toBeNull()
  const media = await preparePersonalHarnessModel({ ...external, options: { ...input.options, prompt: [{ role: 'user', content: [
    { type: 'file', data: new URL('https://example.test/image.png'), mediaType: 'image/png' },
  ] }] } })
  expect(media.contextWindow).toBeNull()
})
