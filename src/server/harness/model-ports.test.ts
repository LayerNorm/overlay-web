import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessExecutionReference } from './state-steps'
import type { HarnessModelReference } from './secure-model'
import { createHarnessModelPorts } from './model-ports'

const mocks = vi.hoisted(() => ({ read: vi.fn(), recovery: vi.fn(), limits: vi.fn(), compact: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./state-steps', () => ({ readHarnessState: mocks.read, applyHarnessOperation: vi.fn() }))
vi.mock('./model-recovery', async importOriginal => ({
  ...await importOriginal<typeof import('./model-recovery')>(), waitForHarnessModelRecovery: mocks.recovery,
}))
vi.mock('./model-preparation', () => ({ readHarnessModelLimits: mocks.limits }))
vi.mock('@/server/chat/context-compaction-core', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/chat/context-compaction-core')>(),
  compactHarnessPrompt: mocks.compact,
}))

const reference = {} as HarnessExecutionReference

beforeEach(() => vi.resetAllMocks())

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
