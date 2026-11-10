import { beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { WORKFLOW_SERIALIZE } from '@workflow/serde'
import { harnessDiagnosticForFailure } from './harness-diagnostics'
import { authorizePersonalHarnessModelDispatch } from './personal-model-dispatch'
import { HarnessLanguageModel, type HarnessModelReference } from './secure-model'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), read: vi.fn(), apply: vi.fn(), ensure: vi.fn(), capabilities: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./personal-access', () => ({ refreshPersonalHarnessAccess: mocks.refresh }))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.read; apply = mocks.apply } }))
vi.mock('@/server/billing/billing-runtime', () => ({ ensurePayerBudgetAvailable: mocks.ensure }))
vi.mock('@/server/capabilities', () => ({ getOverlayCapabilities: mocks.capabilities }))

const access = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
  workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' as const } }
const reference: HarnessModelReference = { modelId: 'provider/model', credentialOwnerId: 'user',
  personal: { access, receiptId: 'model:0', memoryEnabled: true, requestFingerprint: 'fingerprint',
    maxOutputTokens: 50, contextWindow: 1_000 } }
const options: LanguageModelV4CallOptions = { prompt: [], maxOutputTokens: 50 }
const automationContext = {
  turnId: 'automation-run:automation-run', accountAllowedToolIds: ['read_file'],
  accountAllowedConnectorIds: ['gmail'], integrationToolIds: ['gmail_send'],
}
const state = { workflowRunId: 'workflow', revision: 1, status: 'running', policy: { executionPolicyVersion: 2, spendingMode: 'workspace' },
  modelReservation: { id: 'model:0', maxCostMicros: 0 }, plan: [], evidence: [], children: [] }
const funded = { planKind: 'paid', budgetTotalCents: 10_000, budgetRemainingCents: 201, budgetUsedCents: 9_799 }
const low = { ...funded, budgetRemainingCents: 199, budgetUsedCents: 9_801 }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.capabilities.mockResolvedValue({ billing: true })
  mocks.refresh.mockResolvedValue({ entitlements: funded })
  mocks.read.mockResolvedValue(state)
  mocks.apply.mockResolvedValue({ applied: true, conflict: false, snapshot: state })
})

test('above 2% the call is bound with no reservation, hold or cost estimate', async () => {
  await authorizePersonalHarnessModelDispatch(reference, options)
  expect(mocks.refresh).toHaveBeenCalledWith(access,
    expect.objectContaining({ memoryEnabled: true, effectiveModelId: 'provider/model' }), undefined,
    { renewalMode: true, renewLease: true })
  expect(mocks.ensure).not.toHaveBeenCalled()
  expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: {
    type: 'bind_model_dispatch', id: 'model:0', modelId: 'provider/model', billingReservationId: null,
  } }))
})

test('under 2% after a failed top-up the dispatch refuses before binding and the run ends with WORKSPACE_FUNDS', async () => {
  mocks.refresh.mockResolvedValue({ entitlements: low })
  mocks.ensure.mockResolvedValue({ entitlements: low, remainingCents: 199 })
  const error = await authorizePersonalHarnessModelDispatch(reference, options).catch((caught: unknown) => caught)
  expect(error).toMatchObject({ name: 'FatalError', message: 'The workspace budget is under 2%.' })
  expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    userId: 'user', workspaceId: 'workspace', minimumRequiredCents: 200,
  }))
  expect(mocks.apply).not.toHaveBeenCalled()
  const diagnostic = harnessDiagnosticForFailure('run', state as never, error, 'model')
  expect(diagnostic).toMatchObject({ code: 'WORKSPACE_FUNDS', stage: 'model' })
})

test('a successful auto top-up lets the call proceed', async () => {
  mocks.refresh.mockResolvedValue({ entitlements: low })
  mocks.ensure.mockResolvedValue({ entitlements: { ...low, budgetTotalCents: 12_000, budgetRemainingCents: 2_199 }, remainingCents: 2_199 })
  await authorizePersonalHarnessModelDispatch(reference, options)
  expect(mocks.apply).toHaveBeenCalledOnce()
})

test('Notebook dispatch rechecks the refreshed 2% budget at each boundary without a spend hold', async () => {
  const notebookState = { ...state, policy: { ...state.policy, surface: {
    kind: 'notebook', noteId: 'note', turnId: 'turn', requestDigest: 'digest',
  } } }
  mocks.read.mockResolvedValue(notebookState)
  await authorizePersonalHarnessModelDispatch(reference, options)
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ operation: {
    type: 'bind_model_dispatch', id: 'model:0', modelId: 'provider/model', billingReservationId: null,
  } }))
  mocks.read.mockResolvedValue({ ...notebookState, modelReservation: { id: 'model:1', maxCostMicros: 0 } })
  mocks.refresh.mockResolvedValue({ entitlements: low })
  mocks.ensure.mockResolvedValue({ entitlements: low, remainingCents: 199 })
  await expect(authorizePersonalHarnessModelDispatch({ ...reference,
    personal: { ...reference.personal!, receiptId: 'model:1' },
  }, options)).rejects.toThrow('The workspace budget is under 2%.')
  expect(mocks.apply).toHaveBeenCalledTimes(1)
})

