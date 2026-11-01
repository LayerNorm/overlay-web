import { v } from 'convex/values'

/** Counts the nightly growth job adds up for one UTC day. */
export const growthCountFields = {
  usersCreated: v.number(),
  tasksCreated: v.number(),
  agentsCreated: v.number(),
  automationsCreated: v.number(),
  filesCreated: v.number(),
  filesEdited: v.number(),
  threadsCreated: v.number(),
  messagesSent: v.number(),
  automationRuns: v.number(),
  automationRunsSucceeded: v.number(),
  automationRunsFailed: v.number(),
  topUps: v.number(),
  topUpCents: v.number(),
  usageCents: v.number(),
  sandboxSeconds: v.number(),
  activeUsers: v.number(),
}

export const growthWorkspaceUsageValidator = v.object({
  workspaceId: v.string(),
  cents: v.number(),
  sandboxSeconds: v.number(),
})

export const growthTables = {
  /** One row per UTC day: what was created and done, and who was active. */
  growthDailyTotals: {
    day: v.string(),
    ...growthCountFields,
    /** Distinct active users over the 7 / 30 days ending on `day`. */
    weeklyActiveUsers: v.number(),
    monthlyActiveUsers: v.number(),
    /** Paid subscriptions active when the day was counted; only recorded for the live (yesterday) run. */
    paidSubscriptions: v.optional(v.number()),
    /** Largest workspaces by Overlay-billed spend that day. */
    topWorkspaces: v.array(growthWorkspaceUsageValidator),
    computedAt: v.number(),
  },
  /** One row per (user, UTC day) the user did a unit of work. */
  growthUserDays: {
    userId: v.string(),
    day: v.string(),
  },
  /** One row per user: signup day and whether each retention window was hit. */
  growthUsers: {
    userId: v.string(),
    signupDay: v.optional(v.string()),
    w1Active: v.boolean(),
    w4Active: v.boolean(),
  },
  /** Retention counters per signup week (Monday, UTC). */
  growthCohortWeeks: {
    weekStart: v.string(),
    users: v.number(),
    w1Active: v.number(),
    w4Active: v.number(),
  },
  /** First day each billing account was on a paid plan; new paid subscriptions per day are counted from these. */
  growthPaidAccounts: {
    billingAccountId: v.string(),
    firstPaidDay: v.string(),
    /** Already paid at the first snapshot, so dated by the subscription's createdAt rather than seen turning paid. */
    approximate: v.boolean(),
  },
  /** One row per (file, UTC day) whose text changed, written as the edit happens; editors are people only. */
  growthFileEdits: {
    fileId: v.id('files'),
    day: v.string(),
    editorUserIds: v.array(v.string()),
  },
  /** Overlay-billed spend per (UTC day, workspace). Rebuilt each time the day is counted. */
  growthWorkspaceUsage: {
    day: v.string(),
    workspaceId: v.string(),
    cents: v.number(),
    sandboxSeconds: v.number(),
  },
  /** The single row driving the job: the day being counted and how far it got. */
  growthJobState: {
    key: v.literal('daily'),
    lastCompletedDay: v.optional(v.string()),
    /** The first night paid plans were snapshotted; accounts already paid then are dated approximately. */
    firstPaidSnapshotDay: v.optional(v.string()),
    day: v.optional(v.string()),
    step: v.optional(v.number()),
    cursor: v.optional(v.string()),
    counts: v.optional(v.object(growthCountFields)),
    weeklyActiveUsers: v.optional(v.number()),
    monthlyActiveUsers: v.optional(v.number()),
    paidSubscriptions: v.optional(v.number()),
    /** Days still to count after `day`, inclusive end. */
    untilDay: v.optional(v.string()),
    updatedAt: v.number(),
  },
}
