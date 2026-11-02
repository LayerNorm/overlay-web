# Paid-first rollout

Opt-in Preview QA workspaces carry explicitly synthetic `preview-fixture` paid-period records and bounded budgets. Re-seeding does not replenish credit or extend those periods. They are not payment evidence and must never be used to claim checkout acceptance: validate Stripe payment in a separate, initially unfunded workspace. The fixture handlers refuse production deployments.

This is an operator runbook, not permission to deploy. Feature development has not changed production billing, stopped existing customers, or run the migration against a real backend.

## Release gates

1. Ship a **separate additive preparation release** containing the paid-invoice proof fields, invoice validation/webhook funding, and internal backfill. Do not include execution enforcement or free-infrastructure deletion in that release. Validate its complete diff and isolated preview independently. Existing clients must remain usable while proof is populated.
2. Prepare immediate cutoff once existing paid workspaces are protected. The owner approved removing the earlier 14-day notice delay. Preserve setup, drafts, history, export, and billing; do not charge anyone automatically. The final enforcement release cuts over all hosted workspaces together after the paid-account migration gates below; it does not contain a second grandfathered/free execution policy or a temporary cohort switch. This timing decision is not permission to merge or mutate production.
3. Dry-run, reconcile, and apply paid-period proof for existing paid workspaces before the enforcement release. Recheck immediately before cutover. Resolve every `needs_review` or `not_applied` result; neither counts as successful migration.
4. Validate the final exact-SHA isolated PR preview, including real Stripe **test-mode** checkout and a useful first task. Validate that $8 funds the chosen first-task experience including inference, compute, tools, payment fees, and platform overhead. Do not claim this economics gate passed based on unit tests.
5. At cutoff, drain or stop old free runs and computers, settle their existing holds, and disable scheduled unfunded work. Deploy the enforcement/removal release using the normal main merge queue and native web release, then synchronize customer Convex only from clean matching canonical main. No feature-worktree production deploys.
6. Remove exclusively free deployed configuration and resources after their replacement callers are live. Inventory and archive operational records where necessary; retain customer transcripts, financial ledger, reservations/receipts needed for reconciliation, and exports. Confirm no free route, cron, provider canary, dedicated key, capacity reservation, activation switch, or operational-only table remains. Do not delete shared paid/BYO OpenRouter or gateway credentials.

The complete feature PR is **not** the additive preparation release and must not be merged as that release. Its enforcement would immediately stop unpaid work. Keep the enforcement PR in draft until these release gates are satisfied.

## Existing-paid-workspace backfill

The internal action `billing/paidFirstMigrationNode:backfill` is manually invoked by an operator. It has no public endpoint and no scheduler. It reads Stripe; it never creates charges, subscriptions, or refunds. By default it makes no database writes.

Use the repository's documented deployment selection for the explicitly approved backend. In the Convex dashboard's internal function runner, pass:

```json
{
  "expectedDeploymentUrl": "https://<explicitly-selected-backend>.convex.cloud",
  "apply": false,
  "cursor": null
}
```

The URL must exactly match that backend's built-in `CONVEX_CLOUD_URL`. Do not guess it or copy a feature workspace's environment into production. This confirmation is required for both dry-run and apply.

Each call scans 25 subscription records. Continue using the returned `continueCursor` until `isDone` is true, even when `outcomes` is empty. Save each report with its selected deployment and mode. Do not log Stripe secrets or customer content.

Candidates are active paid workspace subscriptions without proof matching their current period. Each candidate must have a matching active account and Stripe customer, subscription, configured price, amount, and current period. Only a fully paid recurring invoice for that period qualifies. Variable monthly pricing and the explicitly configured historical Pro/Max prices are recognized. Live-mode Stripe subscriptions are rejected in an isolated preview.

Reports use:

| Status | Operator action |
| --- | --- |
| `eligible` | Valid provider evidence found in dry-run. This is not a balance write or a promise that a later concurrent apply will succeed. |
| `applied` | Proof persisted transactionally. The first backfill preserves used credit, active holds, and top-ups instead of granting the period twice. |
| `not_applied` | State changed or proof already exists. Re-run inventory and establish why before treating it as complete. |
| `needs_review` | Missing/mismatched evidence, live data in preview, failed provider lookup, or a balance requiring reconciliation. Investigate individually. Never force an allowance or infer payment from metadata. |

After reviewing dry-run reports, repeat from `cursor: null` with `apply: true` in the approved environment. Re-run the read-only inventory afterward. Repeated apply is idempotent. A subsequent genuine renewal only resets a period after its reservations have settled; a retryable rollover failure must not be discarded as a successful webhook.

Prorated, discounted, partial, multi-line, unknown-price, stale, trialing, or unpaid invoices do not become paid-period proof through this tool. Reconcile such cases against actual Stripe/ledger evidence before rollout; do not automatically credit their nominal plan amounts. Mismatches deliberately fail closed.

## Acceptance checklist

- Unpaid setup saves a first-task draft without provider execution. Checkout cancellation and reload preserve it.
- A success URL or forged session ID does not unlock work. Only verified account-scoped payment does.
- Payment confirmation never starts a task. Explicit Start launches it once; a lost response can recover from its durable assignment without a second launch or another purchase.
- Exhaustion, cancellation, suspension, and subscription expiry stop new execution without changing the selected model or falling back to free inference.
- BYO is optional and still requires a funded workspace. BYO inference has no Overlay model charge; hosted tools and compute remain metered.
- Owners/admins can recover billing. Members receive owner-directed recovery and cannot fund another workspace through a forged checkout return.
- Work assignment, chat, native/remote agents, computers, cloud machines, automations, direct APIs, and atomic reservations refuse unpaid new execution. Matching holds and settlement remain replayable.
- Self-hosted billing-disabled installations still run using their independently configured providers.
- Existing paid proof is populated without changing prior spent/reserved/top-up balances. Duplicate and out-of-order webhooks cannot duplicate credit or revive a canceled subscription.
- Inspect mobile and dark-mode onboarding, billing recovery navigation, retired model selection, and actual first-task completion in the current isolated preview.

Focused local checks: `npm run test:billing`, changed billing/onboarding/server tests through `tsx --test`, affected Convex tests through `npx vitest run --config vitest.config.mts`, targeted ESLint, owner-funded/shared-isomorphic boundary checks, and repository typecheck. Unit fixtures do not replace hosted checkout, provider, or migration acceptance.

## Incident response

Stop new execution or temporarily disable checkout while investigating. Do not roll back into free authorization or silently switch BYO customers onto platform-funded inference. Keep settlement, history/export, and billing recovery available. Retain migration reports and ledger evidence for reconciliation.
