import { expect, test } from 'vitest'
import { createHarnessSnapshot, recordHarnessEvidence } from '@overlay/agent-runtime/harness-state'
import { buildNativeHarnessDelivery, nativeHarnessToolMetrics } from './native-tool-metrics'

test('native metrics count persisted non-control tool results and classify failures', () => {
  const evidence = Array.from({ length: 10 }, (_, index) => ({
    id: `tool:call-${index}`,
    kind: 'tool_result' as const,
    source: 'workspace_tool',
    summary: `Result ${index}`,
    verdict: index === 9 ? 'failed' as const : 'observed' as const,
    createdAt: index,
  }))
  evidence.push({
    id: 'child-result:read-child',
    kind: 'tool_result',
    source: 'harness_read_child',
    summary: 'Child result',
    verdict: 'observed',
    createdAt: 11,
  })

  let snapshot = createHarnessSnapshot({
    runId: 'run',
    goal: 'Create the requested records.',
    constraints: [],
    policy: {
      actorUserId: 'user',
      allowedToolIds: [],
      requiresPlan: false,
      deadlineAt: 1_000,
      maxCostMicros: 0,
      maxParallelChildren: 1,
      maxDepth: 1,
    },
  }, 1)
  for (const item of evidence) snapshot = recordHarnessEvidence(snapshot, item, item.createdAt)

  const metrics = nativeHarnessToolMetrics(snapshot)
  expect(metrics).toEqual({
    toolCallCount: 10,
    toolSuccessCount: 9,
    toolFailureCount: 1,
  })
  const delivery = buildNativeHarnessDelivery({ outcome: 'finished', snapshot, messages: [], steps: [] })
  expect(delivery.metrics).toMatchObject(metrics)
})
