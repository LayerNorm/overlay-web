# Growth analytics: admin Growth panel and PostHog cleanup

Status: Phases 0 and 1 done (nightly job on branch `codex/growth-analytics`); Phase 2 next.

Answer "are we growing?" from the database, not from client events. A nightly
Convex job counts what was created and done, and the admin console shows the
numbers. PostHog shrinks to marketing pageviews, identity, signup and feature flags.

## Approved decisions

1. **Convex is the source of truth.** Every growth number is counted from rows
   that already exist. Ad blockers, missed events and client bugs can't skew it.
2. **Active means did work.** A user is active on a day when they did at least
   one unit of work (below). Pageviews and the `retention.engaged` ping don't count.
3. **Count nightly, read summaries.** The admin panel never scans large tables
   live. A nightly job writes one row per day of summary counts. The panel reads
   only those rows.
4. **Keep it small.** The metric list below is the whole scope. A new metric
   needs a reason and a line in this doc.

## Metrics

Confirmed in Phase 0. "Day" means the row's `_creationTime` in UTC, read through
the built-in `by_creation_time` index, so no new index is needed for counts. The
`createdAt` field isn't used for counting, because imported Slack messages carry
their original timestamp in it.

| Group | Metric | Source and filter | Person credited for "active" |
| --- | --- | --- | --- |
| Created | Tasks | `workItems` | the `created` event's actor (below), not `userId`: an agent can create a task owned by a person |
| Created | Agents | `workspaceAgentDefinitions`, excluding `isDefault` | `createdByPrincipalId` → `workspacePrincipals.userId` (human only) |
| Created | Automations | `automations` | `userId` |
| Created | Files | `files` where `kind` is `note` or `upload` (folders and AI outputs excluded) | `userId`, unless `createdByAgent` (agent drive saves under the owner) |
| Work | Threads created | `conversations`, excluding `isAutomation` | `userId` |
| Work | Messages sent | `conversationMessages` where `role = 'user'`, `importedAuthorName` unset and `authorKind` is unset or `human` | `userId` |
| Work | Automations run | `automationRuns`, split by final status (succeeded/completed vs failed/dead_letter) | only when `triggerSource` is `manual` or `retry` |
| Work | Task created or changed | `workItemEvents`, every kind (used for "active" only, not shown) | `actorPrincipalId` → `workspacePrincipals.userId` (human only) |
| Work | Files edited | new `growthFileEdits` rows for the day (Phase 1) | the editor, written to `growthUserDays` at save time |
| Usage | Users created | `subscriptions`: one row per user, inserted at first sign-in by `auth/users:syncUserProfileByServer` (`isNewUser`). There's no separate users table. | the new user |
| Usage | Daily / weekly / monthly active users | distinct users in `growthUserDays` for the day / last 7 / last 30 days | n/a |
| Usage | Paid subscriptions | `billingAccountSubscriptions` where `planKind = 'paid'` and `status` is `active`/`trialing` (snapshot each night) | n/a |
| Usage | New paid subscriptions | `growthPaidAccounts` rows by `firstPaidDay` (read by the panel, not stored per day) | n/a |
| Usage | Top-ups purchased | `budgetTopUps` with `status` `succeeded` or `refunded` (a partial refund is marked refunded): count and `amountCents` net of `refundedAmountCents`, when anything was kept | n/a |
| Usage | Resources used | as `billing/usageTotals` computes it: finalized `budgetReservations` (`finalizedCents`) plus `usageOperations` that carry their own `cents` (machine-time meter, batch usage); `usageSeconds` where `kind = 'sandbox'`. Grouped by `billingAccountId` → `billingAccounts.workspaceId` | n/a |
| Retention | W1, W4 | see definition below | n/a |

**Units of work** (used for "active"): thread created, message sent, manual
automation run, task created or changed, agent created, file created or edited.
Agents and automations acting by themselves never make anyone active.

### Gaps found in Phase 0

1. **No reliable "content edited" time on files.** `files.updatedAt` also changes
   when a file is indexed, moved, renamed, deduplicated or deleted
   (`convex/files/files.ts`), so it would count background work as edits. A
   "last edited" field wouldn't work either: a second editor, or an edit just
   after midnight, would overwrite the earlier one before the nightly count.
   Phase 1 writes a `growthFileEdits` row per (file, UTC day) as each text change
   happens, and credits each person who edited it that day. Edits before that ships
   can't be backfilled; the panel starts this metric from the deploy date.
