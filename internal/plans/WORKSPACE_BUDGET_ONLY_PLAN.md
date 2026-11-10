# Workspace budget only

Status: Phases 1–4 done on branch, unit tested (nothing merged). Phase 5 not started.

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
| Gateway cost correction | Exact gateway cost can still adjust a direct charge later; it no longer depends on a reservation. |
| Data | `budgetReservations` stops receiving new rows. The table, stale-hold sweep and reconciliation queue are deleted once no live code reads them; existing rows are settled or released first. |

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | `workspaceBudgetLow` helper; pre-call gates use it; `recordBatch` returns `budgetLow`; `WORKSPACE_FUNDS` copy says under 2% left | Done on branch (unit tested) |
| 2 | Harness: delete forecast/quote estimates, model and billing reservations, funding pause, per-task limit, child budget split; stop after a step that leaves the budget low | Done on branch (unit tested). The next dispatch stops the run; gateway cost correction is not yet wired to direct charges. |
| 3 | Chat, connected agents, automations, tools and media routes: delete holds, charge directly, stop on low | Done on branch (unit tested). `ensureProviderBudgetNotLow` / `chargeProviderUsage` in `billing-runtime.ts`; Convex background work uses `billing/providerBudget:providerBudgetGate` (no top-up from Convex). Automation workflow steps are charged after the run. The notebook agent stops when a step leaves the budget low. Not yet: Preview provider guard does not refuse direct-charge work. |
| 4 | Computers and machine metering: delete holds, floor and per-run cap | Done on branch (unit tested). `ComputerAdmission` uses `ensureProviderBudgetNotLow` (2% after a top-up, spend limits); `ComputerBilling.bindPayer` replaces the allocation hold. `meterSandboxLeaseDebitByServer` charges observed usage capped at the balance and returns `budgetLow` / `spendLimitReached`; the Next meter tries one top-up, then stops the machine (`budget_exhausted` / `spend_limit_exceeded`). E2B running time is charged as observed (no 5-minute headroom); Boat charges only counter advances. The dead turn hold (`ManagedAgentSandboxBilling.reserve`), $15 per-run cap, $1 floor and their env vars are deleted. Legacy lease holds are released on their next tick. The Preview guard now stops work from recorded spend after each direct charge. Not yet: a real paid machine run. |
| 5 | Delete reservation tables, sweeps, reconciliation and docs; production check of a real paid run | Not started |

Untested so far: everything in a real paid run.
