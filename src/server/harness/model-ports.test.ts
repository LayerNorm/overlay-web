import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionReference } from './state-steps'
import type { HarnessModelReference } from './secure-model'
import type { PreparedHarnessModel } from './model-ports'
import { HARNESS_ANSWER_VERIFICATION_INSTRUCTIONS } from './continuity-policy'
import { createHarnessModelPorts } from './model-ports'

const mocks = vi.hoisted(() => ({
  read: vi.fn(), limits: vi.fn(), compact: vi.fn(), wait: vi.fn(), reset: vi.fn(), recovery: vi.fn(), apply: vi.fn(),
  stream: vi.fn(), agentOptions: [] as Array<Record<string, unknown>>,
  identifyArtifact: vi.fn(), storeArtifact: vi.fn(), readArtifactMetadata: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('./state-steps', () => ({
  readHarnessState: mocks.read, applyHarnessOperation: mocks.apply,
  readHarnessModelLimits: vi.fn(),
}))
vi.mock('./model-recovery', async importOriginal => ({
  ...await importOriginal<typeof import('./model-recovery')>(), waitForHarnessModelRecovery: mocks.recovery,
}))
vi.mock('./model-preparation', () => ({ readHarnessModelLimits: mocks.limits }))
vi.mock('./resource-boundary', () => ({
  waitForHarnessModelResources: vi.fn((_reference, _cost, read) => read()),
}))
vi.mock('./settle-model-step', () => ({ settleHarnessModelUsage: vi.fn() }))
vi.mock('./artifact-steps', () => ({
  identifyHarnessArtifact: mocks.identifyArtifact,
  storeHarnessArtifact: mocks.storeArtifact,
  readHarnessArtifactMetadata: mocks.readArtifactMetadata,
}))
vi.mock('workflow', () => ({
  FatalError: class extends Error {},
  sleep: vi.fn(async () => undefined),
}))
vi.mock('@ai-sdk/workflow', () => ({
  WorkflowAgent: class {
    constructor(options: Record<string, unknown>) {
      mocks.agentOptions.push(options)
    }
    stream = mocks.stream
  },
}))

const reference = { runId: 'run', workflowRunId: 'workflow' } as HarnessExecutionReference

function runningState() {
  return {
    ...createHarnessSnapshot({
      runId: 'run',
      goal: 'Continue the selected model.',
      constraints: [],
      policy: {
        actorUserId: 'user',
        allowedToolIds: [],
        requiresPlan: false,
        deadlineAt: Date.now() + 60_000,
        maxCostMicros: 0,
        maxParallelChildren: 0,
        maxDepth: 0,
      },
    }, Date.now()),
    status: 'running' as const,
    latestReceipt: {
      id: 'model:0',
      modelId: 'openrouter/free',
      provider: 'overlay-free-router',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindow: null,
      costMicros: 0,
      costSource: 'catalog' as const,
      rejectionReason: 'route_interrupted' as const,
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks(); mocks.agentOptions.length = 0
  mocks.limits.mockResolvedValue({ contextWindow: 32_000, maxOutputTokens: 2_000 })
})

vi.mock('@/server/chat/context-compaction-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/chat/context-compaction-core')>()
  return { ...actual, compactHarnessPrompt: (...args: Parameters<typeof actual.compactHarnessPrompt>) =>
    mocks.compact.getMockImplementation() ? mocks.compact(...args) : actual.compactHarnessPrompt(...args) }
})

test('historical free-router rejection receipts do not recover or dispatch another model', async () => {
  const state = {
    ...createHarnessSnapshot({
      runId: 'run',
      goal: 'Keep the selected model unchanged.',
      constraints: [],
      policy: {
        actorUserId: 'user',
        allowedToolIds: [],
        requiresPlan: false,
        deadlineAt: Date.now() + 60_000,
        maxCostMicros: 0,
        maxParallelChildren: 0,
        maxDepth: 0,
      },
    }, Date.now()),
    status: 'running' as const,
    latestReceipt: {
      id: 'model:0',
      modelId: 'openrouter/free',
      provider: 'overlay-free-router',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindow: null,
      costMicros: 0,
      costSource: 'catalog' as const,
      rejectionReason: 'route_interrupted' as const,
    },
  }
  mocks.read.mockResolvedValue(state)
  const ports = createHarnessModelPorts({
    reference,
    modelId: 'openrouter/free',
    prepare: async () => ({
      model: {} as HarnessModelReference,
      options: { prompt: [] },
      contextWindow: null,
      estimatedCostMicros: 0,
    }),
  })

  expect(await ports.recoverModelFailure('model:0')).toBe(false)
  expect(mocks.recovery).not.toHaveBeenCalled()
})

test('model preparation reuses the boundary state and reads catalog limits once per model', async () => {
  const state = { ...createHarnessSnapshot({
    runId: 'run', goal: 'Use the selected paid model.', constraints: [], policy: {
      actorUserId: 'user', allowedToolIds: [], requiresPlan: false,
      deadlineAt: Date.now() + 60_000, maxCostMicros: 100, maxParallelChildren: 0, maxDepth: 0,
    },
  }, Date.now()), status: 'running' as const }
  const prepare = vi.fn(async ({ modelId }: { modelId: string }) => ({
    model: { modelId, credentialOwnerId: 'user' } as HarnessModelReference,
    options: {} as never, contextWindow: 128_000, estimatedCostMicros: 0,
  }))
  mocks.limits.mockResolvedValue({ contextWindow: 128_000, maxOutputTokens: 4_096 })
  mocks.compact.mockImplementation(async ({ messages }) => ({ messages, didCompact: false, summaryFailed: false, fitsBudget: true }))
  const ports = createHarnessModelPorts({ reference, modelId: 'fixture/model', prepare })
  const request = (receiptId: string) => ({
    receiptId, state, messages: [], toolNames: [], toolDefinitions: [], settings: {},
    instructionContext: { instructions: 'Follow the plan.', continuation: false, truncatedResponse: false, finalAnswerRequired: false },
  })
  await ports.prepareModel(request('model:0'))
  await ports.prepareModel(request('model:1'))
  expect(mocks.limits).toHaveBeenCalledExactlyOnceWith('fixture/model')
  expect(mocks.read).not.toHaveBeenCalled()
  expect(prepare).toHaveBeenCalledTimes(2)
  expect(mocks.compact.mock.calls[0][0].previousSummary).toBe(state.workingSummary)
})

test('summary funding denial yields its exact receipt instead of failing or preparing an unfunded response', async () => {
  const state = createHarnessSnapshot({ runId: 'run', goal: 'Continue the same task.', constraints: [], policy: {
    actorUserId: 'user', workspaceId: 'workspace', executionPolicyVersion: 2, spendingMode: 'workspace',
    allowedToolIds: [], requiresPlan: false, deadlineAt: Date.now() + 60_000,
    maxCostMicros: 0, maxParallelChildren: 0, maxDepth: 0,
  } }, Date.now())
  mocks.limits.mockResolvedValue({ contextWindow: 128_000, maxOutputTokens: 4_096 })
  mocks.compact.mockResolvedValue({ messages: [], didCompact: false, summaryFailed: true, fitsBudget: false })
  mocks.read.mockResolvedValue({ ...state, status: 'waiting_for_resources', resourcePause: {
    reason: 'disabled', receiptId: 'summary:model:0:0', requiredCents: 1, availableCents: 0.5,
  } })
  const prepare = vi.fn()
  const ports = createHarnessModelPorts({ reference, modelId: 'fixture/model', prepare })
  await expect(ports.prepareModel({ receiptId: 'model:0', state, messages: [], toolNames: [], toolDefinitions: [],
    settings: {}, instructionContext: { instructions: 'Continue.', continuation: true, truncatedResponse: false },
  })).rejects.toThrow('HARNESS_SAFE_RESOURCE_PAUSE:summary:model:0:0')
  expect(prepare).not.toHaveBeenCalled()
})

test.each([false, true])('progress output is capped even during full-history fallback=%s', async fallback => {
  const state = runningState()
  mocks.read.mockResolvedValue(state)
  mocks.compact.mockImplementation(async ({ messages }) => ({
    messages, didCompact: false, summaryFailed: fallback, fitsBudget: !fallback,
  }))
  const prepare = vi.fn(async (): Promise<PreparedHarnessModel> => ({
    model: { modelId: 'fixture/model', credentialOwnerId: 'user' } as HarnessModelReference,
    options: { prompt: [] }, contextWindow: 32_000, estimatedCostMicros: 0,
  }))
  const ports = createHarnessModelPorts({ reference, modelId: 'fixture/model', prepare })
  const base = { state, messages: [], toolNames: [], toolDefinitions: [], settings: { maxOutputTokens: 1_000 },
    instructionContext: { instructions: 'Keep user data private.', continuation: false, truncatedResponse: false } }
  const progress = await ports.prepareModel({ ...base, receiptId: 'model:1',
    instructionContext: { ...base.instructionContext, publicProgress: true } })
  expect(progress.settings?.maxOutputTokens).toBe(256)
  expect(prepare).toHaveBeenNthCalledWith(1, expect.objectContaining({
    options: expect.objectContaining({ maxOutputTokens: 256 }),
  }))
  const work = await ports.prepareModel({ ...base, receiptId: 'model:2' })
  expect(work.settings?.maxOutputTokens).toBe(1_000)
})

test.each([false, true])('final verification is metered and validates current-run evidence with fenced JSON=%s', async fenced => {
  const state = {
    ...runningState(),
    workflowRunId: 'workflow',
    evidence: [{
      id: 'tool:read-current', kind: 'tool_result' as const, source: 'read_document',
      summary: 'Read page 1 of file-1 revision rev-7.', verdict: 'observed' as const, createdAt: 1,
      resource: { id: 'file-1', revision: 'rev-7', page: 1 },
    }],
    progressRevision: 3,
  }
  mocks.read.mockResolvedValue(state)
  mocks.stream.mockResolvedValue({
    steps: [{
      text: (fenced ? '```json\n' : '')
        + '{"supported":true,"reason":"The answer matches page 1.","evidenceIds":["tool:read-current"]}'
        + (fenced ? '\n```' : ''),
      finishReason: 'stop',
    }],
  })
  const prepare = vi.fn(async (request: {
    modelId: string
    receiptId: string
    purpose: 'response' | 'summary' | 'verification'
    options: import('@ai-sdk/provider').LanguageModelV4CallOptions
  }): Promise<PreparedHarnessModel> => {
    expect(request.purpose).toBe('verification')
    return {
      model: {} as HarnessModelReference,
      options: { prompt: [] },
      contextWindow: null,
      estimatedCostMicros: 0,
    }
  })
  const ports = createHarnessModelPorts({ reference, modelId: 'openrouter/free', prepare })

  await expect(ports.verifyFinalAnswer!({
    state, candidate: 'Page 1 was read from file-1 revision rev-7.',
  })).resolves.toEqual({
    supported: true, reason: 'The answer matches page 1.', evidenceIds: ['tool:read-current'],
  })

  expect(prepare).toHaveBeenCalledOnce()
  const expectedInstructions = `${HARNESS_ANSWER_VERIFICATION_INSTRUCTIONS}\nThe envelope explicitly marks omitted observations and truncated summaries. These are incomplete evidence, not proof of absence. Reject any material claim that needs missing details.`
  expect(prepare.mock.calls[0]?.[0]).toMatchObject({
    purpose: 'verification',
    receiptId: expect.stringMatching(/^verification:0:3:/),
    options: { prompt: expect.arrayContaining([
      { role: 'system', content: expectedInstructions },
      expect.objectContaining({ role: 'user' }),
    ]) },
  })
  expect(mocks.apply).toHaveBeenCalledWith(
    reference, expect.stringMatching(/^reserve:verification:/),
    expect.objectContaining({ type: 'reserve_model', maxCostMicros: 0 }),
  )
  expect(mocks.agentOptions[0]).toMatchObject({
    tools: {}, maxRetries: 0, stopWhen: expect.anything(),
    instructions: expectedInstructions,
  })
  expect(JSON.stringify(prepare.mock.calls[0]?.[0]?.options.prompt))
    .toContain('tool:read-current')
  expect(JSON.stringify(prepare.mock.calls[0]?.[0]?.options.prompt))
    .not.toContain('unverifiedNarrative')
})

test('an aborted zero-cost summary retains its hold without invented settlement or retry', async () => {
  let current: HarnessSnapshot = {
    ...runningState(),
    workflowRunId: 'workflow',
    modelReservation: undefined,
    latestReceipt: undefined,
    compaction: undefined,
  }
  mocks.read.mockImplementation(async () => current)
  mocks.apply.mockImplementation(async (_reference, _operationId, operation) => {
    if (operation.type === 'record_receipt') {
      current = { ...current, modelReservation: undefined, latestReceipt: operation.receipt }
    } else if (operation.type === 'reserve_model') {
      current = {
        ...current,
        modelReservation: current.modelReservation ?? { id: operation.id, maxCostMicros: operation.maxCostMicros },
      }
    } else if (operation.type === 'set_compaction') {
      current = { ...current, compaction: operation.compaction }
    }
    return current
  })
  mocks.wait.mockResolvedValue(true)
  mocks.stream
    .mockRejectedValueOnce(new Error('free summary stream aborted'))
    .mockImplementationOnce(async () => {
      current = { ...current, modelReservation: undefined }
      return { steps: [{ text: 'A'.repeat(250), finishReason: 'stop' }] }
    })
  const prepare = vi.fn(async (request: {
    modelId: string
    receiptId: string
    purpose: 'response' | 'summary' | 'verification'
    options: import('@ai-sdk/provider').LanguageModelV4CallOptions
  }): Promise<PreparedHarnessModel> => {
    if (request.purpose === 'summary') {
      current = {
        ...current,
        modelReservation: {
          id: request.receiptId,
          maxCostMicros: 0,
          dispatch: { modelId: request.modelId, billingReservationId: null },
        },
      }
    }
    return {
      model: {} as HarnessModelReference,
      options: { prompt: [] },
      contextWindow: 32_000,
      estimatedCostMicros: 0,
    }
  })
  const ports = createHarnessModelPorts({
    reference, modelId: 'openrouter/free', contextBudgetTokens: 16_000, prepare,
  })

  await expect(ports.prepareModel!({
    receiptId: 'response:1',
    state: current,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Old request '.repeat(4_000) }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Old answer '.repeat(4_000) }] },
      { role: 'user', content: [{ type: 'text', text: 'Continue with the current request.' }] },
    ],
    instructionContext: { surfaceInstructions: 'Surface instructions' },
    toolNames: [],
    toolDefinitions: [],
    settings: { maxOutputTokens: 512 },
  } as never)).rejects.toThrow()

  expect(mocks.apply.mock.calls.some(([, , operation]) => operation.type === 'record_receipt')).toBe(false)
  expect(mocks.stream).toHaveBeenCalledTimes(1)
  expect(current.modelReservation?.id).toBe('summary:response:1:0')
})

