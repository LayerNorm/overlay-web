# Paid-workspace protection before immediate cutoff

This preparation release adds verified invoice funding and the operator-only paid-period backfill. It does not change execution admission, onboarding, free routing, free allowances, scheduled jobs, or deployed free resources. Existing setup, history and billing remain available. The enforcement release is separate.

The owner approved immediate unpaid-workspace cutoff once existing paid workspaces are protected, replacing the earlier 14-day notice delay. That decision does not authorize a production merge, deployment, or migration from a feature branch.

## Release order

1. Validate this preparation release independently on its isolated PR Preview, including Stripe test-mode checkout, webhook funding and migration acceptance. Synthetic preview fixtures are not evidence of a real payment.
2. Integrate through the normal main merge queue. Let native Vercel production deploy the exact canonical main revision. This preparation web retains current Checkout verification and does not call the new paid-period RPC. Before synchronizing customer Convex, verify that the production Stripe endpoint is configured for `invoice.paid` and `checkout.session.async_payment_succeeded` and has a healthy delivery path for both. Once Convex is live, `invoice.paid` records verified period funding; legacy Checkout continues updating subscription lifecycle metadata, and its verified payment is funded through the invoice webhook. Never deploy customer Convex from a feature worktree. The later enforcement release adds direct verified Checkout confirmation only after the backend RPC is available. This preparation does not perform production synchronization.
3. Immediately inventory and reconcile existing paid workspaces using the dry-run below. Apply only verified paid periods with explicit operator approval. Existing paid workspaces do not need to repurchase their plan.
4. Recheck every page immediately before enforcement. Resolve all `needs_review` and `not_applied` outcomes. A green build, a test purchase, or an empty first page is not production migration acceptance.
5. Only after paid accounts are protected, release paid-first enforcement with immediate unpaid cutoff. Preserve setup, drafts, history, export and billing. Do not charge unpaid workspaces automatically. Drain old free runs and settle their holds, then remove exclusively free deployed resources after replacement callers are live. Retain historical records and shared paid/BYO infrastructure.

## Backfill

`billing/paidFirstMigrationNode:backfill` is an internal action with no public endpoint or scheduler. It reads Stripe and does not charge, subscribe, cancel or refund anyone. It defaults to read-only and requires exact deployment confirmation in both modes.

In the explicitly approved backend's internal function runner:

```json
{
  "expectedDeploymentUrl": "https://<explicitly-selected-backend>.convex.cloud",
  "apply": false,
  "cursor": null
}
```

Use the backend's actual `CONVEX_CLOUD_URL`; do not guess or copy a feature environment into production. Each call scans 25 subscription records. Follow every returned `continueCursor` until `isDone` is true, including pages with no outcomes. Save reports by deployment and mode without secrets or customer content.

| Outcome | Required action |
| --- | --- |
| `eligible` | Stripe evidence matches in dry-run. No funds or proof have been written. |
| `applied` | Proof persisted transactionally. Compatible first-period balances, spent amounts, holds, top-ups and institutional credit are preserved without duplicate funding. |
| `not_applied` | Concurrent state changed or proof already exists. Re-inventory and establish why. |
| `needs_review` | Resolve missing or mismatched evidence, provider failures, live subscriptions in Preview, or incompatible balances individually. Never force credit from plan metadata. |

After reviewing the complete dry-run, repeat from `cursor: null` with `apply: true` only in the approved environment. Re-run the full inventory afterward. Repeated apply is idempotent. Trialing, unpaid, stale, partial, discounted, prorated, multi-line and unknown-price invoices do not automatically qualify. Configured historical Pro/Max prices are supported. Preserve ledger history and reconcile exceptions before cutoff.

Subscription lifecycle events now update metadata only. New period funding requires verified paid invoices. Renewals with live reservations fail retryably instead of erasing those holds; retain failed webhook receipts for retry after settlement. Do not discard these failures as successful migrations.

## Rollback

Before enforcement, pause new checkout if payment verification is unhealthy and reconcile against Stripe. Keep the additive proof fields and financial records. Do not reset balances, synthesize paid invoices or rerun funding blindly. Before deploying an older lifecycle-funding implementation, reconcile period and receipt state so it cannot reset already-used credit. After enforcement, do not restore free admission as a billing rollback.
