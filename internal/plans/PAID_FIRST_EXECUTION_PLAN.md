# Paid-first Overlay: implementation plan

Status: conversational onboarding approved and implementation in progress on the feature branch. Payment-evidence separation, durable task drafts and the production onboarding controls are being implemented; execution-boundary integration is in progress. These changes are not yet verified or deployed. Complete free-tier infrastructure removal remains required at completion. No production billing changes or existing-user cutoff have occurred.

### Implementation checkpoint

- Interactive onboarding mockup: `internal/plans/mockups/paid-first.html`, built from adjacent TSX/CSS using the actual onboarding choice, employee, context, invite and shared UI components. Opens at the first onboarding question, not a state-selector dashboard.
- Matches the conversational onboarding reference. Navigation is hidden during setup, as in `OnboardingShell`; there is no invented replacement sidebar.
- Covers profile setup, optional connections including BYO, a first-task draft, subscription checkout handoff, canceled/pending payment and an explicit Start after simulated verification. Checkout, connections and execution are simulations. The prototype ends at the onboarding handoff, not a redesigned Work screen.
- Desktop light/dark and mobile layouts were visually reviewed. Draft retention across canceled checkout and explicit Start were exercised. Persistence across reload and real server payment verification remain application requirements, not implemented claims from this prototype.
- The standalone build, builder syntax check and targeted ESLint passed. A focused TypeScript check is blocked by the imported `Creature.module.css` declaration in the isolated mockup config; adding Next's global types did not resolve it. This is not an application-wide typecheck or backend acceptance result.
- Pricing, budget recovery and existing-user retirement screens remain in the implementation scope below but are not presented as alternate onboarding scenes. Review those in their actual product contexts rather than a generic dashboard.
- Next: finish application enforcement and free-path retirement, verify the full feature branch, then review its isolated preview. Production cutoff and infrastructure removal still require the notice, migration and release gates below.

## 1. Product decision

Overlay-hosted workspaces require payment before their first real execution. There is no free execution tier, free trial, paid trial, or trial credit. Bringing a supported subscription or API key is optional, never a prerequisite and never a payment bypass.

Keep the existing monthly workspace subscription and prepaid usage ledger. Start with the existing $8/month minimum, credited toward usage, subject to a first-task economics/reliability launch check. This is a subscription, not an $8 charge per task. Preserve existing renewal, credit-expiry, top-up and cancellation terms unless separately approved. Do not introduce a new billing platform or couple this work to a Stripe SDK upgrade.

### Recommended access rules

| Workspace state | Allowed | Not allowed |
| --- | --- | --- |
| No paid plan | Sign in, limited workspace setup, connection configuration, manual task drafts, existing history and exports, billing | AI chat, writing, task/agent execution, automations, computer startup, paid tools, background inference |
| Payment pending | Same setup/history access; clear payment-pending state | Execution until payment and funding are verified |
| Paid, funded | Supported models, connected agents, tools and computers, subject to permissions and budget | Spending beyond authorized limits |
| Paid, budget exhausted | History, exports, configuration and top-up | New execution, including BYO execution; no free-model downgrade |
| Payment failed, suspended or entitlement ended | History/export and billing recovery | New execution; no personal-account/free fallback |
| Canceling at period end | Existing paid access through the funded entitlement period | New access after that period ends |

Execution includes the first chat message, not just the Work task's Start button. Creating or assigning a task remains non-executing. Joining a funded workspace does not require a separate personal subscription. Entitlements are checked against the workspace paying for the work.

Pre-payment access is bounded setup, not a replacement free productivity plan: no unrestricted file uploads, indexing, transcription or new storage-consuming workflows. Preserve access to existing data without deleting it or requiring payment to export. Existing data retention continues under existing policy; do not promise indefinite free storage.

Self-hosted/billing-disabled deployments retain their existing administrator-controlled policy. The hosted payment requirement must not silently break that mode. Explicit institutional/contract access needs a deliberate policy mapping, not an accidental exception based on a nonzero balance.

## 2. Current code and system overview

Reviewed the local checkout at `14c84149b`. These are source observations, not assertions about live Stripe configuration or production behavior.

