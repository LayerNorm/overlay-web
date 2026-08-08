# Architecture and Code-Quality Audit: Workspace Integration

**Snapshot:** 2026-08-07 (local `codex/workspaces` at `bc4d9aa53`)

**Decision:** **Do not promote this revision.** Two unauthenticated side-effecting routes, a broken release-safety gate, incomplete on-prem parity, and several failing characterization gates make the current integration unsafe to release as-is.

**Phase 0 follow-up (2026-08-07):** The two unsafe side-effecting routes and duplicate direct email implementation identified in A-01/A-02 were removed in this worktree. Lifecycle transactional email/outbox behavior was retained and re-verified. The remaining findings in this report are not addressed by Phase 0.

**Phase 1 follow-up (2026-08-07):** Postgres mode now makes an explicit product decision to gate workspace/collaboration and connector surfaces until provider-neutral repositories exist. All API exports are classified, Postgres no longer constructs the Convex connector repository, Convex connector handlers require active workspace membership, and the connector mapping has a compound lookup index. Full Postgres connector parity remains deferred to the later parity phase.

**Phase 2 follow-up (2026-08-08):** The five characterization regressions were repaired without weakening route security: integration tests inject a connector repository, billing auth no longer calls Next's ambient `connection()` for explicit requests, conversation-act tests inject authorization and preserve the 403 premium gate, and user-message persistence failures no longer mask a later history-preparation failure. Documentation navigation, command references, stale phase framing, and OpenAPI's two MCP OAuth operations were reconciled. The required characterization, release-safety, tenancy, on-prem parity, docs-health, typecheck, targeted lint, and production-build checks now pass locally; the full repository lint still reports pre-existing errors outside this phase, and the optional live Convex connector contract remains skipped without deployment credentials.

**Phase 3 follow-up (2026-08-08):** The first controlled simplification slice preserved workspace contracts while separating the `WorkspaceSwitcher` controller from its trigger/menu/dialog presentation and moving the Postgres sharing-policy upsert SQL behind a focused governance helper. The complexity baseline now records 57 complex functions (down from 59 at the audit snapshot), with no new over-budget file/function and no route/schema/feature-flag changes. The remaining workspace service, repository, Convex collaboration, and settings-panel seams remain planned for subsequent focused PRs; this phase does not claim the monoliths are fully decomposed.

## Scope and method

This is a source and verification audit of the integrated repository, not a claim about a live deployment. The working tree was clean before the audit. The active branch is one commit ahead of `origin/staging`; the accumulated work compared with `origin/main` changes **760 files** (`+84,212 / -2,483` lines). The largest areas of change are `src/server` (+34,549), `src/features` (+10,830), workspace/collaboration Convex code (+4,411), migrations (+2,554), and the public app/API layer (+2,491).

I reviewed the documented architecture and deployment lanes, the workspace and email changes, API perimeter controls, dual-backend composition, and the repository's own release checks. I did not deploy, push Convex, invoke providers, or run an authenticated browser smoke.

## Executive summary

The new workspace work generally follows the intended BFF wrapper pattern, and the existing package/shared-module guardrails still pass. The failure is at the seams that a merge needs to preserve:

1. A newly added **public email endpoint is an unauthenticated arbitrary-recipient mail relay**. It bypasses the existing configuration-driven transactional-email outbox, audit trail, and `/api/v1` controls.
2. The retained **workflow spike endpoint is public and starts durable work with no authentication, authorization, rate limit, origin check, idempotency, or audit**. The release-safety gate correctly fails on it.
3. Workspace integration mappings are **hard-wired to Convex even when the app-data provider is Postgres**. At the same time, 78 collaboration/workspace API exports have no Postgres support classification. The claimed on-prem parity is therefore not releasable.
4. The regression suite is not green: release safety, tenancy, documentation health, on-prem parity, and five route-characterization cases fail. Passing local unit tests are not sufficient evidence for a staging release.
5. The codebase has crossed a maintainability threshold: 59 production files exceed the 500-line budget, 59 functions exceed the complexity limit, and eight server route handlers exceed 250 lines. The current complexity check passes only because these are accepted in its baseline.

The focused path is subtraction first: remove the two unsafe endpoints, restore a single email path, decide whether workspace collaboration is supported in Postgres now, and make the release checks authoritative. Do not start a broad refactor before those boundaries are restored.

## Verification results