test('an unsettled billed summary hold survives pause and resumes only after its receipt arrives', async () => {
  const receiptId = 'summary:response:2:0'
  let current: HarnessSnapshot = {
    ...runningState(),
    workflowRunId: 'workflow',
    latestReceipt: undefined,
    modelReservation: {
      id: receiptId, maxCostMicros: 500,
      dispatch: { modelId: 'openrouter/free', billingReservationId: 'billing-hold' },
    },
    compaction: {
      cycleId: receiptId, attemptId: receiptId, status: 'awaiting_reconciliation',
      retryCount: 0, failureReason: 'hold_unsettled', updatedAt: 1,
    },
  }
  mocks.read.mockImplementation(async () => current)
  mocks.apply.mockImplementation(async (_reference, _operationId, operation) => {
    if (operation.type === 'set_compaction') current = { ...current, compaction: operation.compaction }
    return current
  })
  mocks.wait.mockResolvedValue(true)
  const prepare = vi.fn(async (request: {
    modelId: string
    receiptId: string
    purpose: 'response' | 'summary' | 'verification'
    options: import('@ai-sdk/provider').LanguageModelV4CallOptions
  }): Promise<PreparedHarnessModel> => {
    if (request.purpose === 'summary') {
      current = {
        ...current,
        modelReservation: {
          id: request.receiptId,
          maxCostMicros: 500,
          dispatch: { modelId: request.modelId, billingReservationId: 'billing-hold' },
        },
      }
    }
    return {
      model: {} as HarnessModelReference,
      options: { prompt: [] },
      contextWindow: 32_000,
      estimatedCostMicros: 500,
    }
  })
  const ports = createHarnessModelPorts({
    reference, modelId: 'openrouter/free', contextBudgetTokens: 16_000, prepare,
  })
  const request = {
    receiptId: 'response:2',
    state: current,
    messages: [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'Old request '.repeat(4_000) }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Old answer '.repeat(4_000) }] },
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'Continue with the current request.' }] },
    ],
    instructionContext: { surfaceInstructions: 'Surface instructions' },
    toolNames: [] as string[],
    toolDefinitions: [],
    settings: { maxOutputTokens: 512 },
  }

  await expect(ports.prepareModel!(request as never)).rejects.toThrow()
  expect(current.modelReservation?.id).toBe(receiptId)
  expect(current.compaction?.status).toBe('awaiting_reconciliation')
  expect(mocks.stream).not.toHaveBeenCalled()
  expect(prepare).not.toHaveBeenCalled()

  current = {
    ...current,
    modelReservation: undefined,
    latestReceipt: {
      id: receiptId, modelId: 'openrouter/free', provider: 'provider',
      inputTokens: 10, outputTokens: 10, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: 32_000, costMicros: 500,
    },
  }
  mocks.stream.mockImplementationOnce(async () => {
    current = { ...current, modelReservation: undefined }
    return { steps: [{ text: 'A'.repeat(250), finishReason: 'stop' }] }
  })
  await expect(ports.prepareModel!(request as never)).resolves.toMatchObject({ activeToolNames: [] })
  expect(prepare.mock.calls.filter(([item]) => item.purpose === 'summary').map(([item]) => item.receiptId))
    .toEqual([`${receiptId}:retry:1`])
  expect(mocks.stream).toHaveBeenCalledOnce()
  expect(current.compaction).toMatchObject({
    cycleId: receiptId,
    attemptId: `${receiptId}:retry:1`,
    status: 'completed',
    retryCount: 1,
  })
})

