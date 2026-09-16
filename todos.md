# Todos

## Harness implementation

Owner interventions needed for `docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`:

- [x] **Set Vercel Sandbox env credentials** — done for **staging**:
  `VERCEL_TOKEN` (from the local Vercel CLI auth token), `VERCEL_TEAM_ID`,
  `VERCEL_PROJECT_ID`, and `OVERLAY_FEATURE_MANAGED_HARNESS_AGENTS=true` are on
  the `overlay-web-staging` Vercel project (Production env). Still needed for
  **local dev** (`.env.local`) and **production** when promoting.
- [ ] **Run the Phase 1 exit gate live** — with credentials set, POST
  `/api/v1/agent-environments/managed` with
  `{mode:'harness', harnessId:'claude-code'}`; verify the `overlay_cloud`
  environment (approved, `adapters:[{id:'claude-code',protocol:'harness'}]`),
  lease, and audit event in Convex; then repeat against Postgres
  (`OVERLAY_DATABASE_URL` / `npm run app-db:migrate` for migration 0076).
- [x] **Apply migration 0076 + Convex schema** — `agentHarnessSessions` table +
  indexes pushed to the shared dev deployment (`different-caiman-77`) via
  `convex:push:dev` from the staging worktree. Postgres path still needs
  `app-db:up && app-db:migrate` for Postgres-backed deployments.
- [x] **Run the Phase 2 exit gate live** — verified on staging 2026-09-16: a DM
  to a managed `claude-code` agent streamed through
  `managedHarnessAgentTurnWorkflow` (reply + tool calls rendered in the normal
  transcript), a second message answered with prior-turn context, and the
  "Stop response" button renders mid-turn. Caveats: `agentHarnessSessions`
  persisted no `resumeState` (the claude-code adapter emitted none — context
  carried via room history instead), and mid-turn stop-click could not be
  verified because turns finished before the click landed.
- [x] **Managed Claude Code turn debugged on staging** — first attempts failed
  `owner_funded_budget_declined` (sandbox reservation needs ~$15.30/turn; grant
  test credit via `platform/usage:adjustAdministrativeBudgetByServer`, NOT
  `recordTopUpByServer` — the canonical-balance top-up is silently reverted by
  `syncPersonalBillingShadows`, which rewrites `billingAccountBalances` from
  the legacy `subscriptions` row on every billing mutation; likely a real bug
  worth a follow-up). Then turns failed inside the workflow with Vercel
  rejecting the `x-api-key` injection rule: `AI_GATEWAY_API_KEY` was set but
  EMPTY on `overlay-web-staging`, so the adapter fell back to the runtime's
  `VERCEL_OIDC_TOKEN` JWT as the injection value. Set the real `vck_…` key on
  the project (Production env) — also required on production before launch.
- [ ] **Hermes live turn before picker exposure** — `harness-acp@1.0.40`
  constructs fine but `hermes acp` hasn't run a real turn in-sandbox; verify
  before enabling it in the create-agent UI (Phase 3 ships it in the catalog —
  consider policy-allowlisting it out until verified).
- [x] **Set the managed-harness feature flags** — `OVERLAY_FEATURE_MANAGED_HARNESS_AGENTS=true`
  is set on staging. `OVERLAY_MANAGED_HARNESS_ROLLOUT_STAGE` defaults to
  `general`, so every staging workspace passes the rollout gate; narrow it to
  `dogfood` later if you want dogfood-only exposure.
- [x] **Run the Phase 3 exit gate** — verified on staging 2026-09-16 via the
  Playwright-attached Chrome session: the Hosted on Overlay Cloud runtime
  picker lists Overlay + Claude Code/Codex/OpenCode/Pi/Hermes, Claude Code was
  created through the UI, and 6 DMs ran end-to-end in its sandbox. Not covered:
  the other five runtimes' creation, both-theme screenshots, directory/mention
  rendering. Two cosmetic notes: the editor's Sandbox status shows "offline"
  even while turns work (reconcile treats `overlay_cloud` envs as connected
  hosts), and a `/workspace` working dir resolves to the sandbox's real
  `/vercel/workspace` root.
- [x] **Reset-session e2e** — `POST …/reset-harness` returns 200 with
  `sandboxDestroyed: true` and clears `agentHarnessSessions` (the Convex-arg
  fix in `276be8c39` landed). The UI confirm dialog races the Playwright tab
  group, so the click itself is unverified — the endpoint is proven.
