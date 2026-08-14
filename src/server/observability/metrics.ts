import 'server-only'

import { getObservabilityContext } from './context'
import { getPostHogClient } from './posthog-server'

/**
 * Infrastructure metrics emission for the BFF, Postgres, Convex, and model
 * context layers.  Events use the `overlay.metrics.*` namespace so they can
 * be filtered separately from product analytics events in PostHog.
 *
 * All emission is fire-and-forget — a metrics failure must never break a
 * customer-facing request.
 */

/** Whether metrics emission is enabled.  Gated by the analytics feature flag. */
function metricsEnabled(): boolean {
  try {
    return Boolean(getPostHogClient())
  } catch (_error) {
    return false
  }
}

/** Common properties attached to every metrics event. */
function baseProperties(): Record<string, unknown> {
  return getObservabilityContext()
}

// ---------------------------------------------------------------------------
// BFF request metrics
// ---------------------------------------------------------------------------

export type BffRequestMetric = {
  route: string
  method: string
  statusCode: number
  durationMs: number
  authType: 'api-key' | 'service' | 'session' | 'access-token' | 'anonymous'
  workspaceId?: string
  /** Response body size in bytes (approximated from Content-Length when available). */
  responseBytes?: number
  /** Present when the request was rate-limited (429). */
  retryAfterMs?: number
  /** Whether the request was served from an idempotency cache hit. */
  idempotent?: boolean
}

export function captureBffRequestMetric(metric: BffRequestMetric): void {
  if (!metricsEnabled()) return
  try {
    const posthog = getPostHogClient()!
    posthog.capture({
      distinctId: 'system',
      event: 'overlay.metrics.bff_request',
      properties: {
        ...baseProperties(),
        ...metric,
      },
    })
  } catch (_error) {
    // metrics must never break the request
  }
}

// ---------------------------------------------------------------------------
// Postgres query metrics
// ---------------------------------------------------------------------------

export type PostgresQueryMetric = {
  operation: 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction'
  durationMs: number
  rowsReturned?: number
  /** Whether the query was retried due to a transient error. */
  retried?: boolean
}