2. **No history of when an account became paid.** `billingAccountSubscriptions` is
   updated in place (`convex/billing/accountSubscriptions.ts`), so the date it
   turned paid is lost. The nightly snapshot plus `growthPaidAccounts` (first night
   seen paid) records it from now on. Accounts already paid at the very first
   snapshot are dated by their subscription's `createdAt` and marked approximate,
   whether the backfill runs before or after that night.
3. **Slack-surface messages.** For conversations linked to Slack (`externalPlatform`
   set), `conversationMessages.userId` may be the person who connected Slack, not
   the person who wrote in Slack. These messages count in "Messages sent" but don't
   make anyone active until the author can be mapped.
4. **`dailyUsage` / `tokenUsage` aren't used.** They hold per-user counters and
   billing-period totals, not per-day spend. Billed spend is split between
   finalized reservations and self-charged usage operations, the same sources
   `billing/usageTotals` sums.
5. **Outcomes settle after midnight.** A top-up confirmed late, an automation run
   still going, or a reservation finalized later changes after its day is first
   counted. Each night re-counts the two days before, which covers ordinary
   delays; a refund weeks later is not reflected in the old day.

**Retention.** Group users by signup week. W1 is the share active at least once
on days 7–13 after signup. W4 is the share active on days 28–34. A signup
week's figure is reported only once that window has fully passed.

## Data model

Shared validators live in `convex/lib/growthSchema.ts`; the job is
`convex/platform/growth.ts`.

Every number comes out the same whatever order days are counted in, so the
nightly run, the backfill and repairs can overlap in history safely.

- `growthDailyTotals`: one row per UTC day with every count above, weekly and
  monthly actives, paid subscriptions (live nights only), the top 10 workspaces
  by Overlay-billed spend, and `computedAt`.
- `growthUserDays`: one row per (user, UTC day) the user did a unit of work.
  Weekly/monthly actives look each user up here for the window.
- `growthUsers`: one row per user: `signupDay` and whether the W1 and W4 windows
  were hit. Retention is checked both when a signup is counted and when a new
  user-day is added, so either can come first.
- `growthCohortWeeks`: per signup week (Monday, UTC), the user count and how many
  hit W1 and W4. Updated as each window is first hit, so the panel reads it
  directly.
- `growthPaidAccounts`: the first day each billing account was paid
  (`approximate: true` for accounts already paid at the first snapshot).
- `growthWorkspaceUsage`: Overlay-billed spend per (day, workspace), rebuilt each
  time the day is counted. The top 10 are copied into `growthDailyTotals`.
- `growthJobState`: one row: the day being counted, the step and page cursor,
  running counts, the last completed day and the first paid-snapshot day.
- `growthFileEdits`: one row per (file, UTC day) whose text changed; it holds no
  user id. The editor is credited in `growthUserDays` at the same time. Written
  at edit time by `recordFileEdit`
  (`convex/lib/growthFileEdits.ts`): `files:update` calls it when the text really
  changes (by full-text hash when present, since object-stored text sends only a
  prefix; never for AI outputs), and agent drive overwrites call it with no editor.

One existing table changes: `files.createdByAgent` (optional), set by agent
drive uploads.

Account deletion (`auth/users:deleteUserAccountByServer`) removes the person's
`growthUsers` and `growthUserDays` rows; only anonymous totals and cohort counts
remain. Personal billing accounts count in the spend totals only. The panel shows
totals and the workspace list, nothing per user.

## Phases

Each phase is one PR to main with its own preview QA.

### Phase 0: Confirm sources (done)

Sources, filters and gaps are recorded in the Metrics section above.

### Phase 1: Nightly job and backfill (done)

- One day is a chain of internal mutations (`platform/growth:runStep`). Each
  reads one page of one source table, adds to the counts in `growthJobState`
  and schedules the next page. A page and its counts commit together, so a retry
  never double-counts; re-running a day starts its counts from zero. Pages stay
  small for tables with large rows (files 10, messages 15).
- Cron `growth daily totals` runs `platform/growth:startDaily` at 00:20 UTC. It
  counts every day after the last completed one, up to yesterday, and re-counts
  the two days before. The first run on a deployment counts only yesterday. A
  run with no progress for 2 hours is restarted from that day's first step.