test('an interrupted summary resumes through prepareModel with its canonical cycle identity', async () => {
  const cycleId = 'summary:response:resume'
  const retryId = `${cycleId}:retry:1`
  let current: HarnessSnapshot = {
    ...runningState(),
    workflowRunId: 'workflow',
    modelReservation: undefined,
    latestReceipt: undefined,
    compaction: {
      cycleId, attemptId: cycleId, status: 'interrupted',
      retryCount: 0, failureReason: 'provider_error', updatedAt: 1,
    },
  }
  mocks.read.mockImplementation(async () => current)
  mocks.apply.mockImplementation(async (_reference, _operationId, operation) => {
    if (operation.type === 'reserve_model') {
      current = {
        ...current,
        modelReservation: current.modelReservation ?? {
          id: operation.id, maxCostMicros: operation.maxCostMicros,
        },
      }
    } else if (operation.type === 'set_compaction') {
      current = { ...current, compaction: operation.compaction }
    } else if (operation.type === 'checkpoint') {
      current = { ...current, workingSummary: operation.summary }
    }
    return current
  })
  mocks.stream.mockImplementationOnce(async () => {
    current = { ...current, modelReservation: undefined }
    return { steps: [{ text: 'A'.repeat(250), finishReason: 'stop' }] }
  })
  const prepare = vi.fn(async (request: {
    modelId: string
    receiptId: string
    purpose: 'response' | 'summary' | 'verification'
    options: import('@ai-sdk/provider').LanguageModelV4CallOptions
  }): Promise<PreparedHarnessModel> => {
    if (request.purpose === 'summary') {
      current = {
        ...current,
        modelReservation: {
          id: request.receiptId,
          maxCostMicros: 0,
          dispatch: { modelId: request.modelId, billingReservationId: null },
        },
      }
    }
    return {
      model: {} as HarnessModelReference,
      options: { prompt: [] },
      contextWindow: 32_000,
      estimatedCostMicros: 0,
    }
  })
  const ports = createHarnessModelPorts({
    reference, modelId: 'openrouter/free', contextBudgetTokens: 16_000, prepare,
  })

  await expect(ports.prepareModel!({
    receiptId: 'response:resume',
    state: current,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Old request '.repeat(4_000) }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Old answer '.repeat(4_000) }] },
      { role: 'user', content: [{ type: 'text', text: 'Continue with the current request.' }] },
    ],
    instructionContext: { surfaceInstructions: 'Surface instructions' },
    toolNames: [],
    toolDefinitions: [],
    settings: { maxOutputTokens: 512 },
  } as never)).resolves.toMatchObject({ activeToolNames: [] })

  expect(prepare.mock.calls.filter(([item]) => item.purpose === 'summary').map(([item]) => item.receiptId))
    .toEqual([retryId])
  expect(current.compaction).toMatchObject({
    cycleId,
    attemptId: retryId,
    status: 'completed',
    retryCount: 1,
  })
})

