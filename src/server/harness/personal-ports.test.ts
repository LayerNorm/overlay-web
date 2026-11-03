import { beforeEach, expect, test, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import * as state from '@overlay/agent-runtime/harness-state'
import type { HarnessOperation } from '@overlay/agent-runtime/harness-store'
import { KIMI_K3_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { admitPersonalHarnessExecution, createPersonalHarnessExecutionPorts } from './personal-ports'
import { createPersonalHarnessModelPorts } from './personal-model-ports'
import { createHarnessModelPorts } from './model-ports'
import { runOverlayHarness } from './runner'
import { estimateHarnessInputTokens } from './model-forecast'

const mocks = vi.hoisted(() => ({ read: vi.fn(), apply: vi.fn(), claim: vi.fn(), refresh: vi.fn(), catalog: vi.fn(),
  model: vi.fn(), authorize: vi.fn(), settle: vi.fn(), admit: vi.fn(),
   sleep: vi.fn(), attach: vi.fn(), recordUsage: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('workflow', async importOriginal => {
  const actual = await importOriginal<typeof import('workflow')>()
  return { ...actual, sleep: mocks.sleep }
})
vi.mock('./personal-access', () => ({ refreshPersonalHarnessAccess: mocks.refresh }))
vi.mock('./personal-delivery-attach', () => ({ attachPersonalDelivery: mocks.attach }))
vi.mock('./request-usage', () => ({ recordHarnessRequestUsage: mocks.recordUsage }))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalogModel: mocks.catalog }))
vi.mock('@/server/ai/model-runtime', () => ({ getLanguageModel: mocks.model }))
vi.mock('./personal-model-dispatch', () => ({ authorizePersonalHarnessModelDispatch: mocks.authorize }))
vi.mock('./settle-model-step', () => ({ settleHarnessModelUsage: mocks.settle }))
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

test('combined personal admission renews authority before recording the request', async () => {
  await admitPersonalHarnessExecution({ access, context }, { attachDelivery: true })
  expect(mocks.attach).toHaveBeenCalledExactlyOnceWith(access)
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(access, context, undefined, { renewalMode: true, renewLease: true })
  expect(mocks.recordUsage).toHaveBeenCalledExactlyOnceWith(access, context.effectiveModelId)
  expect(mocks.attach.mock.invocationCallOrder[0]).toBeLessThan(mocks.refresh.mock.invocationCallOrder[0])
  expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.recordUsage.mock.invocationCallOrder[0])
})

test('combined child admission does not attach root delivery or count a rejected request', async () => {
  mocks.refresh.mockRejectedValueOnce(new Error('Access revoked'))
  await expect(admitPersonalHarnessExecution({ access, context }, { attachDelivery: false })).rejects.toThrow('Access revoked')
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(mocks.recordUsage).not.toHaveBeenCalled()
})

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

test('an ambiguous provider error retains its hold and never tries another model', async () => {
  const failed = new MockLanguageModelV4({ doStream: async () => { throw new Error('Network timeout') } })
  mocks.model.mockResolvedValue(failed)
  const ports = createPersonalHarnessExecutionPorts({ access, context }, surface)
  await expect(runOverlayHarness(execution, ports)).rejects.toThrow('Network timeout')
  expect(mocks.model).toHaveBeenCalledOnce()
  expect(current.modelReservation?.dispatch?.modelId).toBe('fixture/model')
})

test('Kimi K3 reasoning is prepared for the selected model', async () => {
  const selectedContext = { ...context, effectiveModelId: KIMI_K3_MODEL_ID }
  const ports = createPersonalHarnessModelPorts({ access, context: selectedContext })
  const prepared = await ports.prepareModel({
    receiptId: 'model:0',
    state: current,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Check the requested result.' }] }],
    instructionContext: { instructions: 'Check the requested result.', continuation: false, truncatedResponse: false },
    toolNames: [],
    toolDefinitions: [],
    settings: { maxOutputTokens: 100, reasoning: 'low' },
  })

  expect(prepared.model?.modelId).toBe(KIMI_K3_MODEL_ID)
  expect(prepared.settings?.reasoning).toBe('xhigh')
  expect(mocks.refresh).toHaveBeenCalledWith(access, expect.objectContaining({ effectiveModelId: KIMI_K3_MODEL_ID }),
    undefined, { renewalMode: true, renewLease: true })
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sleep.mockResolvedValue(undefined)
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
})

function provider(finishReason: 'stop' | 'length' = 'stop', failSummary = false, summaryText?: string | (() => string)) {
  const model = new MockLanguageModelV4({ doStream: async () => {
    if (failSummary && current.modelReservation?.id.startsWith('summary:')) throw new Error('Summary stream aborted.')
    const text = current.modelReservation?.id.startsWith('summary:')
      ? (typeof summaryText === 'function' ? summaryText() : summaryText) ?? 'Earlier records were read. Do not publish. Verify the final result. The user asked to check the supplied records and preserve the original constraints. No external changes were made. Confirm each result before reporting it, and use the persisted observations as the source of truth.'
      : 'The observations are checked.'
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

async function prepareModelWithSummary(summaryText: string, receiptId: string) {
  const model = provider('stop', false, summaryText)
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 128_000, maxTokens: 8_192 })
  const prepare = vi.fn(async ({ modelId, receiptId: callReceiptId, options }: {
    modelId: string
    receiptId: string
    purpose: 'response' | 'summary'
    options: LanguageModelV4CallOptions
  }) => preparedHarnessModel(modelId, callReceiptId, options, 128_000))
  const originalMessages = compactableHistory()
  const ports = createHarnessModelPorts({
    reference: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' },
    modelId: 'fixture/model',
    contextBudgetTokens: 8_192,
    prepare,
  })
  const result = await ports.prepareModel({
    receiptId,
    state: current,
    messages: originalMessages,
    instructionContext: { instructions: execution.instructions, continuation: false, truncatedResponse: false },
    toolNames: [],
    toolDefinitions: [],
    settings: { maxOutputTokens: 512 },
  })
  return { model, originalMessages, prepare, result }
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
  expect(mocks.sleep).not.toHaveBeenCalled()
})

test('settled empty summaries retry with durable backoff before compacting or dispatching the response', async () => {
  let summaries = 0
  const model = provider('stop', false, () => ++summaries <= 2 ? ''
    : 'Earlier records were read. Do not publish. Verify the final result. The user asked to check the supplied records and preserve the original constraints. No external changes were made. Confirm each result before reporting it, and use the persisted observations as the source of truth.')
  const delays: number[] = []
  mocks.sleep.mockImplementation(async (until: Date) => {
    expect(current.workingSummary).toBe('')
    expect(current.modelReservation).toBeUndefined()
    expect(current.summaryRecovery?.receiptId).toBe(current.latestReceipt?.id)
    expect(current.summaryRecovery?.attempt).toBe(delays.length + 1)
    delays.push(until.getTime() - current.updatedAt)
  })
  const ports = createPersonalHarnessExecutionPorts({ access, context, contextBudgetTokens: 8_192 }, surface)
  const result = await runOverlayHarness({ ...execution, messages: history() }, ports)
  expect(result.snapshot.status).toBe('completed')
  expect(delays).toEqual([5_000, 10_000])
  const receiptIds = mocks.settle.mock.calls.map(([call]) => call.receiptId)
  expect(receiptIds.slice(0, 3)).toEqual(['summary:model:0:0', 'summary:model:0:0:retry:1', 'summary:model:0:0:retry:2'])
  expect(new Set(receiptIds).size).toBe(receiptIds.length)
  expect(receiptIds.filter(id => !id.startsWith('summary:'))).toEqual(['model:0'])
  expect(result.snapshot.usage.costMicros).toBe(receiptIds.length * 120)
  expect(result.snapshot.summaryRecovery).toBeUndefined()
  expect(result.snapshot.workingSummary).toContain('Do not publish')
  expect(model.doStreamCalls).toHaveLength(receiptIds.length)
  expect(mocks.admit).toHaveBeenCalledOnce()
})

test('provider-variable compaction settles actual usage before reserving the response', async () => {
  const modelId = 'fixture/provider-priced-compaction'
  const model = provider()
  mocks.catalog.mockResolvedValue({ gatewayId: modelId, type: 'language', contextWindow: 64_000, maxTokens: 1_000,
    pricing: { input: '0.0000000001', output: '0.0000000001', varies_by_provider: true } })
  const endpoint = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: {
    id: modelId, endpoints: [{ pricing: { prompt: '0.000002', completion: '0.000008' } }],
  } })))
  const settled: { id: string; reserved: number; actual: number }[] = []
  mocks.settle.mockImplementation(async ({ receiptId, observation, contextWindow }) => {
    const reserved = current.modelReservation!.maxCostMicros
    const actual = observation.inputTokens * 2 + observation.outputTokens * 8
    expect(current.modelReservation?.id).toBe(receiptId)
    expect(reserved).toBeGreaterThanOrEqual(actual)
    current = state.recordHarnessReceipt(current, { ...observation, id: receiptId, contextWindow,
      costMicros: actual, costSource: 'provider' }, Date.now())
    settled.push({ id: receiptId, reserved, actual })
    return current.latestReceipt
  })
  try {
    const ports = createPersonalHarnessExecutionPorts({ access, context: { ...context, effectiveModelId: modelId },
      contextBudgetTokens: 8_192 }, surface)
    const result = await runOverlayHarness({ ...execution, model: { ...execution.model, modelId }, messages: history() }, ports)
    expect(result.snapshot.status).toBe('completed')
    expect(settled.length).toBeGreaterThan(1)
    expect(settled.slice(0, -1).every(receipt => receipt.id.startsWith('summary:model:0:'))).toBe(true)
    expect(settled.at(-1)?.id).toBe('model:0')
    expect(settled).toHaveLength(model.doStreamCalls.length)
    expect(result.snapshot.usage.costMicros).toBe(settled.reduce((sum, receipt) => sum + receipt.actual, 0))
    expect(result.snapshot.modelReservation).toBeUndefined()
    expect(result.snapshot.workingSummary).toContain('Do not publish')
    expect(endpoint).toHaveBeenCalledOnce()
    expect(mocks.admit).toHaveBeenCalledOnce()
  } finally {
    endpoint.mockRestore()
  }
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

