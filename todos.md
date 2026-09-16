# Todos

## Harness implementation

Owner interventions needed for `docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`:

- [ ] **Set Vercel Sandbox env credentials** — `VERCEL_TOKEN`, `VERCEL_TEAM_ID`,
  `VERCEL_PROJECT_ID` (plus optional `OVERLAY_VERCEL_SANDBOX_REGION`). Harness
  provisioning fails closed without them; the Phase 0 smoke only worked because
  a local Vercel CLI session existed, which the service deliberately does not
  rely on.
- [ ] **Run the Phase 1 exit gate live** — with credentials set, POST
  `/api/v1/agent-environments/managed` with
  `{mode:'harness', harnessId:'claude-code'}`; verify the `overlay_cloud`
  environment (approved, `adapters:[{id:'claude-code',protocol:'harness'}]`),
  lease, and audit event in Convex; then repeat against Postgres
  (`OVERLAY_DATABASE_URL` / `npm run app-db:migrate` for migration 0076).
- [ ] **Apply migration 0076 + Convex schema** — `agent_harness_sessions` needs
  `app-db:migrate` for Postgres deployments and a `convex:push` (staging/main
  lanes only — never from a feature worktree) for the new Convex table.
- [ ] **Run the Phase 2 exit gate live** — after Phase 1 verification: DM a
  managed `claude-code` agent, confirm the reply streams through
  `managedHarnessAgentTurnWorkflow`, then send a second message and confirm the
  native session resumes via `agentHarnessSessions.resumeState`. Also verify
  stop-button cancellation destroys the in-sandbox session.
- [ ] **Hermes live turn before picker exposure** — `harness-acp@1.0.40`
  constructs fine but `hermes acp` hasn't run a real turn in-sandbox; verify
  before enabling it in the create-agent UI (Phase 3 ships it in the catalog —
  consider policy-allowlisting it out until verified).
- [ ] **Set the managed-harness feature flags** — `managedHarnessAgents`
  (config, or `OVERLAY_FEATURE_MANAGED_HARNESS_AGENTS=true`) plus
  `OVERLAY_MANAGED_HARNESS_ROLLOUT_STAGE` (`internal`/`invited`/`general` and
  the matching workspace-id lists). Both default off; the picker stays hidden
  until they're set.
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
