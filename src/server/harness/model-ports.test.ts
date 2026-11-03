import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionReference } from './state-steps'
import type { HarnessModelReference } from './secure-model'
import type { PreparedHarnessModel } from './model-ports'
import { HARNESS_ANSWER_VERIFICATION_INSTRUCTIONS } from './continuity-policy'
import { createHarnessModelPorts } from './model-ports'

const mocks = vi.hoisted(() => ({
  read: vi.fn(), wait: vi.fn(), reset: vi.fn(), recovery: vi.fn(), apply: vi.fn(),
  stream: vi.fn(), agentOptions: [] as Array<Record<string, unknown>>,
  identifyArtifact: vi.fn(), storeArtifact: vi.fn(), readArtifactMetadata: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('./state-steps', () => ({
  readHarnessState: mocks.read, applyHarnessOperation: mocks.apply,
  readHarnessModelLimits: vi.fn(),
}))
vi.mock('./model-capacity', () => ({
  createHarnessCapacityWaiter: () => ({ wait: mocks.wait, reset: mocks.reset }),
}))
vi.mock('./model-recovery', () => ({
  waitForHarnessModelRecovery: mocks.recovery,
  HarnessYield: class extends Error {},
}))
vi.mock('./model-preparation', () => ({ readHarnessModelLimits: vi.fn(async () => ({
  contextWindow: 32_000, maxOutputTokens: 2_000,
})) }))
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

function stateWithInterruptionCount(routeInterruptionCount: number) {
  return {
    ...createHarnessSnapshot({
      runId: 'run',
      goal: 'Retry an interrupted free stream.',
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
    routeInterruptionCount,
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
  vi.resetAllMocks()
  mocks.agentOptions.length = 0
})

test('legacy interruption snapshots without recovery metadata keep the two-attempt limit', async () => {
  for (const count of [1, 2, 3]) {
    const onFallback = vi.fn()
    mocks.read.mockResolvedValue(stateWithInterruptionCount(count))
    const ports = createHarnessModelPorts({
      reference,
      modelId: 'openrouter/free',
      prepare: async () => ({
        model: {} as HarnessModelReference,
        options: { prompt: [] },
        contextWindow: null,
        estimatedCostMicros: 0,
      }),
    }, { candidateIds: ['openrouter/free', 'fixture/fallback'], onFallback })

    expect(await ports.recoverModelFailure('model:0')).toBe(count <= 2)
    expect(onFallback).not.toHaveBeenCalled()
  }
  expect(mocks.wait).not.toHaveBeenCalled()
})

test.each(['route_interrupted', 'route_unavailable'] as const)('routes persisted %s recovery beyond the legacy limit through the durable waiter', async code => {
  const onFallback = vi.fn()
  const state = {
    ...stateWithInterruptionCount(3),
    latestReceipt: { ...stateWithInterruptionCount(3).latestReceipt, rejectionReason: code },
    modelRecovery: {
      receiptId: 'model:0',
      modelId: 'openrouter/free',
      code,
      attempt: 3,
      firstFailureAt: 1,
      nextRetryAt: 5_001,
    },
  }
  mocks.read.mockResolvedValue(state)
  mocks.recovery.mockResolvedValue(true)
  const ports = createHarnessModelPorts({
    reference,
    modelId: 'openrouter/free',
    prepare: async () => ({
      model: {} as HarnessModelReference,
      options: { prompt: [] },
      contextWindow: null,
      estimatedCostMicros: 0,
    }),
  }, { candidateIds: ['openrouter/free', 'fixture/fallback'], onFallback })

  expect(await ports.recoverModelFailure('model:0')).toBe(true)
  expect(mocks.recovery).toHaveBeenCalledExactlyOnceWith(reference, 'model:0')
  expect(mocks.wait).not.toHaveBeenCalled()
  expect(onFallback).not.toHaveBeenCalled()
})

test('does not route unavailable receipts without a durable retry schedule to a fallback model', async () => {
  const onFallback = vi.fn()
  const state = {
    ...stateWithInterruptionCount(0),
    latestReceipt: { ...stateWithInterruptionCount(0).latestReceipt, rejectionReason: 'route_unavailable' as const },
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
  }, { candidateIds: ['openrouter/free', 'fixture/fallback'], onFallback })

  expect(await ports.recoverModelFailure('model:0')).toBe(false)
  expect(mocks.recovery).not.toHaveBeenCalled()
  expect(onFallback).not.toHaveBeenCalled()
})

test('final verification is separately metered, tool-disabled, and validated against current-run evidence', async () => {
  const state = {
    ...stateWithInterruptionCount(0),
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
      text: '{"supported":true,"reason":"The answer matches page 1.","evidenceIds":["tool:read-current"]}',
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

test('an aborted exact free summary hold is reconciled once before one bounded retry', async () => {
  let current: HarnessSnapshot = {
    ...stateWithInterruptionCount(0),
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
  } as never)).resolves.toMatchObject({
    activeToolNames: [],
  })

  const receipts = mocks.apply.mock.calls
    .filter(([, , operation]) => operation.type === 'record_receipt')
    .map(([, , operation]) => operation)
  expect(receipts, JSON.stringify(mocks.apply.mock.calls.map(([, operationId, operation]) => ({
    operationId, type: operation.type,
  })))).toHaveLength(1)
  expect(receipts[0]).toMatchObject({
    receipt: { id: 'summary:response:1:0', rejectionReason: 'summary_failed', costMicros: 0 },
  })
  expect(mocks.stream).toHaveBeenCalledTimes(2)
  expect(prepare.mock.calls.filter(([request]) => request.purpose === 'summary')).toHaveLength(2)
  expect(current.compaction).toMatchObject({ status: 'completed', retryCount: 1 })
})

test('an unsettled billed summary hold survives pause and resumes only after its receipt arrives', async () => {
  const receiptId = 'summary:response:2:0'
  let current: HarnessSnapshot = {
    ...stateWithInterruptionCount(0),
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
})

test('a reopened media artifact is reused when a later tool result prepares the next prompt', async () => {
  const artifactId = `ha_${'a'.repeat(64)}`
  const metadata = {
    artifactId, runId: reference.runId, workflowRunId: reference.workflowRunId,
    toolCallId: 'render-1', toolName: 'render_document', digest: 'b'.repeat(64),
    storageId: 'storage-1', byteSize: 5, mediaPartCount: 1, createdAt: 1, expiresAt: 2,
    resource: { id: 'file-1', revision: 'rev-7', operation: 'render', page: 3 },
  }
  mocks.read.mockResolvedValue(stateWithInterruptionCount(0))
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
    receiptId: 'response:artifact-reread', state: stateWithInterruptionCount(0), messages: messages as never,
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
  const state = stateWithInterruptionCount(0)
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

test('verifier abort reconciles only an exact free hold and preserves billed holds', async () => {
  for (const billable of [false, true]) {
    let current: HarnessSnapshot = {
      ...stateWithInterruptionCount(0),
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
    if (billable) {
      await expect(verify).rejects.toThrow()
      expect(current.modelReservation?.id).toMatch(/^verification:/)
      expect(mocks.apply.mock.calls.some(([, , operation]) => operation.type === 'record_receipt')).toBe(false)
    } else {
      await expect(verify).resolves.toMatchObject({ supported: false })
      expect(current.modelReservation).toBeUndefined()
      expect(current.latestReceipt).toMatchObject({ rejectionReason: 'verification_failed', costMicros: 0 })
    }
    vi.clearAllMocks()
    mocks.agentOptions.length = 0
  }
})