- [x] **Post-reset stale-sandbox turn failures** — root cause found and fixed
  in `149eaa8bd`: reset/expiry leaves the lease `running` with a destroyed
  `providerReference`; `ManagedAgentSandboxBilling.reserve()` reconnected
  unconditionally → every turn threw at dispatch ("could not start this turn"),
  and `settle()` rethrew inside `finalizeManagedHarnessTurn` AFTER the reply
  was persisted → the workflow catch ran `failManagedHarnessTurn`, marking the
  written message failed (that's why responses rendered no text) and the run
  `model_failed`. Fix: reserve tolerates a dead ref (fresh sandbox bills from
  zero baseline), settle reads the lease's CURRENT providerReference (the
  acquire step repoints it on recreate), and every settle call site is
  .catch-guarded — `markForReconcile` recovers the cents without failing the
  turn. Regression test asserts settle calls in finalize are guarded.
- [x] **Provisioning 500s + turn failures (second root cause)** — the staging
  project's stored `VERCEL_TOKEN` was rotated/dead: raw `Sandbox.create`
  returned `403 Not authorized` while the current CLI token succeeded.
  Replaced `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID` on
  `overlay-web-staging` with clean values (the earlier ones also carried a
  literal `\n` suffix — app `.trim()`s it, but stored values are now clean).
  Verified: OpenCode provisioning 201, local smoke test creates sandbox +
  HarnessAgent session + real `hi.txt` write.
- [x] **Runtime picker locked after creation** — a hosted agent's harness is
  its identity (environment, binding, sessions are all per-harness), so the
  editor renders a read-only row on edit instead of the switchable selector
  (`149eaa8bd`). Switching = archive + recreate.
- [x] **Verify reply text renders post-fix** — verified on staging 2026-09-16:
  a post-reset turn recreated the sandbox (`overlay-harness-e6eb2e03`,
  repointing lease `9e251862`), completed with `reset-proof.txt` written and
  read back, and the settled reply renders its text in the transcript.
  Second root cause found + fixed in `08eb8e1cc`: the transcript writable
  kept reply text in `content` and never emitted a `text` part, while the
  settled UI renders from `parts` — tool-using replies persisted content but
  rendered textless. Finalize now appends a text part when none exists.
- [ ] **Editor "Agent not found" on expired sessions** — the side-panel editor
  renders "Agent not found" (not a re-auth prompt) when the WorkOS token
  lapses mid-session: `agents.get` 401s → `loadFailed` → not-found copy.
  Consider distinguishing auth failure from genuinely missing agents.
- [ ] **Exercise a managed tool approval end-to-end** — DM a managed agent a
  prompt that triggers an approval-gated tool; confirm the run flips to
  `waiting_for_approval`, the card renders the requested tool names, approving
  resumes the same workflow (check the reply continues on the same turn), and
  denying produces a `tool-output-denied` part in the transcript. Also verify
  stop-button cancellation while the workflow is parked.
- [ ] **Daytona managed provider — deferred for now** (owner call, Phase 4
  follow-up). When revisiting: `DAYTONA_API_KEY` is already in local env;
  set `OVERLAY_HARNESS_SANDBOX_PROVIDER=daytona`, provision
  `POST /api/v1/agent-environments/managed` with `{mode:'harness',
  harnessId:'claude-code', provider:'daytona'}`, run a turn, and confirm the
  harness reaches its in-sandbox bridge port through the private preview link.
- [ ] **Verify a BYOK managed turn** — add a user `user-vercel-ai-gateway`
  provider connection (Settings), bind a managed `claude-code` agent to it via
  Model access, DM the agent, and confirm the turn is funded by the connection
  (no Overlay model-usage reservation) with the key read from the vault at run
  time — it must never appear in binding config, workflow state, or sandbox
  env.
- [ ] **Mobile parity in `overlay-mobile`** — the sibling app needs the managed
  capability bootstrap plus harness/provider labels in the agents roster and
  editor parity with the web pickers (runtime, model, model access).
- [ ] **Box stays excluded for managed harnesses** — no action; the provider
  seam rejects it until egress allowlisting and safe credential forwarding
  exist. Revisit only with a Box rate card (`computeBoxRuntimeCost`) if it's
  ever offered.