export function capturePostgresQueryMetric(metric: PostgresQueryMetric): void {
  if (!metricsEnabled()) return
  try {
    const posthog = getPostHogClient()!
    posthog.capture({
      distinctId: 'system',
      event: 'overlay.metrics.postgres_query',
      properties: {
        ...baseProperties(),
        ...metric,
      },
    })
  } catch (_error) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Convex function metrics (emitted from the BFF after Convex calls return)
// ---------------------------------------------------------------------------

export type ConvexFunctionMetric = {
  functionName: string
  durationMs: number
  /** Number of documents read (when measurable from the BFF boundary). */
  docsRead?: number
  /** Number of documents written (when measurable from the BFF boundary). */
  docsWritten?: number
  /** Approximate response payload size in bytes. */
  responseBytes?: number
}

export function captureConvexFunctionMetric(metric: ConvexFunctionMetric): void {
  if (!metricsEnabled()) return
  try {
    const posthog = getPostHogClient()!
    posthog.capture({
      distinctId: 'system',
      event: 'overlay.metrics.convex_function',
      properties: {
        ...baseProperties(),
        ...metric,
      },
    })
  } catch (_error) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Model token breakdown
// ---------------------------------------------------------------------------

export type ModelTokenBreakdownMetric = {
  runId: string
  modelId: string
  userId: string
  /** Tokens attributable to conversation history. */
  historyTokens: number
  /** Tokens attributable to injected memories. */
  memoryTokens: number
  /** Tokens attributable to skill instructions. */
  skillTokens: number
  /** Tokens attributable to tool definitions. */
  toolTokens: number
  /** Tokens attributable to attachment/document context. */
  attachmentTokens: number
  /** Tokens attributable to system prompt and misc context. */
  systemTokens: number
  /** Total input tokens reported by the provider. */
  totalInputTokens: number
  /** Total output tokens reported by the provider. */
  totalOutputTokens: number
  /** Provider cost in microdollars. */
  providerCostMicros?: number
}

export function captureModelTokenBreakdown(metric: ModelTokenBreakdownMetric): void {
  if (!metricsEnabled()) return
  try {
    const posthog = getPostHogClient()!
    posthog.capture({
      distinctId: metric.userId,
      event: 'overlay.metrics.model_tokens',
      properties: {
        ...baseProperties(),
        ...metric,
      },
    })
  } catch (_error) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// AgentRun lifecycle metrics (exported from DB to PostHog)
// ---------------------------------------------------------------------------

export type AgentRunMetricExport = {
  runId: string
  userId: string
  runner: 'tool_loop' | 'workflow'
  status: string
  firstTokenLatencyMs?: number
  totalCompletionLatencyMs?: number
  inputTokens?: number
  outputTokens?: number
  providerCostMicros?: number
  workflowStepCount?: number
  workflowRetryCount?: number
  toolCallCount?: number
  toolSuccessCount?: number
  toolFailureCount?: number
  browserDisconnectedAt?: number
  browserReconnectedAt?: number
  /** True when the run completed after a browser disconnect. */
  completedAfterDisconnect?: boolean
}

export function captureAgentRunMetric(metric: AgentRunMetricExport): void {
  if (!metricsEnabled()) return
  try {
    const posthog = getPostHogClient()!
    posthog.capture({
      distinctId: metric.userId,
      event: 'overlay.metrics.agent_run',
      properties: {
        ...baseProperties(),
        ...metric,
      },
    })
  } catch (_error) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Workflow / automation metrics
// ---------------------------------------------------------------------------

export type WorkflowEventMetric = {
  runId: string
  userId: string
  /** Number of event-page reads during the automation run viewer session. */
  eventReads: number
  /** Duration the SSE connection was open in seconds. */
  sessionDurationSec: number
}

export function captureWorkflowEventMetric(metric: WorkflowEventMetric): void {
  if (!metricsEnabled()) return
  try {
    const posthog = getPostHogClient()!
    posthog.capture({
      distinctId: metric.userId,
      event: 'overlay.metrics.workflow_events',
      properties: {
        ...baseProperties(),
        ...metric,
      },
    })
  } catch (_error) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Upload metrics
// ---------------------------------------------------------------------------

export type UploadMetric = {
  resourceType: string
  success: boolean
  durationMs: number
  bytes?: number
  failureReason?: string
}

export function captureUploadMetric(metric: UploadMetric): void {
  if (!metricsEnabled()) return
  try {
    const posthog = getPostHogClient()!
    posthog.capture({
      distinctId: 'system',
      event: 'overlay.metrics.upload',
      properties: {
        ...baseProperties(),
        ...metric,
      },
    })
  } catch (_error) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Business metric rollups
// ---------------------------------------------------------------------------

export type BusinessMetricRollup = {
  /** Window label (e.g. 'hourly', 'daily'). */
  window: string
  /** Window start timestamp (ms). */
  windowStart: number
  /** Window end timestamp (ms). */
  windowEnd: number
  /** Distinct active user IDs in the window. */
  activeUsers: number
  /** Total BFF invocations in the window. */
  bffInvocations: number
  /** Total chat turns completed in the window. */
  chatTurns: number
  /** Total automations completed in the window. */
  automationsCompleted: number
  /** Total model cost in microdollars across all users. */
  totalModelCostMicros: number
  /** Total infrastructure cost in microdollars (Vercel + Convex + Postgres estimate). */
  totalInfraCostMicros: number
  /** Derived: totalModelCostMicros / activeUsers. */
  costPerActiveUserMicros: number
  /** Derived: totalModelCostMicros / chatTurns. */
  costPerChatTurnMicros: number
  /** Derived: totalModelCostMicros / automationsCompleted. */
  costPerAutomationMicros: number
}

export function captureBusinessMetricRollup(metric: BusinessMetricRollup): void {
  if (!metricsEnabled()) return
  try {
    const posthog = getPostHogClient()!
    posthog.capture({
      distinctId: 'system',
      event: 'overlay.metrics.business_rollup',
      properties: {
        ...baseProperties(),
        ...metric,
      },
    })
  } catch (_error) {
    // ignore
  }
}
