import { beforeEach, expect, test, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import * as state from '@overlay/agent-runtime/harness-state'
import type { HarnessOperation } from '@overlay/agent-runtime/harness-store'
import { KIMI_K3_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { createPersonalHarnessExecutionPorts } from './personal-ports'
import { createPersonalHarnessModelPorts } from './personal-model-ports'
import { createHarnessModelPorts } from './model-ports'
import { runOverlayHarness } from './runner'
import { estimateHarnessInputTokens } from './model-forecast'

const mocks = vi.hoisted(() => ({ read: vi.fn(), apply: vi.fn(), claim: vi.fn(), refresh: vi.fn(), catalog: vi.fn(),
  model: vi.fn(), authorize: vi.fn(), settle: vi.fn(), releaseSummary: vi.fn(), admit: vi.fn(), capacity: vi.fn(), capacityReset: vi.fn() }))
vi.mock('./model-capacity', () => ({ createHarnessCapacityWaiter: () => ({ wait: mocks.capacity, reset: mocks.capacityReset }) }))
vi.mock('server-only', () => ({}))
vi.mock('./personal-access', () => ({ refreshPersonalHarnessAccess: mocks.refresh }))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalogModel: mocks.catalog }))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: mocks.model }))
vi.mock('./personal-model-dispatch', () => ({ authorizePersonalHarnessModelDispatch: mocks.authorize }))
vi.mock('./settle-model-step', () => ({ settleHarnessModelUsage: mocks.settle, releaseFreeSummaryFailure: mocks.releaseSummary }))
vi.mock('./request-usage-step', () => ({ admitHarnessRequestUsage: mocks.admit }))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read, applyHarnessOperation: mocks.apply,
  claimHarnessState: mocks.claim,
}))
vi.mock('./state-ports', () => ({
  createHarnessStatePorts: (reference: unknown) => ({ read: mocks.read, claim: mocks.claim,
    apply: (id: string, operation: unknown) => mocks.apply(reference, id, operation), readEvidence: async () => null }),
}))

const access = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow', conversationId: 'conversation', agentRunId: 'delivery',
  workspaceId: 'workspace', principalId: 'principal', authentication: { type: 'session' as const } }
const context = { userId: 'user', workspaceId: 'workspace', conversationId: 'conversation', effectiveModelId: 'fixture/model',
  baseUrl: 'https://example.test', memoryEnabled: true, requestedToolIds: [], turnId: 'turn', requestFingerprint: 'request' }
const execution = { instructions: 'Read the requested records.', messages: [{ role: 'user' as const, content: 'Check the observations, but do not publish.' }],
  tools: {}, model: { modelId: 'fixture/model', credentialOwnerId: 'user' }, settings: { maxOutputTokens: 100 } }
const surface = { recordToolResult: vi.fn(), delegate: vi.fn(), readChild: vi.fn(), waitForChildren: vi.fn(), waitForInput: vi.fn(), waitForApproval: vi.fn() }
let current: HarnessSnapshot

function preparedHarnessModel(modelId: string, receiptId: string, options: LanguageModelV4CallOptions, contextWindow: number) {
  return {
    model: {
      modelId,
      credentialOwnerId: 'user',
      personal: {
        access,
        receiptId,
        memoryEnabled: true,
        requestFingerprint: 'request',
        inputTokenBudget: contextWindow,
        maxOutputTokens: options.maxOutputTokens ?? 0,
        contextWindow,
      },
    },
    options: { ...options, providerOptions: { gateway: { zeroDataRetention: true } } },
    contextWindow,
    estimatedCostMicros: 100,
  }
}

