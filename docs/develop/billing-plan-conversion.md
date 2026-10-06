# Moving a personal plan onto a workspace

Workspace scoping 5b, step B4. A person who pays for a personal plan can have it become the plan of one of their
workspaces, so every member draws from the same credits. It is done on request, one person at a time, by an operator; there
is no button for it yet. Code: `convex/billing/planConversion.ts`; tests: `convex/planConversion.convex.test.ts`.

## What it does

A personal plan lives in the person's `subscriptions` row and is mirrored into the account-keyed tables after every change
(`syncPersonalBillingShadows`); a workspace plan lives in the account-keyed tables alone. Converting keeps the **same billing
account**, so its Stripe subscription and customer, balance, top-ups, usage history, and reservations stay exactly as they are:

1. The account stops being a personal account (`scope: 'workspace'`, `workspaceId` set, `userId` cleared).
2. The person's legacy row is reset to the free plan (Stripe ids, credits, top-up balances, auto top-up cleared); their
   storage meter and profile fields are untouched. They get a new, empty free personal account.
3. A `billingPlanConversions` row keeps a snapshot of the old row so the move can be undone.
4. Stripe webhooks for the subscription route to the workspace account (`convertedAccountId` in `convex/platform/http.ts`,
   by subscription or customer id). Nothing is changed in Stripe: the subscription's metadata still names the person.

The whole conversion is one Convex transaction: it either happens or nothing changes.

## What the person gives up, and what stays

- The person's own plan becomes **Free** everywhere else. Their storage limit drops to the free limit (files stay; they
  cannot add more until under it), and automation and similar plan-based limits follow the free plan.
- Everyone in the workspace (including the person) uses the pool. Per-member spend limits, if set later, apply to it.
- **Auto top-up is not supported for a workspace plan**, so a conversion is refused while it is on; turn it off first.

## Before converting

`previewPlanConversion` changes nothing and returns `ok`, the `blockers`, the plan and balance, and the effects. Blockers:
not the workspace owner; workspace inactive; the workspace already has a billing account; workspace billing not enabled for
the workspace; the person already converted a plan; no paid plan or no Stripe subscription; auto top-up on; usage in flight;
the account-keyed copy differs from the person's row (investigate; do not convert).

**Workspace billing must be enabled for the workspace on both sides.** The Vercel app and the Convex deployment each read
`OVERLAY_FEATURE_WORKSPACE_WALLETS`, `OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE` (`selected` or `internal`), and the workspace
id in `OVERLAY_WORKSPACE_BILLING_SELECTED_WORKSPACE_IDS` (or `..._INTERNAL_WORKSPACE_IDS`). Without it the workspace
resolves to the free allowance and the person would lose the plan they paid for; the preview blocks on the Convex side, and
the Vercel side must be set to match before converting.

## Runbook

Run from the clean `main` checkout. Commands use the admin CLI (internal functions need no server secret).

```bash
npx convex run billing/planConversion:previewPlanConversion '{"userId":"<user>","workspaceId":"<workspace>"}' --prod
npx convex run billing/planConversion:convertPlanToWorkspace '{"userId":"<user>","workspaceId":"<workspace>"}' --prod
npx convex run billing/planConversion:revertPlanConversion '{"workspaceId":"<workspace>"}' --prod
```

1. Preview. Share the result with the owner; convert only with their approval for that account.
2. Convert one account first and verify: Settings → Workspace → Billing shows the plan and credits; a chat in the workspace
   draws from it; the person's Account page shows Free; the next Stripe `customer.subscription.updated` (or a test event)
   lands on the workspace account.
3. Revert if anything is off. `revertPlanConversion` hands the account back with the credits used since and the current
   balance; it refuses while usage is in flight, while spend limits exist, or if the person already used their new personal
   account.

## Not done

A self-serve button in Workspace → Billing, and auto top-up for workspace plans. Both are follow-ups.
