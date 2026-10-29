import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionReference } from './state-steps'
import type { HarnessModelReference } from './secure-model'
import { createHarnessModelPorts } from './model-ports'

const mocks = vi.hoisted(() => ({ read: vi.fn(), wait: vi.fn(), reset: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read, applyHarnessOperation: vi.fn() }))
vi.mock('./model-capacity', () => ({
  createHarnessCapacityWaiter: () => ({ wait: mocks.wait, reset: mocks.reset }),
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

test('retries the same free model immediately twice and rejects the third interruption', async () => {
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