test('settled summary failures cannot dispatch beyond the two total attempts', async () => {
  const cycleId = 'summary:response:bounded:0'
  let current: HarnessSnapshot = {
    ...runningState(),
    workflowRunId: 'workflow',
    modelReservation: undefined,
    latestReceipt: undefined,
    compaction: undefined,
  }
  mocks.read.mockImplementation(async () => current)
  mocks.wait.mockResolvedValue(true)
  mocks.apply.mockImplementation(async (_reference, _operationId, operation) => {
    if (operation.type === 'reserve_model') {
      current = {
        ...current,
        modelReservation: {
          id: operation.id,
          maxCostMicros: operation.maxCostMicros,
          dispatch: { modelId: 'openrouter/free', billingReservationId: null },
        },
      }
    } else if (operation.type === 'record_receipt') {
      current = { ...current, modelReservation: undefined, latestReceipt: operation.receipt }
    } else if (operation.type === 'set_compaction') {
      current = { ...current, compaction: operation.compaction }
    }
    return current
  })
  mocks.stream.mockImplementation(async () => {
    const id = current.modelReservation!.id
    current = { ...current, modelReservation: undefined, latestReceipt: { id, modelId: 'fixture/model',
      provider: 'fixture', inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, contextWindow: 32_000, costMicros: 1, costSource: 'catalog' } }
    throw new Error('summary provider failed after measured settlement')
  })
  const prepare = vi.fn(async (request: {
    modelId: string
    receiptId: string
    purpose: 'response' | 'summary' | 'verification'
    options: import('@ai-sdk/provider').LanguageModelV4CallOptions
  }): Promise<PreparedHarnessModel> => ({
    model: {} as HarnessModelReference,
    options: { prompt: [] },
    contextWindow: 32_000,
    estimatedCostMicros: request.purpose === 'summary' ? 0 : 0,
  }))
  const ports = createHarnessModelPorts({
    reference, modelId: 'openrouter/free', contextBudgetTokens: 16_000, prepare,
  })

  await expect(ports.prepareModel!({
    receiptId: 'response:bounded',
    state: current,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Old request '.repeat(4_000) }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Old answer '.repeat(4_000) }] },
      { role: 'user', content: [{ type: 'text', text: 'Continue with the current request.' }] },
    ],
    instructionContext: { surfaceInstructions: 'Surface instructions' },
    toolNames: [],
    toolDefinitions: [],
    settings: { maxOutputTokens: 512 },
  } as never)).resolves.toMatchObject({ activeToolNames: [] })

  expect(prepare.mock.calls.filter(([item]) => item.purpose === 'summary').map(([item]) => item.receiptId))
    .toEqual([cycleId, `${cycleId}:retry:1`])
  expect(mocks.stream).toHaveBeenCalledTimes(2)
  expect(prepare.mock.calls.some(([item]) => item.receiptId.includes(':retry:1:retry:1'))).toBe(false)
})

