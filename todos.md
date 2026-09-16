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
- [ ] **Run the Phase 2 exit gate live** — after Phase 1 verification: DM a
  managed `claude-code` agent, confirm the reply streams through
  `managedHarnessAgentTurnWorkflow`, then send a second message and confirm the
  native session resumes via `agentHarnessSessions.resumeState`. Also verify
  stop-button cancellation destroys the in-sandbox session.
- [ ] **Hermes live turn before picker exposure** — `harness-acp@1.0.40`
  constructs fine but `hermes acp` hasn't run a real turn in-sandbox; verify
  before enabling it in the create-agent UI (Phase 3 ships it in the catalog —
  consider policy-allowlisting it out until verified).
- [x] **Set the managed-harness feature flags** — `OVERLAY_FEATURE_MANAGED_HARNESS_AGENTS=true`
  is set on staging. `OVERLAY_MANAGED_HARNESS_ROLLOUT_STAGE` defaults to
  `general`, so every staging workspace passes the rollout gate; narrow it to
  `dogfood` later if you want dogfood-only exposure.
- [ ] **Run the Phase 3 exit gate** — with flags + Vercel creds on a staging
  deployment: Agents > New agent > Hosted on Overlay Cloud, create each catalog
  harness through the UI, screenshot QA both themes, confirm the agent renders
  in directory/mentions, and DM it end-to-end.
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