| Check | Result | Interpretation |
| --- | --- | --- |
| `npm run check:module-boundaries` | Pass | Shared React module packages remain presentational. |
| `npm run check:shared-isomorphic` | Pass | 120 shared modules meet the isomorphic import rule. |
| `npm run check:vendor-boundaries` | Pass | No vendor SDK imports were found in routes/features. |
| `npm run check:domain-service-boundaries` | Pass | Checked files still delegate to domain services. |
| `npm run check:tenant-boundaries` | Pass | The connector mapping has an explicit tenancy/provider decision. |
| `npm run test:release-safety` | Pass | Unsafe development routes are absent and public-route controls pass. |
| `npm run test:route-characterization` | **Pass: 69/69** | Integration, billing, and conversation-act response contracts are restored. |
| `npm run check:on-prem-parity` | Pass | Provider capability and route-support matrices pass; the optional live Convex contract is skipped without credentials. |
| `npm run docs:health` | Pass | Navigation, command references, public wording, and OpenAPI inventory are reconciled. |
| `npx tsc --noEmit` | Pass | Dependencies are present in this worktree and direct TypeScript compilation succeeds. |
| Targeted ESLint on risky new files | Pass | Formatting/type-style checks do not catch the architectural issues. |
| `npx next typegen` | Pass | No route-type collision was found. |
| Chat/file boundary checks | Pass | The focused chat transcript and file route boundaries remain intact. |
| `npm run check:web-complexity` | Pass with debt | It reports 57 complex functions and 56 large production files in the current baseline; existing debt remains accepted while the ratchet blocks net-new violations. |

## Findings

### A-01 — Public, unauthenticated email relay

**Severity: P0 / release blocker**

`src/app/api/email/send/route.ts` is a public `POST` route outside the documented `/api/v1` surface. It takes caller-controlled `to`, `subject`, `html`, `text`, `from`, and `replyTo` values, then invokes `sendEmail()` directly. The only control is a per-IP limit of ten requests per minute. Anyone who can reach the deployment can send mail through configured Resend or SES credentials, choose arbitrary recipients, and attempt sender/reply-to overrides. The `GET` handler also discloses which email provider is configured.

This is not a harmless convenience endpoint:

- A rate limit does not provide authentication, authorization, template allow-listing, spending control, or reputation protection.
- Raw caller-supplied HTML is accepted without a product-level template or content policy.
- The route returns provider errors to callers and bypasses the normal mutation audit/idempotency model.
- It creates a second email implementation (`src/server/email/email-service.ts`) with separate environment variables and provider construction.
- The repository already has the intended path: config-validated `EmailProvider`, `EmailOutboxDelivery`, transactional outbox, lifecycle event publisher, and audit records. Its lifecycle tests explicitly validate metadata-only events and resolving recipient data at delivery time.

The security test only scans `src/app/api/v1`, so it cannot catch this route. The architectural source of truth says public cross-surface APIs are `/api/v1/**`, and Next route handlers are public HTTP endpoints unless they add controls.

**Remediation**

1. Remove `src/app/api/email/send/route.ts` and `src/server/email/email-service.ts` before release. Remove their direct dependencies if nothing else uses them.
2. Route all product-triggered mail through the existing lifecycle event → transactional outbox → configured `EmailProvider` path. This preserves provider neutrality, retry/idempotency, PII minimization, and auditability.
3. If an email API is truly required, introduce it only as an authenticated `/api/v1` BFF service with a narrow server-owned command, not a generic mail API:
   - service/admin authorization and same-origin mutation controls;
   - fixed sender and template identifiers chosen server-side;
   - recipient selection derived from an authorized resource, not client input;
   - a strict schema, bounded subject/template variables, idempotency key, durable outbox record, audit event, and per-principal quota;
   - no caller-provided raw HTML, `from`, or arbitrary `replyTo`.
4. Add a release check that inventories **all** `src/app/api/**/route.ts` handlers. New non-v1 routes should either be in a small explicit allow-list with replacement controls or fail CI.

**Exit test**

- Anonymous `POST /api/email/send` is 404 after removal (or 401/403 for a deliberately retained internal endpoint).
- A valid lifecycle event creates exactly one audited outbox item; retrying the same idempotency key creates no second email.
- Negative tests prove caller-provided recipient, sender, and raw HTML cannot reach a provider.

### A-02 — Public workflow spike can start unbounded work

**Severity: P0 / release blocker**

`src/app/api/v1/workflows/spike/route.ts` calls `start(spikeWorkflow, [])` in a bare `POST` handler. It accepts no request/context, invokes no BFF helper, and returns a raw workflow run ID or raw error text. It has no auth, authorization, CSRF/origin check, rate limit, idempotency, audit, feature flag, or production guard.