test('a reopened media artifact is reused when a later tool result prepares the next prompt', async () => {
  const artifactId = `ha_${'a'.repeat(64)}`
  const metadata = {
    artifactId, runId: reference.runId, workflowRunId: reference.workflowRunId,
    toolCallId: 'render-1', toolName: 'render_document', digest: 'b'.repeat(64),
    storageId: 'storage-1', byteSize: 5, mediaPartCount: 1, createdAt: 1, expiresAt: 2,
    resource: { id: 'file-1', revision: 'rev-7', operation: 'render', page: 3 },
  }
  mocks.read.mockResolvedValue(runningState())
  mocks.readArtifactMetadata.mockResolvedValue(metadata)
  const prepare = vi.fn(async (): Promise<PreparedHarnessModel> => ({
    model: {} as HarnessModelReference, options: { prompt: [] }, contextWindow: 32_000, estimatedCostMicros: 0,
  }))
  const ports = createHarnessModelPorts({ reference, modelId: 'openrouter/free', prepare })
  const encoded = Buffer.from(new Uint8Array([0, 1, 255])).toString('base64')
  const messages = [
    { role: 'assistant' as const, content: [{
      type: 'tool-call' as const, toolCallId: 'reopen-1', toolName: 'harness_read_artifact',
      input: { artifactId, mediaPart: 0 },
    }] },
    { role: 'tool' as const, content: [{
      type: 'tool-result' as const, toolCallId: 'reopen-1', toolName: 'harness_read_artifact',
      output: { type: 'content', value: [{ type: 'file', mediaType: 'image/png', data: { type: 'data', data: encoded } }] },
    }] },
    { role: 'assistant' as const, content: [{
      type: 'tool-call' as const, toolCallId: 'later-read', toolName: 'read_document', input: { fileId: 'file-1' },
    }] },
    { role: 'tool' as const, content: [{
      type: 'tool-result' as const, toolCallId: 'later-read', toolName: 'read_document',
      output: { type: 'text', value: 'Read revision rev-7, page 3.' },
    }] },
  ]

  const prepared = await ports.prepareModel!({
    receiptId: 'response:artifact-reread', state: runningState(), messages: messages as never,
    instructionContext: { surfaceInstructions: 'Surface instructions' }, toolNames: [], toolDefinitions: [],
    settings: { maxOutputTokens: 512 },
  })

  expect(prepared.messages[0]).toEqual(messages[0])
  expect(prepared.messages[2]).toEqual(messages[2])
  expect(prepare).toHaveBeenCalledOnce()
  const responsePrompt = prepare.mock.calls[0]?.[0]?.options.prompt
  expect(JSON.stringify(responsePrompt)).toContain(artifactId)
  expect(JSON.stringify(responsePrompt)).toContain('file-1 revision rev-7 page 3')
  expect(JSON.stringify(responsePrompt)).not.toContain(encoded)
  expect(mocks.storeArtifact).not.toHaveBeenCalled()
  expect(mocks.identifyArtifact).not.toHaveBeenCalled()
})

