import { beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { authorizeNativeHarnessModelDispatch } from './native-model-dispatch'
import type { HarnessModelReference } from './secure-model'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), read: vi.fn(), apply: vi.fn(), forecast: vi.fn(),
  reserve: vi.fn(), started: vi.fn(), release: vi.fn(), reject: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.read; apply = mocks.apply } }))
vi.mock('./model-forecast', async importOriginal => ({ ...await importOriginal<typeof import('./model-forecast')>(), forecastHarnessModelCost: mocks.forecast }))
vi.mock('./model-rejection', () => ({ recordHarnessModelRejection: mocks.reject }))
vi.mock('@/server/billing/billing-runtime', () => ({ reserveProviderBudget: mocks.reserve, markProviderBudgetStarted: mocks.started,
  releaseProviderBudgetReservation: mocks.release }))

const access = { actorUserId: 'user', runId: 'workspace:delivery', workflowRunId: 'workflow',
  workspaceId: 'workspace', principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal',
  conversationId: 'room', agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' }
const reference: HarnessModelReference = { modelId: 'provider/model', credentialOwnerId: 'user', allowLowBalanceFallback: false,
  native: { access, receiptId: 'model:0', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'request',
    inputTokenBudget: 2_000, maxOutputTokens: 50, contextWindow: 10_000 } }
const options: LanguageModelV4CallOptions = { prompt: [], maxOutputTokens: 50 }
const state = { workflowRunId: 'workflow', revision: 1, modelReservation: { id: 'model:0', maxCostMicros: 60 } }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refresh.mockResolvedValue({ entitlements: { planKind: 'pro' }, billingProgrammaticSubjectId: 'agent:agent' })
  mocks.read.mockResolvedValue(state)
  mocks.forecast.mockResolvedValue(40)
  mocks.reserve.mockResolvedValue({ ok: true, reservationId: 'billing' })
  mocks.apply.mockResolvedValue({ applied: true, conflict: false, snapshot: state })
})

test('native dispatch refreshes authority then atomically binds a human-funded, agent-attributed hold', async () => {
  await authorizeNativeHarnessModelDispatch(reference, options)
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(access, { modelId: reference.modelId,
    memoryEnabled: true, sharedRoom: true, requestFingerprint: 'request' })
  expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: 'user', workspaceId: 'workspace',
    programmaticSubjectId: 'agent:agent', providerCostUsd: 0.00004, reservationId: expect.stringMatching(/^harness-model:[a-f0-9]{64}$/) }))
  expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: {
    type: 'bind_model_dispatch', id: 'model:0', modelId: reference.modelId, billingReservationId: 'billing',
  } }))
  expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.reserve.mock.invocationCallOrder[0])
  expect(mocks.apply.mock.invocationCallOrder[0]).toBeLessThan(mocks.started.mock.invocationCallOrder[0])
})

test('native surface dispatch reserves against the refreshed canonical binding subject', async () => {
  mocks.refresh.mockResolvedValueOnce({
    entitlements: { planKind: 'pro' },
    billingProgrammaticSubjectId: 'surface:slack:binding',
  })
  await authorizeNativeHarnessModelDispatch(reference, options)
  expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    programmaticSubjectId: 'surface:slack:binding',
  }))
})

test('native budget rejection records the receipt and does not start inference', async () => {
  mocks.reserve.mockResolvedValue({ ok: false, code: 'insufficient_credits' })
  await expect(authorizeNativeHarnessModelDispatch(reference, options)).rejects.toThrow(/reservation declined/)
  expect(mocks.reject).toHaveBeenCalledExactlyOnceWith(reference, 'budget')
  expect(mocks.apply).not.toHaveBeenCalled()
  expect(mocks.started).not.toHaveBeenCalled()
})

test('revoked access, fresh ZDR and replayed dispatch fail closed without a second hold', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('revoked'))
  await expect(authorizeNativeHarnessModelDispatch(reference, options)).rejects.toThrow(/revoked/)
  mocks.refresh.mockResolvedValueOnce({ entitlements: {}, requiresZeroDataRetention: true })
  await expect(authorizeNativeHarnessModelDispatch(reference, options)).rejects.toThrow(/zero data retention/)
  mocks.read.mockResolvedValue({ ...state, modelReservation: { ...state.modelReservation,
    dispatch: { modelId: reference.modelId, billingReservationId: 'billing' },
  } })
  await expect(authorizeNativeHarnessModelDispatch(reference, options)).rejects.toThrow(/already been attempted/)
  expect(mocks.reserve).not.toHaveBeenCalled()
})