test.each([
  ['a short summary', ' '.concat('x'.repeat(199), ' ')],
  ['a User Safety classifier response', `User Safety: safe\n${'Useful continuity details remain in the supplied history. '.repeat(5)}`],
  ['a Response Safety classifier response', `Response Safety: safe\n${'Useful continuity details remain in the supplied history. '.repeat(5)}`],
])('%s uses the settled-summary fallback when history fits', async (_label, summaryText) => {
  const { model, originalMessages, prepare, result } = await prepareModelWithSummary(summaryText, 'model:summary-quality-rejected')

  expect(result.messages).toHaveLength(originalMessages.length)
  expect(current.modelReservation).toBeUndefined()
  expect(current.latestReceipt?.id).toMatch(/^summary:model:summary-quality-rejected:/)
  expect(current.latestReceipt?.rejectionReason).toBeUndefined()
  expect(prepare.mock.calls.filter(([request]) => request.purpose === 'response')).toHaveLength(1)
  expect(model.doStreamCalls).toHaveLength(1)
})

test('a 200-character summary remains accepted', async () => {
  const summaryText = 'x'.repeat(200)
  const { originalMessages, result } = await prepareModelWithSummary(summaryText, 'model:summary-quality-accepted')

  expect(current.workingSummary).toBe(summaryText)
  expect(result.messages.length).toBeLessThan(originalMessages.length)
  expect(current.modelReservation).toBeUndefined()
  expect(current.latestReceipt?.rejectionReason).toBeUndefined()
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

test.each(['openrouter/free', 'overlay-free'])('an ambiguous %s summary keeps its reservation without fabricating a zero-cost receipt', async modelId => {
  const model = provider('stop', true)
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 128_000, maxTokens: 8_192 })
  const prepare = vi.fn(async ({ modelId, receiptId, options }) => ({
    ...preparedHarnessModel(modelId, receiptId, options, 128_000),
    estimatedCostMicros: 0,
  }))
  const originalMessages = compactableHistory()
  const ports = createHarnessModelPorts({
    reference: { actorUserId: 'user', runId: 'run', workflowRunId: 'workflow' },
    modelId,
    contextBudgetTokens: 8_192,
    prepare,
  })
  await expect(ports.prepareModel({
    receiptId: 'model:free-summary-fallback', state: current, messages: originalMessages,
    instructionContext: { instructions: execution.instructions, continuation: false, truncatedResponse: false },
    toolNames: [], toolDefinitions: [], settings: { maxOutputTokens: 512 },
  })).rejects.toThrow(/safely compacted/)
  expect(current.modelReservation).toMatchObject({
    id: expect.stringMatching(/^summary:model:free-summary-fallback:/), maxCostMicros: 0,
    dispatch: { modelId },
  })
  expect(current.latestReceipt).toBeUndefined()
  expect(mocks.settle).not.toHaveBeenCalled()
  expect(prepare.mock.calls.filter(([request]) => request.purpose === 'response')).toHaveLength(0)
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