test('shared model preparation delegates surface authority without requiring personal context', async () => {
  const reference = { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' }
  const prepare = vi.fn(async ({ modelId, options }) => ({
    model: { modelId, credentialOwnerId: 'user' }, options, contextWindow: 64_000, estimatedCostMicros: 100,
  }))
  const ports = createHarnessModelPorts({ reference, modelId: 'fixture/model', prepare })
  const result = await ports.prepareModel({
    receiptId: 'model:0', state: current,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Check observations.' }] }],
    instructionContext: { instructions: 'Check observations.', continuation: false, truncatedResponse: false },
    toolNames: [], toolDefinitions: [], settings: { maxOutputTokens: 100 },
  })
  expect(prepare).toHaveBeenCalledExactlyOnceWith({
    modelId: 'fixture/model', receiptId: 'model:0', purpose: 'response',
    options: expect.objectContaining({ maxOutputTokens: 100, tools: [], prompt: expect.any(Array) }),
  })
  expect(result.model).toEqual({ modelId: 'fixture/model', credentialOwnerId: 'user' })
  expect(result.estimatedCostMicros).toBe(100)
  expect(mocks.refresh).not.toHaveBeenCalled()
})

test('a confirmed rejection continues through the SDK with a fresh candidate and receipt, admitting only one request', async () => {
  provider()
  const onFallback = vi.fn()
  mocks.authorize.mockImplementationOnce(async reference => {
    current = state.recordHarnessReceipt(current, { id: reference.personal.receiptId, modelId: reference.modelId,
      provider: 'overlay-admission', inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, contextWindow: 64_000, costMicros: 0, costSource: 'catalog', rejectionReason: 'budget' }, Date.now())
    throw new Error('Budget declined before provider dispatch.')
  })
  const ports = createPersonalHarnessExecutionPorts({ access, context }, surface,
    { candidateIds: ['fixture/model', 'fixture/fallback'], onFallback })
  const result = await runOverlayHarness(execution, ports)
  expect(result.snapshot.status).toBe('completed')
  expect(onFallback).toHaveBeenCalledExactlyOnceWith({ from: 'fixture/model', to: 'fixture/fallback', receiptId: 'model:0', reason: 'budget' })
  expect(mocks.model).toHaveBeenCalledExactlyOnceWith('fixture/fallback', undefined, 'user', expect.objectContaining({ allowLowBalanceFallback: false }))
  expect(mocks.refresh).toHaveBeenCalledWith(access, expect.objectContaining({ effectiveModelId: 'fixture/fallback' }))
  expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ receiptId: 'model:1' }))
  expect(mocks.admit).toHaveBeenCalledOnce()
  expect(current.modelReservation).toBeUndefined()
})

test('an ambiguous provider error retains its hold and never tries another model', async () => {
  const onFallback = vi.fn()
  const failed = new MockLanguageModelV4({ doStream: async () => { throw new Error('Network timeout') } })
  mocks.model.mockResolvedValue(failed)
  const ports = createPersonalHarnessExecutionPorts({ access, context }, surface,
    { candidateIds: ['fixture/model', 'fixture/fallback'], onFallback })
  await expect(runOverlayHarness(execution, ports)).rejects.toThrow('Network timeout')
  expect(mocks.model).toHaveBeenCalledOnce()
  expect(current.modelReservation?.dispatch?.modelId).toBe('fixture/model')
  expect(onFallback).not.toHaveBeenCalled()
})

test('confirmed capacity rejection resumes the same free model with a fresh receipt and one admission', async () => {
  provider()
  const onFallback = vi.fn()
  const freeContext = { ...context, effectiveModelId: 'openrouter/free' }
  mocks.refresh.mockImplementation(async (_access, supplied) => ({ ...supplied, requiresZeroDataRetention: false }))
  mocks.capacity.mockResolvedValue(true)
  mocks.authorize.mockImplementation(async reference => {
    current = state.bindHarnessModelDispatch(current, reference.personal.receiptId, { modelId: reference.modelId, billingReservationId: null }, Date.now())
  }).mockImplementationOnce(async reference => {
    current = state.recordHarnessReceipt(current, { id: reference.personal.receiptId, modelId: reference.modelId,
      provider: 'overlay-free-router', inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, contextWindow: null, costMicros: 0, costSource: 'catalog', rejectionReason: 'route_capacity' }, Date.now())
    throw new Error('Confirmed capacity rejection before inference.')
  })
  mocks.settle.mockImplementation(async ({ receiptId, observation, contextWindow }) => {
    current = state.recordHarnessReceipt(current, { ...observation, id: receiptId, contextWindow, costMicros: 0, costSource: 'provider' }, Date.now())
    return current.latestReceipt
  })
  const ports = createPersonalHarnessExecutionPorts({ access, context: freeContext }, surface,
    { candidateIds: ['openrouter/free'], onFallback })
  const result = await runOverlayHarness({ ...execution, model: { ...execution.model, modelId: 'openrouter/free' } }, ports)
  expect(result.snapshot.status).toBe('completed')
  expect(mocks.capacity).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'model:0', 'openrouter/free')
  expect(mocks.model).toHaveBeenCalledExactlyOnceWith('openrouter/free', undefined, 'user', expect.objectContaining({ allowLowBalanceFallback: false }))
  expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ receiptId: 'model:1' }))
  expect(mocks.admit).toHaveBeenCalledOnce()
  expect(onFallback).not.toHaveBeenCalled()
  expect(current.modelReservation).toBeUndefined()
})