- Backfill: `platform/growth:startBackfill` (optional `fromDay`, default the
  first signup; `force` restarts a running job) recounts each day to yesterday
  in order. It can run before or after the first nightly run.
  After the production deploy, run it once from the dashboard or with
  `npx convex run platform/growth:startBackfill '{}'` against the selected
  deployment, following `internal/develop/convex-workflow.md`.
- Tests: `convex/growthAnalytics.convex.test.ts`.

### Phase 2: Admin Growth panel

- Convex: `admin/console:getGrowthSummary`, admin-secret guarded like the other
  console queries, reading only the growth tables. It returns the last 90 days
  of totals, DAU/WAU/MAU, a retention table by signup week (last 12 weeks), and
  the top workspaces by resources used. New paid subscriptions per day come
  from `growthPaidAccounts` by `firstPaidDay`, marking approximate dates.
- Admin app: `GET /api/v1/admin/growth` through `adminRoute`. It's open to
  `admin`, `auditor` and `billing_admin` and recorded with an audit action
  `administration.growth.read`.
- UI: a new `growth` section in `AdminConsolePage`, built only from
  `@overlay/ui` primitives. Layout:
  - one row of headline numbers (WAU, new users this week, messages this week,
    paid subscriptions), each with the change against last week;
  - one weekly trend chart per group (Created, Work, Usage);
  - a W1/W4 retention table by signup week;
  - a "last updated" time from `computedAt`.
  Keep it as plain as the existing sections. No chart decoration and no emoji.
  Validate the look in the preview before marking the PR ready.
- Update `internal/develop/admin-console.md` (new section, route, roles).

### Phase 3: PostHog cleanup (deletion only)

Start only after Phase 2 is live, so there is no gap in visibility. First check
that no PostHog dashboard or alert depends on the events being removed.

Remove:

- `src/shared/observability/client-metrics.ts` and its call sites (5 files),
  plus the metrics forwarding in `ObservabilityClient`.
- `src/server/observability/metrics.ts` and its callers (2 files), including
  `overlay.metrics.bff_request`.
- The `functionMetrics` table, `convex/lib/metrics.ts`, `convex/platform/metrics.ts`
  and their cleanup cron (only after confirming nothing else reads them).
- Feature-level `posthog.capture` calls: chat, Work (`work-analytics.ts`),
  files analytics adapter, integrations, auth callback and sign-out.
- From `posthog-server.ts`: the lifecycle-to-PostHog mappings the panel now
  covers (automation, billing, workspace events). Keep the lifecycle email and
  audit sinks unchanged.

Keep:

- PostHog init, `$pageview`, `posthog.identify` / `reset` and the signup event
  (`activation.completed`, renamed `user.signed_up`). These show which pages and
  referrers bring in signups.
- The server PostHog client used by `src/server/releases/feature-flags.ts`.
- Sentry error reporting and tracing.

Also:

- Remove `retention.engaged` once Phase 2 retention is trusted.
- Update `internal/develop/api-route-catalog.md` for `sync-profile` if its event
  changes, and update the privacy/subprocessor wording only if what's sent changes.
- Run targeted ESLint and the tests that touched the removed modules.

## Docs and changelog

- Phase 1/2: `internal/develop/admin-console.md`, CHANGELOG entry.
- Phase 3: CHANGELOG entry listing the removed events.
- This repository is public: never commit real growth numbers, screenshots with
  production data or customer workspace names to docs, PRs or this plan.
- Delete this plan in the PR that lands Phase 3.

## QA checklist

- Phase 1: on the PR preview backend, seed data, run the job manually and read
  `growthDailyTotals` back. Run it again and confirm the counts don't change.
- Phase 2: sign into the preview admin console as `admin` and as `support`.
  `admin` sees Growth, `support` doesn't. Numbers match the seeded data.
  Check the empty state on a fresh backend and that the last-updated time shows.
- Phase 3: send a chat, create a task and connect an integration in the preview.
  PostHog receives only pageviews, identify and signup. Feature flags still
  resolve. No console errors.

## Open questions

- Should "resources used" include BYOK / subscription-connection usage, or only
  Overlay-billed spend? `usageOperations` covers only Overlay-billed spend, so
  including BYOK would need another source.
- Should agent-written files (agent drive) count in "Files created"? Proposed:
  count them, but only edits made by a person make anyone active.
- Should automation runs from scheduled triggers count toward a user being active?
  Proposed: scheduled runs count in "Automations run" but don't make the owner
  active; only actions the user took (including manual runs) do.