`npm run test:release-safety` fails specifically because this route neither calls `handleBffRoute` nor declares complete replacement controls. Adding it to the exception list would only document missing controls; it is not a safe remedy. Since this is a viability spike, it should not be a public product endpoint.

**Remediation**

1. Delete the endpoint from the production application. Keep the workflow test in a test-only harness or a local script.
2. If an operational smoke endpoint is indispensable, put it behind service authentication, disable it outside an explicitly configured non-production environment, rate-limit it, avoid returning internal errors/run identifiers, and make it impossible to ship by default.
3. Keep product workflow starts behind the existing authorized automation routes and their server-side ownership checks.

**Exit test**

- `npm run test:release-safety` passes without adding a permissive exception.
- Anonymous requests cannot create a Workflow SDK run in staging or production.

### A-03 — Workspace integration mapping breaks Postgres/on-prem portability

**Severity: P1 / release blocker for self-hosted/Postgres deployments**

The app-data abstraction advertises `WorkspaceConnectorRepository`, but `src/server/app-data/repositories.ts` constructs `new ConvexWorkspaceConnectorRepository()` in **both** its Postgres and Convex branches. The workspace-aware integrations route then unconditionally reads/writes that repository.

Consequences:

- A Postgres deployment listing, connecting, or disconnecting an integration still requires a configured Convex deployment and `INTERNAL_API_SECRET`.
- The feature can fail only after the route is exercised; the safe Postgres boot test does not cover it.
- The new collaboration surface has no complete provider-support declaration: `npm run check:on-prem-parity` reports 78 unclassified `/api/v1` route exports, including agents, channels, direct messages, collaboration state, workspace governance, memberships, teams, sharing, and invitations.
- The parity matrix also drifts because the `discovery` rule is missing from its expected inventory.

This is not merely missing documentation. It is a direct dependency on the backend the Postgres mode is intended to replace.

**Remediation decision required**

Choose one of these before shipping:

1. **Support the feature in Postgres now (recommended only if the pilot needs it).** Implement a `PostgresWorkspaceConnectorRepository`, migration, ownership/unique indexes, factory selection, and contract tests. Add explicit Postgres route-support rules and parity-matrix entries for every workspace/collaboration operation, then prove the flows against a disposable Postgres deployment with no Convex URL or secret.
2. **Gate the feature off in Postgres now (recommended if collaboration is not a pilot requirement).** Make the capability false at bootstrap, hide workspace/collaboration controls, and have every corresponding BFF route return a truthful unsupported-capability response before any Convex call. Record the feature as unsupported in the parity matrix. Do not leave partially functional routes exposed.

For the connector storage itself, use a provider-neutral record with a database-enforced unique key such as `(workspace_id, user_id, provider_key)`. Keep provider credential ownership in the integration provider; the workspace mapping should only reference an authorized connection identifier.

**Exit test**

- A Postgres-only process (no `NEXT_PUBLIC_CONVEX_URL`, no `INTERNAL_API_SECRET`) can run the selected supported flows, or it consistently exposes no collaboration/integration mapping capability.
- `npm run check:on-prem-parity` is green and includes negative tests that prove no Convex request is made from the Postgres integration route.
- The route-support inventory has no unclassified API exports.

### A-04 — Connector authorization and tenancy controls are incomplete

**Severity: P1**

`workspaceConnectors` is a new Convex table with `workspaceId` and `userId`, but `npm run check:tenant-boundaries` fails because `docs/deploy-operate/tenancy.mdx` does not record its current and future tenant decision.

More importantly, the Convex handlers in `convex/integrations/workspaceConnectors.ts` authenticate the supplied user but do not establish that the user is an active member of the supplied workspace. The BFF normally resolves workspace context, but a public Convex handler should still enforce its resource boundary. The list/read paths also query all mappings for a workspace then filter in memory by user instead of using a compound index.

No cross-workspace data disclosure was demonstrated in this audit: returned rows are filtered by `userId`. The current defect is an unauthorized-association and defense-in-depth gap that will become more dangerous as shared workspaces, direct Convex access, or aggregate mapping behavior expands.

**Remediation**

1. Make the handler prove active workspace membership (or make it server-secret-only if browser-direct access is unnecessary). Do not trust a caller-supplied workspace ID merely because the caller owns the connection.
2. Add an index keyed by `workspaceId`, `userId`, and `providerKey`; query it directly. Back it with a matching Postgres uniqueness constraint if Postgres is supported.
3. Add negative contract tests for an authenticated user who is not a workspace member, archived users/principals, and a removed membership.
4. Add `workspaceConnectors` to the tenancy decision table with its shared-multitenant migration requirement in the same change as the schema/handler fix.