test('BYOK routing cannot acquire an Overlay-funded fallback', () => {
  expect(() => createPersonalHarnessExecutionPorts({ access, context: { ...context, effectiveModelId: 'byok/key/model' } }, surface,
    { candidateIds: ['byok/key/model', 'fixture/model'] })).toThrow('Invalid admitted model routing')
})

test('Kimi K3 reasoning is prepared for the active fallback candidate', async () => {
  const ports = createPersonalHarnessModelPorts({ access, context }, {
    candidateIds: ['fixture/model', KIMI_K3_MODEL_ID],
  })
  current = state.recordHarnessReceipt(current, {
    id: 'model:0',
    modelId: 'fixture/model',
    provider: 'overlay-admission',
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextWindow: 64_000,
    costMicros: 0,
    costSource: 'catalog',
    rejectionReason: 'budget',
  }, Date.now())
  expect(await ports.recoverModelFailure?.('model:0')).toBe(true)
  const prepared = await ports.prepareModel({
    receiptId: 'model:1',
    state: current,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Check the requested result.' }] }],
    instructionContext: { instructions: 'Check the requested result.', continuation: false, truncatedResponse: false },
    toolNames: [],
    toolDefinitions: [],
    settings: { maxOutputTokens: 100, reasoning: 'low' },
  })

  expect(prepared.model?.modelId).toBe(KIMI_K3_MODEL_ID)
  expect(prepared.settings?.reasoning).toBe('xhigh')
  expect(mocks.refresh).toHaveBeenCalledWith(access, expect.objectContaining({ effectiveModelId: KIMI_K3_MODEL_ID }))
})

beforeEach(() => {
  vi.resetAllMocks()
  current = state.claimHarnessExecution(state.createHarnessSnapshot({ runId: 'run', goal: 'Check observations', constraints: ['Do not publish'], policy: {
    actorUserId: 'user', workspaceId: 'workspace', requiresPlan: false, allowedToolIds: [], maxCostMicros: 1_000_000,
    deadlineAt: Date.now() + 60_000, maxDepth: 1, maxParallelChildren: 2,
  } }, Date.now()), 'workflow', Date.now())
  mocks.claim.mockResolvedValue(true)
  mocks.read.mockImplementation(async () => current)
  mocks.refresh.mockImplementation(async (_access, supplied) => ({ ...supplied, requiresZeroDataRetention: true }))
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 64_000, maxTokens: 1_000,
    pricing: { input: '0.000001', output: '0.000002' } })
  mocks.apply.mockImplementation(async (_reference, _id, operation: HarnessOperation) => {
    if (operation.type === 'reserve_model') current = state.reserveHarnessModel(current, operation.id, operation.maxCostMicros, Date.now())
    else if (operation.type === 'checkpoint') current = state.checkpointHarness(current, operation.summary, Date.now())
    else if (operation.type === 'record_receipt') current = state.recordHarnessReceipt(current, operation.receipt, Date.now())
    else if (operation.type === 'finish') current = state.finishHarness(current, Date.now())
    else throw new Error(`Unexpected operation: ${operation.type}`)
    return current
  })
  mocks.authorize.mockImplementation(async (reference, options) => {
    expect(estimateHarnessInputTokens(options, reference.personal.contextWindow)).toBeLessThanOrEqual(reference.personal.inputTokenBudget)
    expect(options.maxOutputTokens).toBe(reference.personal.maxOutputTokens)
    expect(options.providerOptions.gateway.zeroDataRetention).toBe(true)
    expect(current.modelReservation?.id).toBe(reference.personal.receiptId)
    current = state.bindHarnessModelDispatch(current, reference.personal.receiptId, {
      modelId: reference.modelId, billingReservationId: reference.modelId === 'openrouter/free' ? null : 'billing',
    }, Date.now())
  })
  mocks.settle.mockImplementation(async ({ receiptId, observation, contextWindow }) => {
    current = state.recordHarnessReceipt(current, { ...observation, id: receiptId, contextWindow, costMicros: 120, costSource: 'provider' }, Date.now())
    return current.latestReceipt
  })
  mocks.releaseSummary.mockImplementation(async ({ receiptId, modelId, contextWindow }) => {
    if (current.modelReservation?.id !== receiptId || current.modelReservation.maxCostMicros !== 0) return
    current = state.recordHarnessReceipt(current, {
      id: receiptId, modelId, provider: 'overlay-free-router', inputTokens: 0, outputTokens: 0,
      reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow,
      costMicros: 0, costSource: 'catalog', rejectionReason: 'summary_failed',
    }, Date.now())
  })
})

