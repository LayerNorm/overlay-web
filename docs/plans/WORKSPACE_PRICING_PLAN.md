# Workspace pricing: making the pricing page true

Status: decisions made 2026-10-11 (below). Phases 1–4 shipped 2026-10-11/12; see the "(done)" sections.

## How we work on this (owner, 2026-10-11)

Workspace billing is where the product is going, so we build it as the product, not as an experiment:

- **One switch, on for everyone.** Workspace billing goes straight to `general`. No per-workspace allowlist, no `internal`/`selected` stages, no parallel account-plan path kept alive "just in case". The staged rollout code can be deleted once billing is on.
- **Work on `main`, push, deploy.** There is no meaningful usage on the platform, so there is nothing to protect with staging lanes, canaries, or feature flags. Proportionate checks (typecheck, lint, the relevant tests) still run before each push.
- **Fix forward.** If something breaks, fix it on `main` rather than building revert paths for a migration that touches six accounts.
- **The six paid accounts still keep what they paid for.** The only care we take is not to leave a paying person worse off: their credit and Stripe subscription move to their workspace, and their storage and paid features keep working.

## The model (what `/pricing/preview` promises)

- **A workspace is free or paid. An account is neither.** No plan, price, or "paid" label on the account.
- **Free workspace:** only free resources (Auto model with weekly limits, notes, chats, files, knowledge, 10 MB). A person can own at most three free workspaces.
- **Paid workspace:** every resource (premium models, Overlay Cloud computers, web search, browser tasks, image/video, storage).
- **A monthly plan of $8 or more** (up to $500) becomes that much credit each month. Unused credit does not carry over.
- **Past the credit** is on-demand usage, only if the owner allows it: **hard stop** (default) or **automatic top-ups** up to a monthly limit.
- **Billing is itemized per resource**, added up as you go (the Vercel usage view).

## What already exists (do not rebuild)

| Piece | Where | State |
| --- | --- | --- |
| A workspace can be the payer; workspace wallet, checkout, top-up, portal | `BillingPayerResolver`, `WorkspaceBillingService`, `WorkspaceBillingSection`, `/api/v1/workspaces/[id]/billing/*` (B3) | Built, off in production (`OVERLAY_FEATURE_WORKSPACE_WALLETS` unset) |
| Free allowance counted per workspace | `free-allowance.ts`, `usageCounterSubject` (B2) | Built |
| Cap of 3 free workspaces per owner | `MAX_FREE_WORKSPACES_PER_OWNER`, `WorkspaceService.createOrganization` | Built |
| Move a personal plan onto a workspace (same Stripe subscription, one transaction) | `convex/billing/planConversion.ts` (B4) | Built, never run in production |
| Credit = allowance + top-up buckets; holds; per-member spend limits | `usage-buckets.ts`, budget reservations, `billingAccountSpendLimits` | Built |
| Chat and agent runs charge the workspace when it is the payer | `getPayerEntitlements` in `ActUsagePolicy` | Built |

## Gaps between the preview and the product

1. **The account still has a plan.** 49 files read `planKind`. Chat and agent runs already follow the workspace, but storage limits (`convex/files/lib/storageQuota.ts`, `storage-limits.ts`), the agents UI's paid check (`use-paid-plan.ts`), sidebar meters, Settings → Account and the usage write path (`applyUsageEvents`, `ensurePersonalBillingAccount`) still read the person's own plan. Needed: everything reads **the workspace being worked in**.
2. **No on-demand for workspaces.** Auto top-up is not supported for a workspace plan. Needed: workspace auto top-up, off-session consent by an owner/admin, hard stop as the default, a **monthly limit** (new field), and a notice at the limit.
3. **No per-resource usage ledger.** Usage is stored as totals (`tokenUsage`, `usageOperations`, `dailyUsage`). Needed: a ledger keyed by workspace, resource and month, plus the Usage panel in Workspace → Billing.
4. **Plan range.** Code stops at $200 (`PAID_PLAN_MAX_AMOUNT_CENTS`, `TOP_UP_MAX_AMOUNT_CENTS`); raise to $500 (D7).
5. **Unused credit.** Top-up balance persists across cycles today; D2 says nothing carries over.
6. **Settings → Account** shows Free/Paid, "Upgrade to paid", "Change plan" and Manage billing. These go; the page lists your workspaces with their state.
7. **`/pricing`** still serves the legacy account page; the new one is at `/pricing/preview`.

## The six paid accounts

Read-only previews (2026-10-11), each into the person's home workspace:

