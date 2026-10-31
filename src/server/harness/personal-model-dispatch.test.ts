import { beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { authorizePersonalHarnessModelDispatch } from './personal-model-dispatch'
import type { HarnessModelReference } from './secure-model'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), read: vi.fn(), apply: vi.fn(), reserve: vi.fn(), started: vi.fn(), release: vi.fn(), forecast: vi.fn(), reject: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./personal-access', () => ({ refreshPersonalHarnessAccess: mocks.refresh }))
vi.mock('./model-rejection', () => ({ recordHarnessModelRejection: mocks.reject }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.read; apply = mocks.apply } }))
vi.mock('./model-forecast', () => ({ estimateHarnessInputTokens: () => 100, hasHarnessCacheWrites: () => false, forecastHarnessModelCost: mocks.forecast }))
vi.mock('@/server/billing/billing-runtime', () => ({ reserveProviderBudget: mocks.reserve, markProviderBudgetStarted: mocks.started, releaseProviderBudgetReservation: mocks.release }))

const access = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
  workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' as const } }
const reference: HarnessModelReference = { modelId: 'provider/model', credentialOwnerId: 'user', allowLowBalanceFallback: false,
  personal: { access, receiptId: 'model:0', memoryEnabled: true, requestFingerprint: 'fingerprint', inputTokenBudget: 100,
    maxOutputTokens: 50, contextWindow: 1_000 } }
const options: LanguageModelV4CallOptions = { prompt: [], maxOutputTokens: 50 }
const state = { workflowRunId: 'workflow', revision: 1, modelReservation: { id: 'model:0', maxCostMicros: 60 } }

test('budget rejection is durably recorded before failing and never binds or starts provider execution', async () => {
  mocks.reserve.mockResolvedValue({ ok: false, code: 'insufficient_credits' })
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow('reservation declined')
  expect(mocks.reject).toHaveBeenCalledExactlyOnceWith(reference, 'budget')
  expect(mocks.apply).not.toHaveBeenCalled()
  expect(mocks.started).not.toHaveBeenCalled()
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refresh.mockResolvedValue({ entitlements: { planKind: 'pro' } })
  mocks.read.mockResolvedValue(state)
  mocks.forecast.mockResolvedValue(40)
  mocks.reserve.mockResolvedValue({ ok: true, reservationId: 'billing' })
  mocks.apply.mockResolvedValue({ applied: true, conflict: false, snapshot: state })
})

test('refreshes identity, reserves a stable account hold, claims dispatch atomically, then marks started', async () => {
  await authorizePersonalHarnessModelDispatch(reference, options)
  expect(mocks.refresh).toHaveBeenCalledWith(access, expect.objectContaining({ memoryEnabled: true, effectiveModelId: 'provider/model' }))
  expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user', workspaceId: 'workspace', providerCostUsd: 0.00004,
    reservationId: expect.stringMatching(/^harness-model:[a-f0-9]{64}$/), operationId: expect.any(String) }))
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ operation: {
    type: 'bind_model_dispatch', id: 'model:0', modelId: 'provider/model', billingReservationId: 'billing',
  } }))
  expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.reserve.mock.invocationCallOrder[0])
  expect(mocks.apply.mock.invocationCallOrder[0]).toBeLessThan(mocks.started.mock.invocationCallOrder[0])
  expect(mocks.release).not.toHaveBeenCalled()
})

test('automation model dispatch rebuilds run and source identity from serialized authority', async () => {
  const automationAccess = {
    ...access,
    authentication: {
      type: 'automation' as const,
      automationId: 'automation',
      automationRunId: 'automation-run',
      originWorkflowRunId: 'origin-workflow',
    },
  }
  const automationReference: HarnessModelReference = {
    ...reference,
    personal: { ...reference.personal!, access: automationAccess },
  }
  await authorizePersonalHarnessModelDispatch(automationReference, options)
  expect(mocks.refresh).toHaveBeenCalledWith(automationAccess, expect.objectContaining({
    automationExecution: true,
    automationId: 'automation',
    automationRunId: 'automation-run',
    billingProgrammaticSubjectId: 'automation:automation',
  }))
})

test('automation model dispatch revalidates source before reserving provider funds', async () => {
  const automationAccess = {
    ...access,
    authentication: {
      type: 'automation' as const,
      automationId: 'automation',
      automationRunId: 'automation-run',
      originWorkflowRunId: 'origin-workflow',
    },
  }
  const automationReference: HarnessModelReference = {
    ...reference,
    personal: { ...reference.personal!, access: automationAccess },
  }
  mocks.refresh.mockRejectedValueOnce(new Error('Automation run was cancelled.'))
  await expect(authorizePersonalHarnessModelDispatch(automationReference, options))
    .rejects.toThrow(/Automation run was cancelled/)
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('revocation, larger token limits and changed pricing never reserve provider funds', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('revoked'))
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/revoked/)
  await expect(authorizePersonalHarnessModelDispatch(reference, { ...options, maxOutputTokens: 51 })).rejects.toThrow(/limits/)
  mocks.forecast.mockResolvedValue(61)
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/authorized hold/)
  expect(mocks.reserve).not.toHaveBeenCalled()
})

test('fallback model lists must be authorized before dispatch, while empty lists are safe', async () => {
  for (const provider of ['gateway', 'openrouter']) {
    await expect(authorizePersonalHarnessModelDispatch(reference, { ...options, providerOptions: { [provider]: { models: ['other/model'] } } })).rejects.toThrow(/fallback/)
  }
  expect(mocks.reserve).not.toHaveBeenCalled()
  await authorizePersonalHarnessModelDispatch(reference, { ...options, providerOptions: { gateway: { models: [] } } })
  expect(mocks.started).toHaveBeenCalledTimes(1)
})

test('a newly enabled ZDR policy requires actual ZDR routing before reserving provider funds', async () => {
  mocks.refresh.mockResolvedValue({ entitlements: {}, requiresZeroDataRetention: true })
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/zero data retention routing/)
  expect(mocks.reserve).not.toHaveBeenCalled()
  await authorizePersonalHarnessModelDispatch(reference, { ...options, providerOptions: { gateway: { zeroDataRetention: true } } })
  expect(mocks.started).toHaveBeenCalledTimes(1)
})

test('prior dispatch and atomic claim replays cannot dispatch again, including calls without account holds', async () => {
  mocks.read.mockResolvedValueOnce({ ...state, modelReservation: { ...state.modelReservation, dispatch: { modelId: 'provider/model', billingReservationId: null } } })
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/already/)
  expect(mocks.reserve).not.toHaveBeenCalled()
  mocks.reserve.mockResolvedValue({ ok: true, reservationId: null })
  mocks.apply.mockResolvedValue({ applied: false, conflict: false, snapshot: state })
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/already/)
  expect(mocks.started).not.toHaveBeenCalled()
  expect(mocks.release).toHaveBeenCalledWith(expect.objectContaining({ reservationId: null }))
})

test('failed binding releases only the unused account hold; a failed start retains a bound hold for reconciliation', async () => {
  mocks.apply.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/storage unavailable/)
  expect(mocks.release).toHaveBeenCalledTimes(1)
  expect(mocks.started).not.toHaveBeenCalled()
  mocks.started.mockRejectedValueOnce(new Error('start unavailable'))
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/start unavailable/)
  expect(mocks.release).toHaveBeenCalledTimes(1)
})