function provider(finishReason: 'stop' | 'length' = 'stop', failSummary = false) {
  const model = new MockLanguageModelV4({ doStream: async () => {
    if (failSummary && current.modelReservation?.id.startsWith('summary:')) throw new Error('Summary stream aborted.')
    const text = current.modelReservation?.id.startsWith('summary:') ? 'Earlier records were read. Do not publish. Verify the final result.' : 'The observations are checked.'
    const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: text }, { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: { unified: finishReason, raw: finishReason },
        usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } }]
    return { stream: new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close() } }) }
  } })
  mocks.model.mockResolvedValue(model)
  return model
}

function history() {
  return [...execution.messages, ...Array.from({ length: 8 }, () => ({ role: 'assistant' as const, content: 'Prior observation. '.repeat(180) })),
    { role: 'assistant' as const, content: 'The records are ready to compare.' },
    { role: 'assistant' as const, content: 'Check the final result without publishing.' }]
}

function compactableHistory() {
  return history().map(message => ({
    role: message.role,
    content: [{ type: 'text' as const, text: message.content }],
  }))
}

test('real SDK dispatch receives the quoted instructions, schemas, output cap and ZDR settings, with one root admission', async () => {
  const model = provider()
  const ports = createPersonalHarnessExecutionPorts({ access, context }, surface)
  const result = await runOverlayHarness(execution, ports)
  expect(result.snapshot.status).toBe('completed')
  expect(model.doStreamCalls).toHaveLength(1)
  expect(model.doStreamCalls[0].prompt.filter(message => message.role === 'system')).toHaveLength(1)
  expect(model.doStreamCalls[0].tools?.map(tool => tool.name)).toContain('harness_set_plan')
  expect(mocks.admit).toHaveBeenCalledExactlyOnceWith(access, 'fixture/model')
  expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ receiptId: 'model:0', contextWindow: 64_000 }))
  expect(mocks.admit.mock.invocationCallOrder[0]).toBeLessThan(mocks.authorize.mock.invocationCallOrder[0])
  expect(current.modelReservation).toBeUndefined()
})