| Account (last 6 of user id) | Plan | Home workspace | Humans | Notes |
| --- | --- | --- | --- | --- |
| …CDTFFT | $8 | `personal-16c4csb` | 1 | clean |
| …TN0N9J | $8 | `personal-18prmbq` | 1 | clean |
| …AZGD85 | $8 | `personal-1qg6jdn` | 1 | $7.95 of $8 used this cycle |
| …M7DAM3 | $8 | `personal-nsh60w` | 1 | uses 11.8 MB (over the free 10 MB) |
| …WR8RNW | $8 | `personal-e97r64` | 1 | clean |
| …4TYKZA (the owner's own) | $20 | `personal-1n34zae` | 2 | uses 29 MB; the second person will draw from this workspace's credit |

The only blocker was billing being off; all six are `active` (D5 needs nothing). Convert all six with `convertPlanToWorkspace` right after storage and the paid check follow the workspace (phase 1), so no one loses upload room or paid features.

## Phase 1 (done 2026-10-11)

- Storage limits follow the workspace's plan: `getStorageLimitForUser` (`convex/files/lib/storageQuota.ts`) raises a person's limit to their active workspace's paid plan; bytes are still counted per person. Test: `convex/storageWorkspacePlan.convex.test.ts`.
- Automations' paid check (`src/server/automations/http.ts`) and the plan reported by `/api/subscription/settings` (model picker, zero-data-retention) follow the workspace's payer. `/api/v1/subscription` (sidebar, agents UI) and chat/agent/generation runs already did.
- Settings → Account no longer shows a plan; it links to Workspace → Billing. `AccountBillingPanel` and `TopUpPreferenceControl` are deleted (the account hook's checkout handlers are now unused; remove in cleanup).
- Plans up to $500 (D7 done early): `PAID_PLAN_MAX_AMOUNT_CENTS` / `TOP_UP_MAX_AMOUNT_CENTS` = 50,000; Workspace → Billing offers $500.
- `/pricing` serves the workspace page with copy that matches today (monthly, weekly free limits, own up to three, no rollover); `/pricing/preview` keeps the on-demand and itemized sections (`full`).
- Production: `OVERLAY_FEATURE_WORKSPACE_WALLETS=true` and stage `general` on Vercel and Convex; the six paid plans converted.

Left for later phases: the remaining personal-plan reads that do not gate anything a paid person needs (admin page, analytics, the account hook), and the personal checkout API.

## Phase 2 (done 2026-10-11)

- **Hard stop by default.** A paid workspace at $0 stops paid resources (free ones keep working) unless an owner turns on automatic top-ups.
- **Automatic top-ups with a monthly limit.** `billingAccountSubscriptions.autoTopUpMonthlyLimitCents` (new); `getByServer` also returns `autoTopUpSpentThisPeriodCents` (automatic top-ups pending or succeeded since the period started). The rule is one pure function, `decideAutoTopUp` (`src/shared/billing/auto-top-up.ts`): on, consented, a Stripe customer, a valid amount, and spent + amount ≤ limit; no limit means no top-ups.
- **Charging.** `maybeAutoTopUpWorkspaceBudget` (`src/server/billing/stripe-billing.ts`) charges the workspace's saved card off-session and records the top-up through `recordTopUpByServer` (credited on success; a declined card is recorded as failed and falls back to the hard stop). `ensurePayerBudgetAvailable` calls it when a workspace payer is short, which covers chat, agents, generation, browser tasks and notebooks.
- **Settings.** `POST /api/v1/workspaces/[workspaceId]/billing/auto-top-up` (owners and admins; turning it on records off-session consent). Workspace → Billing has a "When credit runs out" card (hard stop / keep going, amount, monthly limit) and a notice when this month's limit is reached. The billing summary carries `autoTopUp`.
- **Pricing page.** `/pricing` now shows the "When credit runs out" section; the itemized example bill stays on `/pricing/preview` until phase 3.
- Also in this round: the memory-profile job asks for plain text (its JSON schema failed on every run and left a hold to reconcile each time), memory extraction and profiles follow the workspace's plan and bill the workspace, and the Billing tab no longer shows customers Overlay's provider cost and margin.
- Tests: `src/shared/billing/auto-top-up.test.ts`, `convex/workspaceAutoTopUp.convex.test.ts`.

Follow-ups (done 2026-10-11): a top-up Stripe leaves `pending` (3-D Secure) is settled when Stripe finishes it, by the `payment_intent.succeeded` / `payment_failed` / `canceled` webhook handlers and a 5-minute Convex job (`convex/billing/autoTopUpReconcile.ts`) that asks Stripe about anything still pending (given up after 24 hours); only one automatic top-up is in flight per workspace. Owners and admins get one email per billing period when the monthly limit is reached (`billing.auto_topup_limit_reached`). For the webhook path, the Stripe endpoint must send `payment_intent.*` events; the job works without it.

## Phase 3 (done 2026-10-11)

- **No second ledger.** Every charge to a workspace already settles as a finalized `budgetReservations` row (kind, model, operation, amount). The itemized list adds those up per resource for the current period (`usageTotalsByServer`, `convex/billing/usageTotals.ts`); finalize now also stores `usageTokens` and `usageSeconds` so lines show quantities. Older rows have amounts but no quantities.
- **Charges outside reservations.** The machine-time meter charges a workspace balance directly, and `recordBatch` records usage in batches; both now store the amount, kind and seconds/tokens on their `usageOperations` row, which the totals include. Rows from before 2026-10-12 have no amount, so the first period's list can be a little under "used this period" (about 11¢ of $12.62 on the owner's workspace).
- **Resources** (`src/shared/billing/usage-resources.ts`): models (split per model; ids the catalog does not know are shown as readable names), automations (workflow steps), Overlay Cloud computers, web search, browser tasks, image and video generation, transcription, memory, knowledge and search indexing.
- **Follow-up (fixed 2026-10-12):** `recordBatch` (chat suggestions, notebook and chat usage recorded without a reservation) charged the person's own account even in a paid workspace. It now charges the paid workspace's balance (`chargeWorkspaceDirect`, capped at what the balance holds) and records the amount for the itemized list; the person's account is untouched. "The person's current paid workspace" is one helper, `paidWorkspaceAccountFor` (`convex/billing/workspacePayer.ts`), also used by storage limits.
- **Reconciled total (2026-10-12):** the list always adds up to the balance's "used this period"; anything the per-resource lines cannot account for (charges recorded before amounts were stored) shows as one "Earlier usage" line.
- **Workspace → Billing → Usage this period:** total, on-demand charges, days left in the cycle, and one line per resource with quantity and cost; Models expands per model. Included for paid workspaces in the billing summary (`usage`).
- **Pricing page:** `/pricing` is the full page; `/pricing/preview` is deleted.
- Tests: `src/shared/billing/usage-resources.test.ts`, `convex/workspaceUsageTotals.convex.test.ts`.

## An account is never free or paid (2026-10-12)

- `POST /api/checkout` and `POST /api/topups/checkout` answer `410 account_plans_retired`; turning on an account auto top-up through `/api/subscription/settings` does too. Workspace plans and top-ups are the only purchase paths.
- The legacy account-plan pricing page (`PricingClient`, `MarketingShowcase`) is deleted; `/pricing` is always the workspace page.
- The chat's "add a top-up" and top-up preference actions open Workspace → Billing; the account page's billing hook keeps only capabilities and messages.
- Left for cleanup (phase 6): the personal `subscriptions` billing fields and the personal payer fallback for free workspaces (which only counts the free allowance).

## Phase 4 (done 2026-10-12)

- **Plan range:** any whole dollar from $8 to $500 for the monthly plan and for one-time top-ups (Workspace → Billing now takes a typed amount instead of fixed choices; server validation already accepted the range). Storage scales with the plan (about 1 GB per $8), so a $500 plan gets about 62.5 GB.
- **Credit expiry (D2):** at renewal both the month's credit and any top-up balance start again (`upsertByServer` and `upsertFromStripeInternal`); before, leftover top-up balance carried over. The top-up card and the pricing FAQ say so.
- Test: renewal case in `convex/workspaceAutoTopUp.convex.test.ts`.

## Phase 6 (done 2026-10-12)

- **Done — rollout code:** the `workspaceWallets` flag, `OVERLAY_FEATURE_WORKSPACE_WALLETS`, `OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE` and the internal/selected allowlists are gone (`workspace-billing-rollout.ts` deleted). The payer resolver, knowledge and memory payers, storage limits and the Billing tab no longer ask whether billing is on; a paid workspace pays. The billing summary has no `rollout` field.
- **Done — plan conversion:** `convex/billing/planConversion.ts`, its test and runbook are deleted. Stripe events for the six converted subscriptions still route to the workspace by subscription/customer id (`workspaceAccountByProviderReferenceInternal`). The `billingPlanConversions` table was emptied in production (6 rows) and dropped from the schema.
- **Done — personal plans:** a person's own entitlements are always the workspace's free allowance (no plan, credit or top-ups); personal holds can only be free work; recorded usage outside a paid workspace is never charged to the person. Deleted: the personal subscription writers and readers (`convex/billing/subscriptions.ts` keeps only webhook bookkeeping), the personal branches of the Stripe webhook, `syncPersonalBillingShadows` and `accountMigration`, the Stripe sync and personal portal/cancel actions, `BillingCheckoutService`, personal auto top-ups, the admin personal budget grant, and the old backfill/verification scripts. `/api/checkout/verify`, `/api/topups/verify`, `/api/portal` and `POST /api/subscription/settings` answer `410 account_plans_retired`. Account deletion no longer cancels a Stripe subscription from the person's row (for the six converted plans that subscription belongs to the workspace).
- **Fixed on the way:** the Convex automation policy still read the person's own plan, so in a paid workspace enabling an automation (or running a scheduled one) was refused once accounts became free. It now checks the workspace the automation belongs to.
- **Rows (done):** the personal plan fields were stripped from all 348 `subscriptions` rows and removed from the schema, with the `by_stripeCustomerId` index.
- **Caught after the strip:** two memory-extraction triggers decided "paid" from `tier !== 'free'`, which an empty `tier` turned true for everyone (the paid extraction model, then a refused personal hold). Memory extraction is now paid only when a paid workspace pays for it.

## Order of work

| # | Phase | What |
| --- | --- | --- |
| 1 | Workspace is the payer, and billing is on | Storage limits, the agents UI paid check and the remaining `planKind` reads follow the workspace's plan (one helper); set `OVERLAY_FEATURE_WORKSPACE_WALLETS=true` and `OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE=general` on Vercel and Convex production; deploy; convert the six accounts; remove the account plan UI and personal checkout. |
| 2 | On-demand | Workspace auto top-up, consent, hard stop default, monthly limit, limit notice. |
| 3 | Itemized usage | Per-resource ledger written where credit is charged; the Usage panel in Workspace → Billing with real data. |
| 4 | Plan range and credit expiry | $8–$500 (D7); credit does not carry over (D2). |
| 5 | The page | `/pricing` serves the workspace page (copy updated below); delete `PricingClient`, `AccountBillingPanel`, `/pricing/preview`. |
| 6 | Cleanup | Delete the staged-rollout code (`selected`/`internal` stages and allowlist envs), the personal `subscriptions` billing fields, `syncPersonalBillingShadows`, the plan-conversion tool and runbook once the six are moved, and `MarketingShowcase` leftovers. |

Phases ship one at a time on `main`. The pricing page goes up as soon as it does not promise anything missing; if 2 and 3 are not done yet, ship it without the hard-stop/top-up and itemization sections and add them back as each lands.

## Decisions (owner, 2026-10-11)

- **D1. Monthly.** A monthly plan of $8 or more is that much credit each month, plus on-demand beyond it. This is the existing Stripe subscription and allowance-plus-top-up buckets.
- **D2. Unused credit does not carry over.** The month's credit resets at renewal, including any top-up balance.
- **D3. Own up to three free workspaces.** The cap is on workspaces a person owns; joining other people's free workspaces is not limited.
- **D4. Keep the current billing change rules.** Owners and admins manage plan, payment and top-ups; `usageTopUpBy` decides who may add credit.
- **D5. Past-due account.** Already `active` again; nothing to do.
- **D6. Free-tier wording states the real limits.** Weekly limits per workspace (15 ask, write and agent turns and 600 seconds of transcription a week today, `free-allowance.ts`), not "unlimited".
- **D7. Any amount, $8 to $500.** Raise `PAID_PLAN_MAX_AMOUNT_CENTS` and `TOP_UP_MAX_AMOUNT_CENTS` to 50,000 and check checkout and storage-by-spend still hold.

### Page and mockup copy that follows

`/pricing/preview` and `docs/plans/mockups/pricing-mockup.html`: "You pay once" becomes monthly wording; "From $8" becomes "From $8 a month"; the free card and FAQ state the weekly limits; "part of up to three" becomes "own up to three"; add "Unused credit does not roll over"; custom amount accepts up to $500.

## Testing (proportionate)

- Unit tests for the one "may this workspace use this resource" helper and for storage limits following the workspace.
- Convex tests for the new pieces: top-up stops at the monthly limit; hard stop pauses paid resources and leaves free ones; the ledger sums to the charged credit.
- After each deploy: one of the six workspaces still shows its credit, a chat in it draws from it, and a free workspace behaves as before.
