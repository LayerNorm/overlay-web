/**
 * Client-side metrics emitter for cache hits, duplicate requests, chat-open
 * latency, AgentRun recovery, and polling overhead.
 *
 * Isomorphic: no Node builtins, no React client directive, no ad-hoc env
 * access, no direct posthog-js import.  Uses a window-level CustomEvent bus
 * so the ObservabilityClient component can forward events to PostHog without
 * coupling this module to the analytics SDK.
 *
 * On the server (no window) all functions are no-ops.
 */

const METRICS_EVENT = 'overlay:metrics'

export type MetricsEventName =
  | 'overlay.metrics.client_request'
  | 'overlay.metrics.cache'
  | 'overlay.metrics.duplicate_request'
  | 'overlay.metrics.chat_open'
  | 'overlay.metrics.agent_run_recovery'
  | 'overlay.metrics.polling_overhead'
  | 'overlay.metrics.session_refresh'

export type MetricsPayload = {
  event: MetricsEventName
  properties: Record<string, unknown>
}

function emit(event: MetricsEventName, properties: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  try {
    console.log('[CLT_METRIC]', event, JSON.stringify(properties))
    window.dispatchEvent(
      new CustomEvent<MetricsPayload>(METRICS_EVENT, {
        detail: { event, properties },
      }),
    )
  } catch {
    // metrics must never crash the UI
  }
}

// ---------------------------------------------------------------------------
// BFF request tracking (client-side perspective)
// ---------------------------------------------------------------------------

export type ClientRequestMetric = {
  route: string
  method: string
  statusCode: number
  durationMs: number
  /** Whether the request was served from a client-side cache. */
  cacheState: 'hit' | 'stale' | 'miss' | 'bypass'
  /** Request deduplication key (when applicable). */
  dedupeKey?: string
}

export function trackClientRequest(metric: ClientRequestMetric): void {
  emit('overlay.metrics.client_request', metric)
}

// ---------------------------------------------------------------------------
// Cache hit/miss/stale tracking
// ---------------------------------------------------------------------------

export type CacheMetric = {
  resource: string
  key: string
  state: 'hit' | 'stale' | 'miss' | 'evicted'
  ttlMs?: number
  ageMs?: number
}

export function trackCacheState(metric: CacheMetric): void {
  emit('overlay.metrics.cache', metric)
}

// ---------------------------------------------------------------------------
// Duplicate request detection
// ---------------------------------------------------------------------------

export type DuplicateRequestMetric = {
  key: string
  /** How many times this key was requested within the window. */
  count: number
  /** The window size in ms. */
  windowMs: number
  /** Gap between first and most recent request in ms. */
  spanMs: number
}

export function trackDuplicateRequest(metric: DuplicateRequestMetric): void {
  emit('overlay.metrics.duplicate_request', metric)
}

// ---------------------------------------------------------------------------
// Chat-open latency
// ---------------------------------------------------------------------------

export type ChatOpenLatencyMetric = {
  conversationId: string
  /** Time from request to first render in ms. */
  openLatencyMs: number
  /** Total bytes in the transcript payload. */
  transcriptBytes: number
  /** Number of messages loaded. */
  messageCount: number
}

export function trackChatOpenLatency(metric: ChatOpenLatencyMetric): void {
  emit('overlay.metrics.chat_open', metric)
}

// ---------------------------------------------------------------------------
// AgentRun recovery
// ---------------------------------------------------------------------------

export type AgentRunRecoveryMetric = {
  runId: string
  /** Whether the browser disconnected during the run. */
  disconnected: boolean
  /** Duration of disconnect in ms (when recovered). */
  disconnectDurationMs?: number
  /** Whether the run completed successfully after reconnect. */
  completedAfterReconnect: boolean
}

export function trackAgentRunRecovery(metric: AgentRunRecoveryMetric): void {
  emit('overlay.metrics.agent_run_recovery', metric)
}

// ---------------------------------------------------------------------------
// Polling overhead
// ---------------------------------------------------------------------------

export type PollingOverheadMetric = {
  surface: string
  intervalMs: number
  /** Number of polls that returned no new data (wasted polls). */
  emptyPolls: number
  /** Total polls in the session. */
  totalPolls: number
  /** Session duration in ms. */
  sessionDurationMs: number
}

export function trackPollingOverhead(metric: PollingOverheadMetric): void {
  emit('overlay.metrics.polling_overhead', metric)
}

// ---------------------------------------------------------------------------
// Session/token refresh
// ---------------------------------------------------------------------------

export type SessionRefreshMetric = {
  trigger: 'interval' | 'focus' | 'visibility' | 'manual'
  durationMs: number
  success: boolean
}

export function trackSessionRefresh(metric: SessionRefreshMetric): void {
  emit('overlay.metrics.session_refresh', metric)
}

// ---------------------------------------------------------------------------
// Event listener helper (used by the ObservabilityClient component)
// ---------------------------------------------------------------------------

export function addMetricsListener(
  handler: (payload: MetricsPayload) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<MetricsPayload>
    if (customEvent.detail) handler(customEvent.detail)
  }
  window.addEventListener(METRICS_EVENT, listener)
  return () => window.removeEventListener(METRICS_EVENT, listener)
}
