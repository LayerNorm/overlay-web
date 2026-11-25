import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

/**
 * The workspace `guest` role was removed: nobody asked for it, and members already see only what their workspace
 * shares. This one-time move clears what guests left behind so the legacy `guest` literals and fields can be dropped
 * from the schema afterwards. Run it once per table, each with `dryRun: true` first (it only counts), then until
 * `isDone`, passing `continueCursor` back. Idempotent: a rerun changes nothing.
 *
 * - `memberships`: active and suspended guest memberships become `member` (status kept).
 * - `invitations`: guest invitations become `member` invitations; `pending` counts the ones still open.
 * - `resourceGuests`: deletes every `workspaceResourceGuests` row. They grant nothing once guests are members.
 * - `sharingPolicies`: clears the retired `guestExpirationDays` setting.
 * - `slackSettings`: clears the retired Slack `guests` toggle.
 */
export const migrateGuestsToMembersByServer = mutation({
  args: {
    serverSecret: v.string(),
    table: v.union(
      v.literal('memberships'),
      v.literal('invitations'),
      v.literal('resourceGuests'),
      v.literal('sharingPolicies'),
      v.literal('slackSettings'),
    ),
    dryRun: v.boolean(),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { serverSecret, table, dryRun, cursor, numItems }) => {
    requireServerSecret(serverSecret)
    const opts = { cursor: cursor ?? null, numItems: numItems ?? 100 }
    const now = Date.now()
    let scanned = 0
    let changed = 0
    let pending = 0
    let done: { continueCursor: string; isDone: boolean }

    if (table === 'memberships') {
      const page = await ctx.db.query('workspaceMemberships').paginate(opts)
      scanned = page.page.length
      for (const row of page.page) {
        if (row.role !== 'guest') continue
        changed += 1
        if (!dryRun) await ctx.db.patch(row._id, { role: 'member', updatedAt: now })
      }
      done = page
    } else if (table === 'invitations') {
      const page = await ctx.db.query('workspaceInvitations').paginate(opts)
      scanned = page.page.length
      for (const row of page.page) {
        if (row.role !== 'guest') continue
        changed += 1
        if (row.status === 'pending') pending += 1
        if (!dryRun) await ctx.db.patch(row._id, { role: 'member', updatedAt: now })
      }
      done = page
    } else if (table === 'resourceGuests') {
      const page = await ctx.db.query('workspaceResourceGuests').paginate(opts)
      scanned = page.page.length
      changed = page.page.length
      if (!dryRun) await Promise.all(page.page.map((row) => ctx.db.delete(row._id)))
      done = page
    } else if (table === 'sharingPolicies') {
      const page = await ctx.db.query('workspaceSharingPolicies').paginate(opts)
      scanned = page.page.length
      for (const row of page.page) {
        if (row.guestExpirationDays === undefined) continue
        changed += 1
        if (!dryRun) await ctx.db.patch(row._id, { guestExpirationDays: undefined })
      }
      done = page
    } else {
      const page = await ctx.db.query('slackSettings').paginate(opts)
      scanned = page.page.length
      for (const row of page.page) {
        if (row.guests === undefined) continue
        changed += 1
        if (!dryRun) await ctx.db.patch(row._id, { guests: undefined })
      }
      done = page
    }

    return { table, dryRun, scanned, changed, pending, continueCursor: done.continueCursor, isDone: done.isDone }
  },
})
