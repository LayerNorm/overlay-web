# Workspace pricing: making the pricing page true

Status: decisions made 2026-10-11 (below). Phase 1 shipped 2026-10-11; see "Phase 1 (done)".

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
