import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Daytona webhooks may later accelerate reconciliation, but this cron remains the billing truth.
crons.interval(
  'daytona workspace reconciliation',
  { minutes: 1 },
  internal.ai.sandbox.daytonaReconcile.runMinuteTick,
)

// NOTE: This cron is the legacy scheduling path. When the
// OVERLAY_FEATURE_DURABLE_AUTOMATIONS feature flag is enabled, scheduling
// moves to the sleep()-based workflow (workflows/automation-schedule.ts)
// and this cron becomes a no-op. Once the feature flag is removed in Step 7,
// this cron entry should be deleted entirely.
crons.interval(
  'automation_scheduler_legacy',
  { minutes: 1 },
  internal.automations.automationRunner.runMinuteTick,
)

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

export default crons