test('artifact upload failure leaves the original large tool context intact', async () => {
  const state = runningState()
  mocks.read.mockResolvedValue(state)
  mocks.identifyArtifact.mockResolvedValue({ digest: 'b'.repeat(64), artifactId: `ha_${'b'.repeat(64)}` })
  mocks.storeArtifact.mockRejectedValue(new Error('storage unavailable'))
  const prepare = vi.fn()
  const ports = createHarnessModelPorts({ reference, modelId: 'openrouter/free', prepare })
  const messages = [
    { role: 'tool' as const, content: [{
      type: 'tool-result' as const, toolCallId: 'large-read', toolName: 'read_document',
      output: { type: 'text', value: 'Large source content '.repeat(2_000) },
    }] },
  ]
  const original = JSON.stringify(messages)

  await expect(ports.prepareModel!({
    receiptId: 'response:artifact-failure', state, messages: messages as never,
    instructionContext: { surfaceInstructions: 'Surface instructions' }, toolNames: [], toolDefinitions: [],
    settings: { maxOutputTokens: 512 },
  })).rejects.toThrow()

  expect(JSON.stringify(messages)).toBe(original)
  expect(mocks.storeArtifact).toHaveBeenCalledOnce()
  expect(prepare).not.toHaveBeenCalled()
})

