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

export const growthAccountUsageValidator = v.object({
  billingAccountId: v.string(),
  cents: v.number(),
  sandboxSeconds: v.number(),
})

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
    /** Distinct active users over the 7 / 30 days ending on `day`; absent when the day was re-run after later days. */
    weeklyActiveUsers: v.optional(v.number()),
    monthlyActiveUsers: v.optional(v.number()),
    /** Paid subscriptions active when the day was counted; only recorded for the live (yesterday) run. */
    paidSubscriptions: v.optional(v.number()),
    newPaidSubscriptions: v.number(),
    /** Largest workspaces by Overlay-billed spend that day. */
    topWorkspaces: v.array(growthWorkspaceUsageValidator),
    computedAt: v.number(),
  },
  /** One row per (user, UTC day) the user did a unit of work. */
  growthUserDays: {
    userId: v.string(),
    day: v.string(),
  },
  /** One row per user: signup day, last active day and whether each retention window was hit. */
  growthUsers: {
    userId: v.string(),
    signupDay: v.optional(v.string()),
    lastActiveDay: v.optional(v.string()),
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
  /** First night each billing account was seen on a paid plan. */
  growthPaidAccounts: {
    billingAccountId: v.string(),
    firstPaidDay: v.string(),
    /** Backfilled from the subscription's createdAt, not seen live. */
    approximate: v.boolean(),
  },
  /** The single row driving the job: the day being counted and how far it got. */
  growthJobState: {
    key: v.literal('daily'),
    lastCompletedDay: v.optional(v.string()),
    /** Latest day ever completed; a re-run of an earlier day keeps its stored weekly/monthly numbers. */
    maxCompletedDay: v.optional(v.string()),
    day: v.optional(v.string()),
    step: v.optional(v.number()),
    cursor: v.optional(v.string()),
    counts: v.optional(v.object(growthCountFields)),
    accountUsage: v.optional(v.array(growthAccountUsageValidator)),
    weeklyActiveUsers: v.optional(v.number()),
    monthlyActiveUsers: v.optional(v.number()),
    paidSubscriptions: v.optional(v.number()),
    /** Days still to count after `day`, inclusive end. */
    untilDay: v.optional(v.string()),
    updatedAt: v.number(),
  },
}