test('compaction uses separately reserved and settled SDK calls before the main quote, without extra request admission', async () => {
  const model = provider()
  const ports = createPersonalHarnessExecutionPorts({ access, context, contextBudgetTokens: 8_192 }, surface)
  const result = await runOverlayHarness({ ...execution, messages: history() }, ports)
  expect(result.snapshot.status).toBe('completed')
  expect(result.snapshot.workingSummary).toContain('Do not publish')
  expect(model.doStreamCalls.length).toBeGreaterThan(1)
  expect(mocks.settle.mock.calls.slice(0, -1).every(([call]) => call.receiptId.startsWith('summary:model:0:'))).toBe(true)
  expect(mocks.settle.mock.calls.at(-1)?.[0].receiptId).toBe('model:0')
  expect(JSON.stringify(model.doStreamCalls.at(-1)?.prompt)).toContain(result.snapshot.workingSummary)
  expect(JSON.stringify(model.doStreamCalls.at(-1)?.prompt)).not.toContain('Prior observation. '.repeat(10))
  expect(mocks.admit).toHaveBeenCalledTimes(1)
  expect(mocks.settle).toHaveBeenCalledTimes(model.doStreamCalls.length)
  expect(current.modelReservation).toBeUndefined()
})

test('a failed summary with an unsettled reservation cannot dispatch the main call', async () => {
  const model = provider()
  mocks.settle.mockRejectedValue(new Error('Billing unavailable'))
  const ports = createPersonalHarnessExecutionPorts({ access, context, contextBudgetTokens: 8_192 }, surface)
  await expect(runOverlayHarness({ ...execution, messages: history() }, ports)).rejects.toThrow(/safely compacted/)
  expect(model.doStreamCalls).toHaveLength(1)
  expect(current.workingSummary).toBe('')
  expect(current.modelReservation?.dispatch).toBeDefined()
})

test('summary calls reserve reasoning headroom while the prompt retains the summary target', async () => {
  const model = provider()
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 128_000, maxTokens: 8_192 })
  const prepare = vi.fn(async ({ modelId, receiptId, options }) => preparedHarnessModel(modelId, receiptId, options, 128_000))
  const ports = createHarnessModelPorts({
    reference: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' },
    modelId: 'fixture/model',
    contextBudgetTokens: 8_192,
    prepare,
  })
  await ports.prepareModel({
    receiptId: 'model:summary-headroom', state: current, messages: compactableHistory(),
    instructionContext: { instructions: execution.instructions, continuation: false, truncatedResponse: false },
    toolNames: [], toolDefinitions: [], settings: { maxOutputTokens: 512 },
  })

  const summaryRequest = prepare.mock.calls.find(([request]) => request.purpose === 'summary')?.[0]
  expect(summaryRequest).toBeDefined()
  const targetSummaryTokens = Number(JSON.stringify(summaryRequest!.options.prompt).match(/Target length: at most (\d+) tokens/)?.[1])
  const expectedOutputTokens = Math.min(8_192, targetSummaryTokens + 2_048)
  expect(summaryRequest!.options.maxOutputTokens).toBe(expectedOutputTokens)
  expect(expectedOutputTokens).toBeGreaterThan(targetSummaryTokens)
  expect(JSON.stringify(summaryRequest!.options.prompt)).toContain(`at most ${targetSummaryTokens} tokens`)
  expect(model.doStreamCalls[0]?.maxOutputTokens).toBe(expectedOutputTokens)
})

test('a failed summary falls back to uncompacted history when it fits the real model window', async () => {
  const model = provider('length')
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 128_000, maxTokens: 20_000 })
  const prepare = vi.fn(async ({ modelId, receiptId, options }) => preparedHarnessModel(modelId, receiptId, options, 128_000))
  const originalMessages = compactableHistory()
  const ports = createHarnessModelPorts({
    reference: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' },
    modelId: 'fixture/model',
    contextBudgetTokens: 8_192,
    prepare,
  })
  const result = await ports.prepareModel({
    receiptId: 'model:fallback-fit', state: current, messages: originalMessages,
    instructionContext: { instructions: execution.instructions, continuation: false, truncatedResponse: false },
    toolNames: [], toolDefinitions: [], settings: { maxOutputTokens: 12_000 },
  })

  const responseRequest = prepare.mock.calls.find(([request]) => request.purpose === 'response')?.[0]
  expect(responseRequest?.options.maxOutputTokens).toBe(12_000)
  expect(result.messages).toHaveLength(originalMessages.length)
  expect(result.settings?.maxOutputTokens).toBe(12_000)
  expect(model.doStreamCalls).toHaveLength(1)
  expect(current.modelReservation).toBeUndefined()
})

