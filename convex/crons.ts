import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval('native deployment policy refresh', { minutes: 1 }, internal.platform.nativePolicy.refresh, {})

crons.interval('Harness continuation reconciliation', { minutes: 1 }, internal.harness.continuations.dispatchDue, {})


crons.interval('expired local tool calls', { minutes: 15 }, internal.agents.localToolCalls.cleanupExpired)

crons.interval(
  'expired harness context artifacts',
  { hours: 1 },
  internal.harness.artifacts.cleanupExpired,
)

// Claims due automation runs every minute and dispatches each to the BFF,
// which executes it as a durable one-shot automation workflow. Sleep()-based
// per-automation scheduling workflows could not survive in the current
// deployment (no durable workflow world is configured), so dispatch lives
// here while execution stays durable.
crons.interval(
  'automation scheduler',
  { minutes: 1 },
  internal.automations.automationRunner.runMinuteTick,
)

// Credits automatic workspace top-ups that Stripe finished after the request that started them (3-D Secure etc.),
// in case the payment_intent webhook was missed.
crons.interval(
  'pending automatic top-up settlement',
  { minutes: 5 },
  internal.billing.autoTopUpReconcile.reconcilePendingAutoTopUps,
)

crons.interval(
  'tool loop agent run lease cleanup',
  { minutes: 2 },
  internal.chat.conversations.expireToolLoopAgentRunLeases,
)

// Meters cloud Computer machine leases and runs their idle checks through the BFF reconcile route.
// The cron name is kept so the deployment updates the existing job instead of adding a second one.
crons.interval(
  'connected agent settlement reconciliation',
  { minutes: 1 },
  // Provider credentials remain in the BFF rather than the Convex deployment.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (internal as any).agents.settlementReconciliation.runReconciliationTick,
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
  'expired Slack state cleanup',
  { hours: 1 },
  internal.integrations.slack.cleanupExpiredState,
  {},
)

crons.interval(
  'api idempotency cleanup',
  { hours: 1 },
  internal.platform.idempotency.cleanupExpiredInternal,
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

// knowledgeChunks have no tombstone — a chunk is dead when its source row is.
// Interrupted purges can strand retrievable chunks; a daily whole-table scan
// deletes provable orphans (missing source row, tombstoned memory). The action
// pages the table and self-reschedules until done, so one tick kicks a
// resumable chain rather than timing out on large stores.
crons.daily(
  'knowledge orphan-chunk sweep',
  { hourUTC: 4, minuteUTC: 30 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (internal as any).knowledge.knowledge.sweepOrphanedChunks,
  {},
)

// Counts yesterday (UTC) for the admin console's growth panel. Runs a little
// after midnight so late writes for the day have landed.
crons.daily('growth daily totals', { hourUTC: 0, minuteUTC: 20 }, internal.platform.growth.startDaily)

// Folder copy records for agent runs are kept a week (internal/develop/thread-folders.md).
crons.daily('prune folder copies', { hourUTC: 3, minuteUTC: 40 }, internal.files.folderCopies.prune)

export default crons
