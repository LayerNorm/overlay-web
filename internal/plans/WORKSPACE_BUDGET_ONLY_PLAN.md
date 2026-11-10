# Workspace budget only

Status: Phases 1–5 done on branch, unit tested; not merged, not deployed. The release migration has not run anywhere; nothing is verified in a real paid run.

## Rule

The workspace budget is the only automatic spending limit. Overlay never predicts,
quotes, reserves or holds the cost of a model call or tool call before making it.

- **Before work starts or continues:** refuse only when the workspace already has
  less than 2% of its budget left (`workspaceBudgetLow`). This reads the real balance;
  it is not an estimate. An automatic top-up is still attempted first.
- **After every paid call:** charge the actual cost directly. If the workspace now has
  less than 2% left, the response stops after the current step with the
  `WORKSPACE_FUNDS` diagnostic.
- Unlimited workspaces never stop. Personal (non-workspace) accounts keep their
  existing allowance checks with the same 2% rule.
- Kept on purpose: per-member spend limits an admin sets, explicit task deadlines a
  person sets, and abuse rate limits. Arbitrary step, size and time caps are handled
  in a separate follow-up change.

## Decisions

| Topic | Decision |
| --- | --- |
| Threshold | `remaining < 2% of total`, or `remaining <= 0` when total is 0. Lives in `src/shared/billing/execution-access.ts`. |
| Overshoot | A call can cost more than what is left. The charge stays capped at the available balance (balances never go negative); the run then stops. |
| Harness model calls | `prepareModel` no longer estimates cost. No `reserve_model` cost, no billing reservation, no `pause_for_funding`. Settlement charges directly through `recordBatch`, which returns whether the budget is now low. |
| Per-task limit | `policy.maxCostMicros`, `TASK_SPEND_LIMIT`, child budget split and the `model_spend` resource pause are deleted. |
| Chat, tools, media | `reserveForAttempt` and fixed holds (web search $0.05, media maximum price, transcription, gateway proxy, title, suggestions, notebook, extension plan, tab group label, media intent, automation 20-step hold) become the 2% check before plus a direct charge after. |
| Computers | No 10-minute coverage hold, no $1 credit floor, no $15 per-run cap. Metering charges observed use; under 2% stops the machine. |
| Gateway cost correction | Deleted. It only corrected finalized reservations and nothing started it after phase 2. A charge uses the cost known at settlement (provider receipt, else catalog price); calls with no catalog price still wait for the gateway cost. Rewiring it onto direct charges would need a new ledger-adjusting mutation and workflow wiring; not worth it for catalog-vs-exact differences. |
| Data | `budgetReservations` receives no new rows. The engine, sweeps and reconciliation queue are deleted. `billing/retireHolds` releases (never charges) every open row and legacy lease hold. The table definition, its indexes and `agentSandboxSettlements`, `harnessResourceRequests` and the optional run fields stay so the deploy validates existing rows. Finalized rows are still read by the itemized usage list (`billing/usageTotals`), growth analytics and account deletion until the table is deleted. |

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | `workspaceBudgetLow` helper; pre-call gates use it; `recordBatch` returns `budgetLow`; `WORKSPACE_FUNDS` copy says under 2% left | Done on branch (unit tested) |
| 2 | Harness: delete forecast/quote estimates, model and billing reservations, funding pause, per-task limit, child budget split; stop after a step that leaves the budget low | Done on branch (unit tested). The next dispatch stops the run; gateway cost correction is not yet wired to direct charges. |
| 3 | Chat, connected agents, automations, tools and media routes: delete holds, charge directly, stop on low | Done on branch (unit tested). `ensureProviderBudgetNotLow` / `chargeProviderUsage` in `billing-runtime.ts`; Convex background work uses `billing/providerBudget:providerBudgetGate` (no top-up from Convex). Automation workflow steps are charged after the run. The notebook agent stops when a step leaves the budget low. Not yet: Preview provider guard does not refuse direct-charge work. |
| 4 | Computers and machine metering: delete holds, floor and per-run cap | Done on branch (unit tested). `ComputerAdmission` uses `ensureProviderBudgetNotLow` (2% after a top-up, spend limits); `ComputerBilling.bindPayer` replaces the allocation hold. `meterSandboxLeaseDebitByServer` charges observed usage capped at the balance and returns `budgetLow` / `spendLimitReached`; the Next meter tries one top-up, then stops the machine (`budget_exhausted` / `spend_limit_exceeded`). E2B running time is charged as observed (no 5-minute headroom); Boat charges only counter advances. The dead turn hold (`ManagedAgentSandboxBilling.reserve`), $15 per-run cap, $1 floor and their env vars are deleted. Legacy lease holds are released on their next tick. The Preview guard now stops work from recorded spend after each direct charge. Not yet: a real paid machine run. |
| 5 | Delete the reservation engine, sweeps, reconciliation, cost correction, sandbox settlement markers and the harness resource/funding pause system; release open holds | Done on branch (unit and Convex tested). Not deployed; the migration has not run in production; no real paid run verified. |

Untested so far: everything in a real paid run.

## Rollout

Web first, then Convex. The web code no longer calls the deleted Convex functions, and the Convex arguments it still sends (`reservationId: null` on remote agent starts) stay accepted.

1. Push to main and wait for the native Vercel production deployment of that exact SHA.
2. From clean, current canonical main, deploy Convex to production (`colorful-chickadee-419`), following `internal/develop/convex-workflow.md`. This removes the reservation crons.
3. Release the open holds: `npx convex run --prod billing/retireHolds:releaseRetiredHoldsInternal '{}'`. It works in batches of 50, schedules itself until no `reserved` or `reconcile_required` row is left, then clears legacy lease holds (`billing/retireHolds:releaseRetiredLeaseHoldsInternal`). Rerunning is safe. Check in the dashboard that no `budgetReservations` row is `reserved` or `reconcile_required` and that workspace balances' `reservedMicros` dropped to 0 (or only drift with no matching row).
4. Verify in production: a real paid agent run, a chat message, a web search and a computer start, each charging after the call and stopping under 2%.
5. Later change: once step 3 is verified, delete the `budgetReservations` table, its readers in `billing/usageTotals` (after the current billing period ends), growth analytics and account deletion, plus `agentSandboxSettlements`, `harnessResourceRequests`, the legacy run fields and the ignored `reservationId` start argument.
