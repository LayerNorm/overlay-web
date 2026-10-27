import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { buildPersonalHarnessDelivery } from './personal-delivery'
import type { HarnessExecutionResult } from './runner'

export function nativeHarnessToolMetrics(snapshot: Pick<HarnessSnapshot, 'evidence'>) {
  const executions = snapshot.evidence.filter(evidence => evidence.kind === 'tool_result' && evidence.id.startsWith('tool:'))
  return {
    toolCallCount: executions.length,
    toolSuccessCount: executions.filter(evidence => evidence.verdict !== 'failed').length,
    toolFailureCount: executions.filter(evidence => evidence.verdict === 'failed').length,
  }
}

export function buildNativeHarnessDelivery(result: HarnessExecutionResult, fallbackNotices: string[] = []) {
  const delivery = buildPersonalHarnessDelivery(result, undefined, fallbackNotices)
  return {
    ...delivery,
    metrics: { ...delivery.metrics, ...nativeHarnessToolMetrics(result.snapshot) },
  }
}