- `src/shared/billing/billing-pricing.ts` already defines an 800-cent minimum and free/paid plan kinds.
- `src/features/marketing/pricing/PricingSections.tsx` markets free execution, monthly paid credits and default stop-at-zero behavior.
- `src/server/billing/billing-runtime.ts` and `packages/overlay-billing/src/entitlements.ts` treat lack of paid budget as free-tier privileges.
- `src/server/conversations/ActEntitlementService.ts` allows free/BYOK model paths without a paid plan and suggests switching to a free model when budget runs out.
- `src/server/agents/workspace-agent-invocation.ts` explicitly adds the free router as a fallback for a configured model that is not entitled.
- `src/server/billing/BillingPayerResolver.ts` falls back to a personal payer when a workspace has no paid wallet. This is unsuitable as authorization for paid-first execution.
- `convex/platform/usage.ts` has separate personal and workspace reservations, idempotency checks and atomic budget/spend-limit accounting. Preserve those protections.
- `src/server/billing/WorkspaceBillingService.ts` verifies checkout and persists subscription state; `convex/billing/stripeWebhooks.ts` synchronizes lifecycle events. Both paths need one consistent paid-and-funded activation rule.
- `src/server/automations/AutomationEntitlementPolicy.ts` exposes a user-keyed plan lookup. Trace its concrete callers and make workspace execution scope explicit.
- `src/server/onboarding/ConversationalOnboardingService.ts` defaults to prepared replies. Pre-payment onboarding need not spend inference to remain useful.
- `src/server/ai/subscriptions/service.ts` implements the Codex request adapter, enabled by deployment configuration. Broader provider support is not part of this launch.

Target flow:

`Authenticated actor -> authorized workspace -> execution eligibility -> model/capability policy -> atomic spend reservation -> provider/agent execution -> usage settlement`

Checkout supplies verified workspace funding. BYO changes who supplies inference, not whether the workspace may execute. Provider failures, insufficient customer funds and insufficient platform-provider balance are distinct failures and must not be hidden by a free-model fallback.

## 3. Implementation workstreams, in order

### A. Approve the experience before changing UI

Create standalone mockups under `internal/plans/mockups/` for review, then implement the approved designs using shared UI primitives. Keep copy minimal and use the existing shell.

Cover: the single paid pricing offer; pre-payment workspace; first-task payment gate; checkout-pending/canceled return; funded workspace; budget-exhausted state; and a member who must ask the workspace owner to subscribe. Show optional subscription connections without making them an onboarding step everyone must complete.

Proposed flow: configure workspace and draft a first task -> Subscribe -> verified funding -> return to the preserved draft -> explicit Start/Send. Do not auto-run on the checkout redirect, browser reload or webhook delivery. Do not lose attachments or create duplicate queued runs during this handoff; pre-payment attachment staging, if offered, must be bounded and non-processing.

### B. Introduce one server-authoritative execution policy

Add a shared execution-access contract with explicit states such as `subscription_required`, `payment_pending`, `ready`, `budget_exhausted` and `billing_suspended`. Keep transport details out of UI components. Return stable machine-readable errors and authorized recovery actions; do not leak billing details to members lacking permission.

Separate three concerns:

1. Workspace subscription/access eligibility, including verified paid period and suspension.
2. Actor permissions, model privacy policy and spend limits.
3. Per-operation budget availability and atomic reservation.

A boolean `planKind === paid` is not sufficient evidence of payment. A positive balance alone must not override an inactive entitlement. Preserve authorized in-flight reservations: a run holding the last available cents must not fail because its own reservation reduced unreserved balance to zero. New work must reserve its own funds; policy reads must not cause duplicate automatic top-ups.

Use the policy for all hosted execution, including BYOK, subscription-backed models and connected user-owned machines. Keep zero provider inference cost distinct from zero total operation cost. No paid-model selection exception may recreate a free product.

During migration only, retain legacy `free` values for compatible reads, interpreting them as setup-only. By completion, migrate current operational records and callers to explicit unpaid/setup-only states and remove free-plan runtime branches and temporary compatibility paths. Historical records may retain original values as data, not as executable entitlements. Preserve history without a destructive blanket rename.

