import type { AgentRun, AgentRunRunner } from './agent-run'

export type NumericObservation = {
  samples: number
  mean: number | null
  p50: number | null
  p95: number | null
}

export type RateObservation = {
  samples: number
  successes: number
  rate: number | null
}

export type AgentRunRunnerMetrics = {
  runs: number
  firstTokenLatencyMs: NumericObservation
  totalCompletionLatencyMs: NumericObservation
  providerCostMicrosPerTurn: NumericObservation
  workflowStepCount: NumericObservation
  workflowRetryCount: NumericObservation
  workflowObservedStorageBytes: NumericObservation
  workflowInfrastructureCostMicros: NumericObservation
  browserDisconnectCompletion: RateObservation
  processFailureRecovery: RateObservation
  toolSuccess: RateObservation
  toolRetry: RateObservation
  cancellationLatencyMs: NumericObservation
  staleRunFrequency: RateObservation
}

export type AgentRunMetricsReport = {
  generatedAt: number
  truncated: boolean
  window: { from: number; to: number }
  runners: Record<AgentRunRunner, AgentRunRunnerMetrics>
  caveats: string[]
}

function numeric(values: number[]): NumericObservation {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (sorted.length === 0) return { samples: 0, mean: null, p50: null, p95: null }
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]!
  return {
    samples: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
  }
}

function rate(samples: boolean[]): RateObservation {
  const successes = samples.filter(Boolean).length
  return rateCounts(samples.length, successes)
}

function rateCounts(samples: number, successes: number): RateObservation {
  return {
    samples,
    successes,
    rate: samples > 0 ? successes / samples : null,
  }
}

function forRunner(runs: AgentRun[], runner: AgentRunRunner): AgentRunRunnerMetrics {
  const selected = runs.filter((run) => run.runner === runner)
  const withMetrics = selected.filter((run) => run.metrics)
  const toolOutcomeCounts = withMetrics.reduce((counts, run) => ({
    samples: counts.samples + (run.metrics?.toolSuccessCount ?? 0) + (run.metrics?.toolFailureCount ?? 0),
    successes: counts.successes + (run.metrics?.toolSuccessCount ?? 0),
  }), { samples: 0, successes: 0 })
  const toolRetryCounts = withMetrics.reduce((counts, run) => {
    const calls = run.metrics?.toolCallCount ?? 0
    return {
      samples: counts.samples + calls,
      successes: counts.successes + Math.min(calls, run.metrics?.toolRetryCount ?? 0),
    }
  }, { samples: 0, successes: 0 })

  return {
    runs: selected.length,
    firstTokenLatencyMs: numeric(selected.flatMap((run) =>
      run.metrics?.firstTokenAt === undefined ? [] : [Math.max(0, run.metrics.firstTokenAt - run.createdAt)])),
    totalCompletionLatencyMs: numeric(selected.flatMap((run) =>
      run.completedAt === undefined ? [] : [Math.max(0, run.completedAt - run.createdAt)])),
    providerCostMicrosPerTurn: numeric(withMetrics.flatMap((run) =>
      run.metrics?.providerCostMicros === undefined ? [] : [run.metrics.providerCostMicros])),
    workflowStepCount: numeric(withMetrics.flatMap((run) =>
      run.metrics?.workflowStepCount === undefined ? [] : [run.metrics.workflowStepCount])),
    workflowRetryCount: numeric(withMetrics.flatMap((run) =>
      run.metrics?.workflowRetryCount === undefined ? [] : [run.metrics.workflowRetryCount])),
    workflowObservedStorageBytes: numeric(withMetrics.flatMap((run) =>
      run.metrics?.workflowObservedStorageBytes === undefined ? [] : [run.metrics.workflowObservedStorageBytes])),
    workflowInfrastructureCostMicros: numeric([]),
    browserDisconnectCompletion: rate(selected
      .filter((run) => run.metrics?.browserDisconnectedAt !== undefined)
      .map((run) => run.status === 'completed' && (run.completedAt ?? 0) >= run.metrics!.browserDisconnectedAt!)),
    processFailureRecovery: rate(selected
      .filter((run) => run.metrics?.processFailureDetectedAt !== undefined)
      .map((run) => run.metrics?.processFailureRecoveredAt !== undefined)),
    toolSuccess: rateCounts(toolOutcomeCounts.samples, toolOutcomeCounts.successes),
    toolRetry: rateCounts(toolRetryCounts.samples, toolRetryCounts.successes),
    cancellationLatencyMs: numeric(selected.flatMap((run) => {
      const requested = run.metrics?.cancellationRequestedAt
      const acknowledged = run.metrics?.cancellationAcknowledgedAt
      return requested === undefined || acknowledged === undefined ? [] : [Math.max(0, acknowledged - requested)]
    })),
    staleRunFrequency: rate(selected.map((run) => run.metrics?.staleDetectedAt !== undefined)),
  }
}

export function buildAgentRunMetricsReport(args: {
  from: number
  generatedAt?: number
  runs: AgentRun[]
  to: number
  truncated?: boolean
}): AgentRunMetricsReport {
  return {
    generatedAt: args.generatedAt ?? Date.now(),
    truncated: args.truncated ?? false,
    window: { from: args.from, to: args.to },
    runners: {
      tool_loop: forRunner(args.runs, 'tool_loop'),
      workflow: forRunner(args.runs, 'workflow'),
    },
    caveats: [
      'Work first-token latency has zero samples while Work mode uses final-only WorkflowAgent output.',
      'Workflow observed storage bytes measure serialized run steps and events visible at finalization; they are not provider-billed bytes.',
      'Workflow infrastructure cost remains zero-sample until hosting invoices expose a per-run allocation.',
      'Process-failure recovery is counted only when a failure is explicitly detected and a recovery is explicitly acknowledged.',
      'Browser disconnects are observed from page lifecycle events; abrupt network loss cannot always deliver the disconnect event.',
    ],
  }
}
