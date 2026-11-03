import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionReference } from './state-steps'
import type { HarnessModelReference } from './secure-model'
import { createHarnessModelPorts } from './model-ports'

const mocks = vi.hoisted(() => ({ read: vi.fn(), wait: vi.fn(), reset: vi.fn(), recovery: vi.fn(), limits: vi.fn(), compact: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read, applyHarnessOperation: vi.fn() }))
vi.mock('./model-capacity', () => ({
  createHarnessCapacityWaiter: () => ({ wait: mocks.wait, reset: mocks.reset }),
}))
vi.mock('./model-recovery', () => ({ waitForHarnessModelRecovery: mocks.recovery }))
vi.mock('./model-preparation', () => ({ readHarnessModelLimits: mocks.limits }))
vi.mock('@/server/chat/context-compaction-core', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/chat/context-compaction-core')>(),
  compactHarnessPrompt: mocks.compact,
}))

const reference = {} as HarnessExecutionReference

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

test('model preparation reuses the boundary state and reads catalog limits once per model', async () => {
  const state = stateWithInterruptionCount(0)
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