test('a failed zero-cost free summary releases its reservation and falls back to full history', async () => {
  const model = provider('stop', true)
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 128_000, maxTokens: 8_192 })
  const prepare = vi.fn(async ({ modelId, receiptId, options }) => ({
    ...preparedHarnessModel(modelId, receiptId, options, 128_000),
    estimatedCostMicros: 0,
  }))
  const originalMessages = compactableHistory()
  const ports = createHarnessModelPorts({
    reference: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' },
    modelId: 'openrouter/free',
    contextBudgetTokens: 8_192,
    prepare,
  })
  const result = await ports.prepareModel({
    receiptId: 'model:free-summary-fallback', state: current, messages: originalMessages,
    instructionContext: { instructions: execution.instructions, continuation: false, truncatedResponse: false },
    toolNames: [], toolDefinitions: [], settings: { maxOutputTokens: 512 },
  })
  expect(mocks.releaseSummary).toHaveBeenCalledWith(expect.objectContaining({
    receiptId: expect.stringMatching(/^summary:model:free-summary-fallback:/), modelId: 'openrouter/free',
  }))
  expect(current.modelReservation).toBeUndefined()
  expect(current.latestReceipt).toMatchObject({ rejectionReason: 'summary_failed', inputTokens: 0, outputTokens: 0 })
  expect(result.messages).toHaveLength(originalMessages.length)
  expect(prepare.mock.calls.filter(([request]) => request.purpose === 'response')).toHaveLength(1)
  expect(model.doStreamCalls).toHaveLength(1)
})

test('a failed summary remains fatal when the uncompacted prompt exceeds the real model window', async () => {
  const model = provider('length')
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 8_192, maxTokens: 8_192 })
  const prepare = vi.fn(async ({ modelId, receiptId, options }) => preparedHarnessModel(modelId, receiptId, options, 8_192))
  const ports = createHarnessModelPorts({
    reference: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' },
    modelId: 'fixture/model',
    contextBudgetTokens: 8_192,
    prepare,
  })
  await expect(ports.prepareModel({
    receiptId: 'model:fallback-too-large', state: current,
    messages: [{ role: 'assistant', content: [{ type: 'text' as const, text: 'Large history '.repeat(10_000) }] }],
    instructionContext: { instructions: execution.instructions, continuation: false, truncatedResponse: false },
    toolNames: [], toolDefinitions: [], settings: { maxOutputTokens: 8_000 },
  })).rejects.toThrow(/safely compacted/)
  expect(prepare).not.toHaveBeenCalled()
  expect(model.doStreamCalls).toHaveLength(0)
})

test('a failed summary remains fatal while its model reservation is pending', async () => {
  const model = provider('length')
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 128_000, maxTokens: 8_192 })
  mocks.settle.mockImplementationOnce(async () => undefined)
  const prepare = vi.fn(async ({ modelId, receiptId, options }) => preparedHarnessModel(modelId, receiptId, options, 128_000))
  const ports = createHarnessModelPorts({
    reference: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' },
    modelId: 'fixture/model',
    contextBudgetTokens: 8_192,
    prepare,
  })
  await expect(ports.prepareModel({
    receiptId: 'model:fallback-pending', state: current, messages: compactableHistory(),
    instructionContext: { instructions: execution.instructions, continuation: false, truncatedResponse: false },
    toolNames: [], toolDefinitions: [], settings: { maxOutputTokens: 512 },
  })).rejects.toThrow(/safely compacted/)
  expect(prepare.mock.calls.filter(([request]) => request.purpose === 'response')).toHaveLength(0)
  expect(current.modelReservation).toBeDefined()
  expect(model.doStreamCalls).toHaveLength(1)
})

test('failed ownership does not authorize or admit another request', async () => {
  mocks.claim.mockResolvedValue(false)
  const result = await runOverlayHarness(execution, createPersonalHarnessExecutionPorts({ access, context }, surface))
  expect(result.outcome).toBe('already_running')
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(mocks.admit).not.toHaveBeenCalled()
})