Primary files: server and package entitlement helpers, `ActEntitlementService.ts`, `BillingPayerResolver.ts`, `ActUsagePolicy.ts`, `convex/platform/usage.ts`, and billing account subscription/entitlement queries.

### C. Close every execution and background-work path

Build a call-site checklist before edits, using `owner-funded-operations.ts` and `billable-feature-coverage.ts` as seeds, not a complete inventory. Confirm each entry reaches the policy before an external call, machine allocation or billable background job.

- Chat/act, regeneration, notebook agent, writing and extension planning.
- Work task start/queue/retry, named agents, connected agents and remote-run dispatch.
- Automation enablement and each scheduled/event-triggered dispatch, including Slack/API/MCP entry points and child agents.
- Computer provisioning/resume and continuous runtime billing.
- Image/video generation, transcription, paid search and other external tools.
- Supporting inference: titles, suggestions, memory extraction, embedding/indexing and compaction. Use deterministic behavior or skip nonessential enrichment before payment.

Recheck eligibility when queued work actually starts and before subsequent spend. A scheduled job must not keep retrying a payment-required error. Mark it blocked with a visible billing reason, retaining its definition and checkpoints. Re-enable or resume with deliberate user action rather than replaying a backlog after payment.

When funds run out, stop admitting new spend, settle authorized work and suspend/terminate billable compute according to provider capabilities. Ensure idle cleanup and settlement continue even when execution is blocked. Bound metering lag and provider overshoot through reservations, leases and concurrency limits; do not claim mathematically zero overspend from a UI balance check.

### D. Make checkout and renewal activation unambiguous

Reuse the existing workspace Checkout, customer portal, webhook and ledger integrations. Do not create trial periods, trial-end settings, promotional trial credits or a new trial product.

- Authorize the workspace and billing-management role server-side for checkout and verification. Reject sessions belonging to another actor/workspace/product/environment.
- Activation requires server-verified payment plus the correct subscription/funding record. A success URL, browser state, `trialing`, or subscription creation alone cannot grant execution.
- Reconcile checkout verification and webhooks idempotently so either order works, even if the user closes the browser.
- Explicitly verify invoice-paid, payment-failed, subscription update/delete and asynchronous payment success/failure handling supported by the current Stripe integration. Do not assume dependency defaults provide all needed coverage.
- Grant monthly funding exactly once per paid period. Handle duplicate/out-of-order events without double credit or stale reactivation. Preserve existing approved cancellation/refund/credit rules and verify how revocation affects available funds.
- Preserve top-up opt-in, customer ceilings and per-member/programmatic limits. No surprise auto-recharge.
- Inspect actual Stripe configuration before rollout for any existing trials or promotion paths. This plan does not assume there are live trial customers.
- Review tax treatment and active registrations before enabling Stripe Tax. This change does not authorize tax-setting changes.

### E. Remove free routing and misleading product promises

Remove free-router selection, defaults and fallback from hosted execution, including low-platform-Gateway-credit fallback. Lack of provider capacity should produce an explicit service error, not a weaker product sold as the selected model.

Migrate saved free-model selections to a reviewed paid default only with a visible explanation before the next run. Do not rewrite historical messages, silently switch BYO credentials, or execute a newly paid model without the user's Start/Send action. Preserve privacy/ZDR and capability checks when selecting the default.

Paid Auto, if retained, must have a defined quality/cost policy and a reviewed default; it must not be the free router with a new label. Launch can simply use an explicit paid model instead.

Update the model picker, upgrade/budget dialogs, workspace creation/billing UI, onboarding, landing/pricing pages, metadata, FAQs, lifecycle emails and published product documentation. Remove promises such as Start free, weekly free runs, no card needed, and switching to free when credit runs out. Do not replace them with unlimited-use claims.

Delete all free-tier infrastructure by completion: routers, provider adapters used solely for free routing, fallback logic, allowances/quotas, routing endpoints, refresh crons, catalog polling, free-tier UI, feature flags, dedicated configuration/secrets and exclusively free-tier deployment resources. Migrate remaining callers first; do not retain dormant paths or compatibility shims that can restore free execution. Remove free-tier-specific tests and fixtures, replacing relevant coverage with paid-first denial and migration tests. Archive or migrate data before dropping exclusively operational free-tier tables/indexes; preserve historical ledger records and reconciliation. Shared settlement/pricing helpers still used by paid execution remain, without free-tier branches.