### A-05 — Regression tests are red and currently mask behavior drift

**Severity: P1**

The integrated test signal is contradictory: focused subsystem checks pass while release/characterization suites fail.

- `npm run test:route-characterization` has **5 failures out of 69**.
  - The integration list test now returns no connected provider because the new workspace-mapping lookup reaches a real/failing Convex path that the test did not model.
  - Two billing-route tests call Next's `connection()` outside a request scope, so the test harness no longer exercises their intended unauthenticated/origin behavior.
  - Two conversation-act characterization expectations no longer hold: a premium-gating case returns 500 rather than 403, and a persistence-error ordering assertion fails.
- `npm run test:release-safety` is red because of A-02.
- `npm run check:tenant-boundaries`, `npm run check:on-prem-parity`, and `npm run docs:health` are red.
- A direct `npx tsc --noEmit` cannot finish in this worktree because physical dependencies are stale. The lockfile is consistent (`npm ci --dry-run --ignore-scripts` completes), so this is a local verification blocker rather than evidence of a bad dependency declaration.

**Remediation**

1. Treat every failure as an unresolved product decision until either the previous behavior is restored or the characterization test is deliberately updated with an explicit rationale and an authenticated route-level test.
2. Inject/fake the workspace-connector repository in the integration route test; do not allow the test to fall into a real Convex client.
3. Update the billing tests to run through the actual request context or test the extracted authorization helper directly. Do not remove the origin/unauthenticated assertions.
4. Trace the two conversation-act failures to the first changed boundary (premium authorization versus persistence preparation) and restore the documented response contract before changing expected values.
5. Rehydrate dependencies with `npm ci` in the designated canonical checkout, then run typecheck/build from a clean worktree. Do not use this feature worktree to push Convex.

### A-06 — API and documentation governance has drifted

**Severity: P1**

The code has competing operational truths:

- `docs/develop/architecture.mdx` still instructs readers to use `npm run convex:push:all`, which directly contradicts the checked-in worktree-staging workflow and repository instructions. That command must not be used from a feature worktree.
- `docs/develop/automation-durability-and-visual-editor.md` describes completed/staged validation, including passing typecheck, production build, and on-prem parity. Current local gates do not support those claims.
- `npm run docs:health` reports an orphaned knowledge-base page, a stale workspace plan, four references to the removed `npm run lint:changed` script, and OpenAPI drift: 86 documented operations versus 88 public boundaries, missing `POST` and `DELETE /api/v1/mcps/oauth`.
- The public-route security test only scans `/api/v1`, which is how the unsafe email route in A-01 escaped the advertised source-of-truth contract.

**Remediation**

1. Correct the Convex deployment instruction immediately: the architecture doc should link to the staging workflow and never recommend `convex:push:all`.
2. Update the automation plan's completion statements to distinguish historical evidence from current release status; keep only verified facts.
3. Repair the docs-health failures and regenerate the OpenAPI document in the same change that changes routes.
4. Add an API inventory test for the whole `src/app/api` tree. It should classify framework metadata, auth callbacks, externally required webhooks, legacy compatibility routes, and `/api/v1` routes. New unclassified side-effecting routes must fail CI.
5. Make `docs:health`, `test:release-safety`, `check:tenant-boundaries`, `check:on-prem-parity`, and the relevant characterization suite required before merge to `staging` and `main`.

### A-07 — Complexity budgets have become a dashboard, not a guardrail

**Severity: P2**

The complexity report currently accepts existing debt instead of preventing it from expanding:

- 59 production files exceed the default 500-line budget.
- 59 functions exceed complexity 25.
- Eight BFF route handlers exceed 250 lines.
- Major current monoliths include `convex/collaboration/workspaces.ts` (2,329 lines), `src/features/chat/components/ChatExperience.tsx` (2,103), `src/server/workspaces/PostgresWorkspaceRepository.ts` (1,491), `src/server/workspaces/WorkspaceService.ts` (1,012), and `src/features/workspaces/components/WorkspaceSettingsPanel.tsx` (1,116).

The exact-duplicate scan reports zero unapproved duplicate groups, and the module/shared/vendor checks pass. This is therefore not an argument for an indiscriminate rewrite. The risk is concentrated change: one workspace feature now crosses giant service, repository, schema, route, and UI files, which increases merge-conflict, review, and regression cost.