test('response preparation failures escape without an artifact-unavailable block', async () => {
  const state = runningState()
  mocks.read.mockResolvedValue(state)
  const sentinel = new Error('response preparation sentinel')
  const prepare = vi.fn(async (request: {
    purpose: 'response' | 'summary' | 'verification'
  }): Promise<PreparedHarnessModel> => {
    if (request.purpose === 'response') throw sentinel
    return {
      model: {} as HarnessModelReference,
      options: { prompt: [] },
      contextWindow: 32_000,
      estimatedCostMicros: 0,
    }
  })
  const ports = createHarnessModelPorts({ reference, modelId: 'openrouter/free', prepare })

  await expect(ports.prepareModel!({
    receiptId: 'response:prepare-sentinel',
    state,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Short request.' }] }],
    instructionContext: { surfaceInstructions: 'Surface instructions' },
    toolNames: [],
    toolDefinitions: [],
    settings: { maxOutputTokens: 512 },
  } as never)).rejects.toBe(sentinel)

  expect(mocks.apply.mock.calls.some(([, operationId, operation]) => (
    operationId === 'artifact-unavailable:response:prepare-sentinel' && operation.type === 'block'
  ))).toBe(false)
})

test('verifier abort preserves billed and zero-cost unknown holds without synthetic receipts', async () => {
  for (const billable of [false, true]) {
    let current: HarnessSnapshot = {
      ...runningState(),
      workflowRunId: 'workflow',
      evidence: [{
        id: 'tool:read:1', kind: 'tool_result', source: 'read_document',
        summary: 'Read revision rev-7.', verdict: 'observed', createdAt: 1,
      }],
      modelReservation: undefined,
    }
    mocks.read.mockImplementation(async () => current)
    mocks.apply.mockImplementation(async (_reference, _operationId, operation) => {
      if (operation.type === 'reserve_model') current = {
        ...current,
        modelReservation: {
          id: operation.id,
          maxCostMicros: billable ? 500 : 0,
          dispatch: { modelId: 'openrouter/free', billingReservationId: billable ? 'billing-hold' : null },
        },
      }
      if (operation.type === 'record_receipt') {
        current = { ...current, modelReservation: undefined, latestReceipt: operation.receipt }
      }
      return current
    })
    mocks.stream.mockRejectedValue(new Error('validator stream aborted'))
    const prepare = vi.fn(async (): Promise<PreparedHarnessModel> => ({
      model: {} as HarnessModelReference,
      options: { prompt: [] },
      contextWindow: 32_000,
      estimatedCostMicros: billable ? 500 : 0,
    }))
    const ports = createHarnessModelPorts({ reference, modelId: 'openrouter/free', prepare })
    const verify = ports.verifyFinalAnswer!({ state: current, candidate: 'The document was read.' })
    await expect(verify).rejects.toThrow()
    expect(current.modelReservation?.id).toMatch(/^verification:/)
    expect(mocks.apply.mock.calls.some(([, , operation]) => operation.type === 'record_receipt')).toBe(false)
    vi.clearAllMocks()
    mocks.agentOptions.length = 0
  }
})