Completion requires a repository and deployment inventory showing no remaining free-tier runtime, scheduled jobs, dedicated resources or activation switches. A feature flag set to off does not count as removal. Historical references, archived data, unpaid setup states and independently supported self-hosted billing policy are not free execution infrastructure.

Primary areas: `src/shared/ai/gateway/`, `src/server/ai/gateway/`, `src/server/harness/`, conversation model selection/defaults, `convex/platform/overlayFree*`, `convex/crons.ts`, `src/shared/billing/free-allowance.ts`, marketing, workspace UI and `packages/overlay-chat-react` model controls.

## 4. Existing-user migration and safe release

Approved policy: new workspaces have no free execution at launch; existing free workspaces receive 14 days' notice and then become setup/history-only. The notice is a retirement window, not a new trial. There is no permanent grandfathered execution tier and no automatic charge.

Before release, produce a read-only, aggregate migration inventory: unpaid workspaces, active free runs/computers, scheduled work, saved free models, legacy trials if any, and paid workspaces affected by exhausted-budget fallback. Exact queries and definitions must be reviewed before relying on counts. Do not export customer content or credentials.

Deployment approach:

1. Ship a separate additive preparation release with payment proof, invoice reconciliation and the operator-only backfill, without enforcement or free-code removal. Populate and reconcile existing paid workspace proof before cutover.
2. Give existing free workspaces 14 days' notice before the announced launch/cutoff. The final implementation cuts over all hosted workspaces together at that launch, after notice; it retains no grandfathered/free execution cohort or temporary activation switch.
3. Complete isolated PR Preview acceptance of the approved UI, server policy and older-client recovery, plus first-task economics checks. No free execution is offered to new workspaces from launch.
4. At cutoff, drain or stop free jobs, settle legitimate existing reservations and shut down unfunded compute. Preserve data, task definitions and audit history.
5. Release the final paid-first UI, enforcement and free-code deletion after prerequisite proof is populated. Do not merge the full feature PR as the additive preparation release: it immediately enforces paid access.
6. Audit and remove exclusively free deployed configuration/resources and any migration-only compatibility paths. Preserve ledger/history data; completion requires both repository removal and deployed-resource retirement.

Operator steps, dry-run/apply semantics and launch gates are documented in `internal/develop/paid-first-rollout.md`.

Use main PRs and the merge queue. Request isolated Preview QA with `needs-preview` only once the revision is ready. Deploy customer Convex only from clean current main after matching production web is live. No shared dev/production deploy from feature worktrees.

Rollback must preserve the no-unfunded-execution invariant. Pause new execution or disable checkout during an incident; do not restore old free authorization as the generic rollback. Keep migration additive until the new policy is stable.

## 5. Verification and acceptance

Implementation verification uses focused checks after edits. Local fixtures are not live billing or deployment acceptance; record those results separately.

Required automated scenarios:

1. Unpaid workspace is blocked before any provider call or machine creation through chat, Work, connected agents, automations and direct API calls, including forged/stale clients and BYO/free-model IDs.
2. Setup, history, export and billing work without execution; membership in a funded workspace works without buying a personal plan. Non-managers cannot alter billing or another workspace's funding.
3. Verified payment unlocks the correct workspace exactly once; abandoned/unpaid/pending/forged checkout does not. Webhook-before-return, return-before-webhook and duplicate/out-of-order events converge.
4. Funded execution reserves and settles correctly; concurrent runs cannot double-spend. Zero-budget, failed top-up, ceilings and member limits stop new work without free fallback.
5. Existing reservations survive their own budget hold; suspended/expired access prevents new work, while cleanup/settlement remains possible. Queued and scheduled jobs recheck access.
6. BYO inference is not billed as Overlay-supplied inference, but Overlay compute/tools and supporting calls are funded and metered. A provider disconnect does not silently select Overlay-paid inference.
7. Legacy free model selections and free users migrate safely; self-hosted/billing-disabled policy remains intact; saved history remains readable.