**Remediation**

1. Freeze new functionality in the largest workspace files until A-01 through A-06 are green.
2. Split by stable domain seams, not by arbitrary line count:
   - `WorkspaceService`: membership/invitation, teams, governance/limits, resource scopes/sharing, and lifecycle/archive operations.
   - `PostgresWorkspaceRepository` and Convex counterpart: the same repository subdomains with shared contract tests.
   - `convex/collaboration/workspaces.ts`: workspace lifecycle, principals/memberships, teams, policies/audit, and resource scopes.
   - `WorkspaceSettingsPanel`: separate data/controller hooks from presentational sections.
3. First extract pure logic and narrow repository interfaces; preserve endpoints and data shapes. No schema redesign is needed for this step.
4. Change the complexity baseline policy to ratchet downward: no new over-budget files/functions, and remove a bounded number of existing exceptions per focused PR. Keep explicit, temporary per-file exceptions with owner and expiry.

## Recommended remediation sequence

### Phase 0 — Stop unsafe release paths (same day)

**Owner:** application-security/backend

1. Delete the public email relay and its parallel direct provider service.
2. Delete the workflow spike route from the shipped app.
3. Add direct negative tests for both paths and broaden the public API inventory test.
4. Do not promote while `test:release-safety` is red.

**Exit:** release-safety and API-inventory checks pass; no anonymous side-effecting route remains outside an explicit, reviewed boundary.

### Phase 1 — Make workspace portability a product decision (1–3 days)

**Owner:** backend/platform

1. Decide: full Postgres support for collaboration now, or explicit feature gating in Postgres.
2. Implement the chosen route support, capability behavior, and provider factory selection.
3. Replace the Convex-only connector mapping with the selected supported implementation.
4. Add active-membership authorization, compound index/uniqueness, tenancy documentation, and negative tests.

**Exit:** Postgres tests run with no Convex configuration, all API exports are classified, and the integration route cannot silently call Convex in Postgres mode.

### Phase 2 — Restore proof and documentation (1–2 days)

**Owner:** feature owner + QA

1. Repair the five characterization failures without weakening their security assertions.
2. Reinstall dependencies in a clean canonical checkout; run complete typecheck and production build.
3. Resolve docs-health and OpenAPI drift; correct unsafe/deceptive workflow and Convex operational guidance.
4. Make the red checks required CI gates before the next merge.

**Exit:** all commands in the release checklist are green from a clean worktree, and the docs describe the actual deployment and parity state.

### Phase 3 — Controlled simplification (next 2–4 focused PRs)

**Owner:** domain owners

1. Extract workspace service/repositories by domain boundary.
2. Establish a shrinking complexity baseline and block net-new exceptions.
3. Keep endpoint contracts, schema compatibility, and feature flags stable while extracting.

**Exit:** no large change requires edits across unrelated workspace concerns; complexity count trends downward rather than being re-baselined upward.

## Release checklist after remediation

Run from a clean integration/staging worktree after installing dependencies; do not deploy Convex from a feature worktree.

```bash
npm ci
npm run check:shared-isomorphic
npm run check:module-boundaries
npm run check:vendor-boundaries
npm run check:domain-service-boundaries
npm run check:tenant-boundaries
npm run test:release-safety
npm run test:route-characterization
npm run check:on-prem-parity
npm run docs:health
npm run typecheck
npm run build
```

Then perform authenticated staging smoke tests for:

- workspace membership, invite acceptance/removal, workspace switching, and cross-workspace denial;
- integration list/connect/disconnect in the selected app-data mode;
- one durable automation start/cancel/approval path, with no anonymous workflow start possible;
- one lifecycle email generated from a permitted product event, verified in the outbox/audit trail rather than through a generic send endpoint.

## What is healthy and should be preserved

- The feature-module, shared-isomorphic, vendor-import, chat-transcript, and file-route controls are useful and currently passing.
- Workspace HTTP routes inspected in this audit generally use `handleBffRoute`; preserve that BFF pattern rather than moving authorization into components.
- The lifecycle-event/outbox email design is the correct one to extend.
- The workspace contract and separate Convex/Postgres repositories are the right shape. Complete that seam or truthfully gate it; do not add more Convex-only exceptions under an ostensibly provider-neutral interface.

## Limitations

This audit establishes source-level and local-test evidence only. It does not prove production deployment state, data migration correctness on a populated database, third-party provider configuration, live workflow execution, email delivery, or cross-browser UX. Those require the clean-gate run and authenticated staging smoke tests above.
