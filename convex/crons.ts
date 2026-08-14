import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Daytona webhooks may later accelerate reconciliation, but this cron remains the billing truth.
crons.interval(
  'daytona workspace reconciliation',
  { minutes: 1 },
  internal.ai.sandbox.daytonaReconcile.runMinuteTick,
)

// NOTE: The legacy automation scheduler cron has been removed.
// Durable automations are now always enabled and use the sleep()-based
// workflow (workflows/automation-schedule.ts) for scheduling. The
// OVERLAY_FEATURE_DURABLE_AUTOMATIONS feature flag has been removed.

crons.interval(
  'tool loop agent run lease cleanup',
  { minutes: 2 },
  internal.chat.conversations.expireToolLoopAgentRunLeases,
)

// Removes conversations that were created (e.g. user opened a new chat) but never
// received a single message. Reduces storage and keeps the sidebar list clean.
crons.interval(
  'empty conversation cleanup',
  { minutes: 30 },
  internal.chat.conversations.runEmptyConversationCleanup,
)

crons.interval(
  'service auth replay nonce cleanup',
  { hours: 1 },
  internal.auth.serviceAuth.cleanupExpiredReplayNoncesInternal,
  {},
)

crons.interval(
  'api idempotency cleanup',
  { hours: 1 },
  internal.platform.idempotency.cleanupExpiredInternal,
  {},
)

crons.interval(
  'usage reservation reconciliation',
  { minutes: 5 },
  internal.platform.usage.reconcileExpiredBudgetReservationsInternal,
  {},
)

crons.interval(
  'outbound webhook delivery',
  { minutes: 1 },
  internal.webhooks.deliveryRunner.runMinuteTick,
)

crons.interval(
  'transactional email delivery',
  { minutes: 1 },
  internal.email.deliveryRunner.runMinuteTick,
)

// Clean up function metrics older than 7 days to bound table growth.
// The `internal.platform.metrics` reference is resolved when Convex
// regenerates _generated/api.d.ts during the next `convex dev`/`convex push`.
crons.interval(
  'function metrics cleanup',
  { hours: 6 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (internal as any).platform.metrics.cleanupOldMetricsInternal,
  {},
)

// Prune expired rate-limit windows periodically instead of in the request path.
crons.interval(
  'rate limit window pruning',
  { minutes: 5 },
  internal.platform.rateLimits.pruneExpiredWindowsInternal,
  {},
)

// Process queued document ingestion jobs. The action lists queued jobs and
// schedules a processOne action for each, which calls the BFF to download
// from R2, extract text, and create file records.
crons.interval(
  'document ingestion job processor',
  { minutes: 1 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (internal as any).files.ingestion.runner.runMinuteTick,
  {},
)

// Project workflow step events from the Workflow SDK into Convex so clients
// can subscribe via Convex subscription instead of polling the SSE endpoint
// every 2 seconds. This runs every 10 seconds for near-realtime updates.
crons.interval(
  'workflow step event projector',
  { seconds: 10 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (internal as any).automations.workflowEventProjector.runProjectionTick,
  {},
)

export default crons