Start with existing tests adjacent to the modified areas: `billing-runtime.test.ts`, `BillingPayerResolver.test.ts`, `WorkspaceBillingService.test.ts`, billing provider tests, conversation entitlement tests, `convex/stripeWebhooks.convex.test.ts`, reservation tests and onboarding/client tests. Add regression tests that fail against the old free access/fallback behavior.

Commands for the implementation phase, scoped to the final change set:

- `npm run test:billing`
- `NODE_OPTIONS=--conditions=react-server npx tsx --test <changed server test files>`
- Run changed `*.convex.test.ts` files with the repository's Vitest configuration, resolving the exact command from CI before execution.
- `npx eslint <changed files>`
- `npm run check:owner-funded-boundary`
- `npm run check:shared-isomorphic`
- `npm run typecheck` once at the final gate; record any independently established pre-existing failures rather than silently skipping them.
- Run the repo-required build/CI checks for the final PR. Do not run live paid-provider canaries as ordinary unit tests.

Hosted QA in the isolated PR Preview must cover signup/setup -> draft -> checkout -> verified funding -> explicit Start -> successful task; cancellation/pending payment; depleted balance; optional BYO; legacy free workspace; and an invited member. Use Stripe test-mode credentials and isolated backend/provider resources only. Browser QA is a future implementation acceptance step, not authorization to charge a real card now.

Launch quality gate: demonstrate representative real tasks on the recommended default, including an agent task needing a computer, within the starting budget. Record customer charge, underlying inference/compute/tool costs, failures/retries and completion. Include processor fees and platform overhead in the economic assessment. If $8 does not buy a useful outcome, revisit price or scope before launch rather than substituting inferior free models.

## 6. Measurement

Instrument workspace-level checkout start, verified funding, first execution start, first successful outcome, budget block, top-up, renewal and cancellation. Distinguish user/BYO inference from Overlay-supplied inference and separate customer funds from underlying costs. Deduplicate by workspace/run/payment event; do not send prompts, credentials or customer content to analytics.

Compare signup cohorts using explicit denominators: paid workspaces per new eligible workspace, successful first tasks per newly funded workspace, retained paid workspaces per original signup cohort, and contribution margin per cohort. Also monitor provider failures, payment failures, early exhaustion and refunds. Increased conversion percentage alone is not success if fewer paying customers remain or margins worsen.

## 7. Proposed delivery slices

1. **Payment preparation:** additive payment evidence, checkout/webhook funding and operator-only backfill, released without enforcement so existing paid accounts can be reconciled first.
2. **Paid-first experience:** approved mockups implemented, first-task checkout handoff, model/default changes, copy and client handling, isolated E2E acceptance.
3. **Cutover and complete removal:** reviewed migration inventory, notice/cutoff, all free-tier code/configuration/jobs/resources deleted, temporary compatibility paths removed, reconciliation and post-launch monitoring. This is required scope, not optional follow-up work.

These are one coordinated launch, not independent releases that may leave unpaid execution reachable. Land additive compatibility work first; do not enable the new policy until server and UI acceptance are complete.

## 8. Decisions and confidence

Already settled by the user: no free tier or trial, pay before first task, BYO subscription optional, and complete removal of free-tier infrastructure at the end rather than leaving it disabled.

Approved plan defaults: keep the current $8 monthly-credit minimum initially; keep pre-payment setup/history access; require funded paid access for all hosted execution including BYO; give existing free workspaces 14 days' notice; preserve self-hosted billing-disabled behavior. Price adequacy is a launch validation question, not a claim made by this plan.

Overall confidence: high in the policy and main affected architecture; medium in the exhaustive integration inventory until implementation call-site tracing and live configuration inspection. Core billing, entitlement, agent fallback, onboarding and marketing paths were reviewed, not every caller or dependency. No meaningful percentage-of-code-reviewed estimate is available. Production subscription states, provider terms/support, actual first-task economics and operational cutoff timing remain unverified.

Application implementation is underway on the feature branch. Stripe configuration, production data, and release state have not been changed. The approved mockup, local component checks, unit/contract tests, hosted acceptance, migration, notice and production cutoff are distinct gates; none substitutes for another.
