import { beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { authorizeNativeHarnessModelDispatch } from './native-model-dispatch'
import type { HarnessModelReference } from './secure-model'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), read: vi.fn(), apply: vi.fn(), ensure: vi.fn(), capabilities: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.read; apply = mocks.apply } }))
vi.mock('@/server/billing/billing-runtime', () => ({ ensurePayerBudgetAvailable: mocks.ensure }))
vi.mock('@/server/capabilities', () => ({ getOverlayCapabilities: mocks.capabilities }))

const access = { actorUserId: 'user', runId: 'workspace:delivery', workflowRunId: 'workflow',
  workspaceId: 'workspace', principalId: 'human-principal', agentId: 'agent', agentPrincipalId: 'agent-principal',
  conversationId: 'room', agentRunId: 'delivery', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn' }
const reference: HarnessModelReference = { modelId: 'provider/model', credentialOwnerId: 'user',
  native: { access, receiptId: 'model:0', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'request',
    maxOutputTokens: 50, contextWindow: 10_000 } }
const options: LanguageModelV4CallOptions = { prompt: [], maxOutputTokens: 50 }
const state = { workflowRunId: 'workflow', revision: 1, policy: { executionPolicyVersion: 2, spendingMode: 'workspace' },
  modelReservation: { id: 'model:0', maxCostMicros: 0 } }
const funded = { planKind: 'paid', budgetTotalCents: 10_000, budgetRemainingCents: 5_000, budgetUsedCents: 5_000 }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.capabilities.mockResolvedValue({ billing: true })
  mocks.refresh.mockResolvedValue({ entitlements: funded, billingProgrammaticSubjectId: 'agent:agent' })
  mocks.read.mockResolvedValue(state)
  mocks.apply.mockResolvedValue({ applied: true, conflict: false, snapshot: state })
})

test('native dispatch refreshes authority then binds the call with no billing reservation', async () => {
  await authorizeNativeHarnessModelDispatch(reference, options)
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(access, { modelId: reference.modelId,
    memoryEnabled: true, sharedRoom: true, requestFingerprint: 'request' }, undefined,
  { renewalMode: true, renewLease: true })
  expect(mocks.ensure).not.toHaveBeenCalled()
  expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: {
    type: 'bind_model_dispatch', id: 'model:0', modelId: reference.modelId, billingReservationId: null,
  } }))
})

test('a low workspace budget tries an auto top-up for the refreshed agent subject before refusing', async () => {
  const low = { ...funded, budgetRemainingCents: 150, budgetUsedCents: 9_850 }
  mocks.refresh.mockResolvedValue({ entitlements: low, billingProgrammaticSubjectId: 'surface:slack:binding' })
  mocks.ensure.mockResolvedValue({ entitlements: low, remainingCents: 150 })
  await expect(authorizeNativeHarnessModelDispatch(reference, options)).rejects.toThrow('The workspace budget is under 2%.')
  expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    userId: 'user', workspaceId: 'workspace', programmaticSubjectId: 'surface:slack:binding', minimumRequiredCents: 200,
  }))
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('revoked access, fresh ZDR and replayed dispatch fail closed without binding', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('revoked'))
  await expect(authorizeNativeHarnessModelDispatch(reference, options)).rejects.toThrow(/revoked/)
  mocks.refresh.mockResolvedValueOnce({ entitlements: funded, requiresZeroDataRetention: true })
  await expect(authorizeNativeHarnessModelDispatch(reference, options)).rejects.toThrow(/zero data retention/)
  mocks.read.mockResolvedValue({ ...state, modelReservation: { ...state.modelReservation,
    dispatch: { modelId: reference.modelId, billingReservationId: null },
  } })
  await expect(authorizeNativeHarnessModelDispatch(reference, options)).rejects.toThrow(/already been attempted/)
  expect(mocks.apply).not.toHaveBeenCalled()
})
