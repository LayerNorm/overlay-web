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
  before enabling it in the create-agent UI (Phase 3).