test('billing disabled and unlimited budgets never stop work', async () => {
  mocks.refresh.mockResolvedValue({ entitlements: { planKind: 'free', budgetTotalCents: 0, budgetRemainingCents: 0 } })
  mocks.capabilities.mockResolvedValue({ billing: false })
  await authorizePersonalHarnessModelDispatch(reference, options)
  mocks.capabilities.mockResolvedValue({ billing: true })
  mocks.refresh.mockResolvedValue({ entitlements: { ...funded, budgetTotalCents: Number.MAX_SAFE_INTEGER, budgetRemainingCents: Number.MAX_SAFE_INTEGER } })
  await authorizePersonalHarnessModelDispatch(reference, options)
  expect(mocks.ensure).not.toHaveBeenCalled()
  expect(mocks.apply).toHaveBeenCalledTimes(2)
})

test('automation model dispatch rebuilds run and source identity from serialized authority', async () => {
  const automationAccess = {
    ...access,
    executionGeneration: 7,
    authentication: {
      type: 'automation' as const,
      automationId: 'automation',
      automationRunId: 'automation-run',
      originWorkflowRunId: 'origin-workflow',
    },
  }
  const automationReference: HarnessModelReference = {
    ...reference,
    personal: { ...reference.personal!, access: automationAccess, automationContext },
  }
  mocks.read.mockResolvedValue({ ...state, executionGeneration: 7 })
  const serialized = HarnessLanguageModel[WORKFLOW_SERIALIZE](new HarnessLanguageModel(automationReference))
  await authorizePersonalHarnessModelDispatch(serialized, options)
  expect(mocks.refresh).toHaveBeenCalledWith(automationAccess, expect.objectContaining({
    ...automationContext,
    automationExecution: true,
    automationId: 'automation',
    automationRunId: 'automation-run',
    billingProgrammaticSubjectId: 'automation:automation',
  }), undefined, { renewalMode: true, renewLease: true })
})

test('automation model dispatch revalidates source before binding', async () => {
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
    personal: { ...reference.personal!, access: automationAccess, automationContext },
  }
  mocks.refresh.mockRejectedValueOnce(new Error('Automation run was cancelled.'))
  await expect(authorizePersonalHarnessModelDispatch(automationReference, options))
    .rejects.toThrow(/Automation run was cancelled/)
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('revocation and larger output limits never bind a dispatch', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('revoked'))
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/revoked/)
  await expect(authorizePersonalHarnessModelDispatch(reference, { ...options, maxOutputTokens: 51 })).rejects.toThrow(/output limit/)
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('fallback model lists must be authorized before dispatch, while empty lists are safe', async () => {
  for (const provider of ['gateway', 'openrouter']) {
    await expect(authorizePersonalHarnessModelDispatch(reference, { ...options, providerOptions: { [provider]: { models: ['other/model'] } } })).rejects.toThrow(/fallback/)
  }
  expect(mocks.apply).not.toHaveBeenCalled()
  await authorizePersonalHarnessModelDispatch(reference, { ...options, providerOptions: { gateway: { models: [] } } })
  expect(mocks.apply).toHaveBeenCalledTimes(1)
})

test('a newly enabled ZDR policy requires actual ZDR routing before binding', async () => {
  mocks.refresh.mockResolvedValue({ entitlements: funded, requiresZeroDataRetention: true })
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/zero data retention routing/)
  expect(mocks.apply).not.toHaveBeenCalled()
  await authorizePersonalHarnessModelDispatch(reference, { ...options, providerOptions: { gateway: { zeroDataRetention: true } } })
  expect(mocks.apply).toHaveBeenCalledTimes(1)
})

test('a bound dispatch and an atomic claim replay are never sent again', async () => {
  mocks.read.mockResolvedValueOnce({ ...state, modelReservation: { ...state.modelReservation, dispatch: { modelId: 'provider/model', billingReservationId: null } } })
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/already/)
  mocks.apply.mockResolvedValue({ applied: false, conflict: false, snapshot: state })
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/already/)
})

test('v2 external mode binds BYOK without a budget check; none mode refuses paid and retired models', async () => {
  const byokReference: HarnessModelReference = {
    ...reference,
    modelId: 'byok/anthropic/claude-3-5-sonnet-latest',
    personal: { ...reference.personal!, receiptId: 'model:1' },
  }
  const externalState = {
    ...state, policy: { executionPolicyVersion: 2, spendingMode: 'external' },
    modelReservation: { id: 'model:1', maxCostMicros: 0 },
  }
  mocks.read.mockResolvedValueOnce(externalState).mockResolvedValueOnce(externalState)
  mocks.refresh.mockResolvedValue({ entitlements: low })
  await authorizePersonalHarnessModelDispatch(byokReference, options)
  expect(mocks.ensure).not.toHaveBeenCalled()
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ operation: {
    type: 'bind_model_dispatch', id: 'model:1', modelId: byokReference.modelId, billingReservationId: null,
  } }))

  const noneState = { ...state, policy: { executionPolicyVersion: 2, spendingMode: 'none' } }
  mocks.read.mockResolvedValue(noneState)
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/requires workspace funding/)
  const freeReference: HarnessModelReference = {
    ...reference, modelId: 'openrouter/free', personal: { ...reference.personal!, receiptId: 'model:2' },
  }
  await expect(authorizePersonalHarnessModelDispatch(freeReference, options)).rejects.toThrow(/retired/)
  expect(mocks.apply).toHaveBeenCalledTimes(1)
})

test('v2 external spending cannot dispatch an Overlay-funded model', async () => {
  mocks.read.mockResolvedValueOnce({
    ...state, policy: { executionPolicyVersion: 2, spendingMode: 'external' },
  })
  await expect(authorizePersonalHarnessModelDispatch(reference, options)).rejects.toThrow(/spending mode/)
  expect(mocks.apply).not.toHaveBeenCalled()
})
