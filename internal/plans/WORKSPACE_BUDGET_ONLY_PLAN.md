# Workspace budget only

Status: Phase 1 done on branch; phase 2 in progress (nothing merged).

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
| 2 | Harness: delete forecast/quote estimates, model and billing reservations, funding pause, per-task limit, child budget split; stop after a step that leaves the budget low | Not started |
| 3 | Chat, connected agents, automations, tools and media routes: delete holds, charge directly, stop on low | Not started |
| 4 | Computers and machine metering: delete holds, floor and per-run cap | Not started |
| 5 | Delete reservation tables, sweeps, reconciliation and docs; production check of a real paid run | Not started |

Untested so far: everything in a real paid run.
