import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentRunMetricsReport } from './agent-run-metrics'
import type { AgentRun } from './agent-run'

function run(overrides: Partial<AgentRun>): AgentRun {
  return {
    id: 'run',
    conversationId: 'conversation',
    turnId: 'turn',
    userId: 'user',
    userMessageId: 'user-message',
    assistantMessageId: 'assistant-message',
    mode: 'chat',
    runner: 'tool_loop',
    status: 'completed',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  }
}

test('reports runner metrics with explicit denominators and no recommendation', () => {
  const report = buildAgentRunMetricsReport({
    from: 0,
    to: 10_000,
    generatedAt: 10_000,
    runs: [
      run({
        id: 'chat',
        completedAt: 3_000,
        metrics: {
          firstTokenAt: 1_250,
          providerCostMicros: 42,
          toolCallCount: 2,
          toolSuccessCount: 1,
          toolFailureCount: 1,
          toolRetryCount: 1,
          browserDisconnectedAt: 1_500,
          cancellationRequestedAt: 1_900,
          cancellationAcknowledgedAt: 1_940,
        },
      }),
      run({
        id: 'work',
        mode: 'work',
        runner: 'workflow',
        completedAt: 5_000,
        metrics: {
          workflowStepCount: 8,
          workflowRetryCount: 1,
          workflowObservedStorageBytes: 2_048,
          processFailureDetectedAt: 2_000,
          processFailureRecoveredAt: 2_500,
        },
      }),
    ],
  })

  assert.equal(report.runners.tool_loop.firstTokenLatencyMs.p50, 250)
  assert.equal(report.runners.tool_loop.totalCompletionLatencyMs.p50, 2_000)
  assert.deepEqual(report.runners.tool_loop.toolSuccess, { samples: 2, successes: 1, rate: 0.5 })
  assert.deepEqual(report.runners.tool_loop.toolRetry, { samples: 2, successes: 1, rate: 0.5 })
  assert.equal(report.runners.workflow.firstTokenLatencyMs.samples, 0)
  assert.equal(report.runners.workflow.workflowStepCount.p50, 8)
  assert.equal(report.runners.workflow.processFailureRecovery.rate, 1)
  assert.equal('recommendation' in report, false)
})
