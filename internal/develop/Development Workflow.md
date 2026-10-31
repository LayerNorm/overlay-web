# Development Workflow

Use multiple Builder threads to develop independent features and one Integration thread to review and merge ready PRs. Each Builder has its own computer or VM, browser, repository access, and configured test environments.

**The workflow:** assign a feature → implement and validate locally → commit/push
the feature branch → draft main PR → `needs-preview` when needed → current-head
Vercel Preview → browser QA end to end → post QA comment → ready PR → Integration
review → main merge queue → automatic production deployment and smoke.

Production follows **merge to main → automatic Vercel Git production deployment → production smoke checks**. Integration synchronizes Convex when backend changes require it, after matching production web is live. PR previews provide the acceptance environment for sensitive changes too. This document is the authoritative workflow.

## Shared hosting and parallel work

| Setting | Development rule |
| --- | --- |
| Customer-web Vercel project | Use `overlay-landing` for both Preview and Production. The separate staging project, branch and subdomain are retired. |
| Build source | Main deploys automatically through Git. Root `git.deploymentEnabled` sets `"*": false, "main": true`. The trusted controller creates Preview deployments only for `needs-preview` PRs; Preview allows REST API only, also blocking automatic builds from older branches. |
| Build machine | Keep the owner-selected **Enhanced** machine (8 vCPUs, 16 GB memory). Let running builds finish; inspect concrete failures before changing configuration. |
| Build concurrency | Keep on-demand concurrency enabled with **Run up to one build per branch** (`WAIT_FOR_NAMESPACE_QUEUE`). Different PRs build in parallel; revisions sharing one branch/backend build sequentially. |
| Preview URL and backend | Use `https://pr-<number>.preview.getoverlay.io` and that PR's isolated Convex backend. A READY build must match the current PR head before browser QA. |
| Test settings | Shared Preview credentials inherit once per environment and have no scheduled expiry. Keep Preview and Production variable scopes separate. |

For a diagnosed build stall, `OVERLAY_BUILD_DIAGNOSTICS=1` enables build-only Node
resource samples (heap limit/usage, RSS, CPU and GC totals) on stderr in the hosted web command.
Machine-readable subprocess stdout, including TypeScript `--showConfig`, stays clean.
Keep it scoped to the affected Preview branch, then remove it after investigation.
The sampler reports no environment values, arguments or heap contents and does not skip checks.
`OVERLAY_SKIP_BUILD_TYPECHECK` is honored only in the non-hosted GitHub compilation lane;
Preview and Production always retain Next TypeScript validation, regardless of inherited flags.

The trusted `PR Preview` workflow uses the existing `VERCEL_PREVIEW_TOKEN` in
GitHub's `release-control` environment for ordinary custom URL assignment and
cleanup, plus the existing scoped Convex Preview credential for backend renewal.
The token creates requested Preview builds from exact Git SHAs and manages URL
and backend resources. Production stays on native Git. Reuse credentials across PRs. Builders do not create tokens or copy
shared settings for each feature. No Production deployment token or purchased
Preview Deployment Suffix is needed.

`PR Preview Request` handles ordinary `pull_request` events without checkout or
deployment secrets. For internal PRs it dispatches `PR Preview` on `main` with
only the PR number. The controller accepts dispatches only on `main`, checks out
`main`, and keeps the `release-control` environment restricted to that branch.
Fork requests are skipped. Dependabot events have a read-only token and are
also skipped; label the PR as a maintainer or dispatch the controller on `main`.
PRs with merge conflicts may not emit request runs, so manual dispatch and the
six-hour reconciliation remain the fallback for builds and cleanup.

Labeled open PR backends renew within Convex's retention limits. Closing a PR or
removing `needs-preview` settles running builds, removes its owned URL and branch
app setting, deletes its isolated Convex backend and synthetic data, and leaves
the hostname returning HTTPS 404. Re-adding the label creates fresh fixtures.
Six-hour reconciliation also discovers leftover backends for closed/unlabeled
PRs, even when their Vercel resources are already gone. Credential lifetime is separate.

Backend cleanup accepts only the pinned Overlay project Preview credential and
exact PR ownership in project `1649204`. Broader account/team credentials and
keys for other products fail before API access. Production backend
`colorful-chickadee-419` is explicitly blocked even if API metadata misidentifies
it. Dev, production, foreign-project and ambiguous backends cannot be deleted by
this controller. Account administrators retain their manual Convex permissions.

Assign independent features to separate Builders so implementation, builds and
browser QA can proceed in parallel. Each Builder owns one branch and PR. Share
foundations through declared PR dependencies and land them before dependent work.
Integration reviews ready PRs in dependency order and uses GitHub's main merge
queue to check combined revisions. Vercel's build concurrency does not replace
that integration check.

## Operator console releases

`apps/admin` is the separate `overlay-admin` Vercel project at `admin.getoverlay.io`. It follows native Git production from main with its own WorkOS allowlist, session secret and dedicated backend secret. It is not an extra release gate for unrelated customer-web changes.

For admin QA, bind both backend URL settings on the exact feature branch to that PR's isolated Convex backend, reuse the shared Preview admin credentials and provision the matching secret/test operator on that backend, register the test callback, then request an exact-SHA admin Preview through the connected Vercel tools. The existing customer-web preview controller does not configure or clean resources in the admin project. Shared admin Preview backend URLs are blank so unbound builds fail closed. Record the binding and clear branch backend URLs when QA ends; never point an admin PR at shared development or customer production.

Deploy backend changes from clean current canonical main after matching customer web is live. For endpoint retirement, first ship and verify replacement callers; verify authenticated standalone admin acceptance before removing the old web admin. Keep ordinary member initialization and append-only operational audit separate from operator powers. See [Admin Console](../../internal/develop/admin-console.md).

## Local laptop owner path

The owner explicitly authorized local laptop agents acting as `DevelopedByDev`
to push directly to main. Run proportionate checks, review the diff and ancestry,
preserve unrelated edits, and use fast-forward pushes only. Verify origin/main,
the exact native Vercel production deployment and affected behavior afterward.
No PR, merge queue or repeated permission request is required for this local path.
The owner bypass is authorized for this purpose. Never force-push or delete release
branches that are still in use. Cloud Builder threads still follow the PR/preview/merge-queue path below.

## How to use this document

Tag this file in a thread and identify the role and task. The agent follows the matching section below and reads the full repository `AGENTS.md` and relevant living docs before working. Existing account access and environment configuration are prerequisites; use the owner's Divyansh accounts and the configured test credentials.

### Start a Builder thread

```text
You are the Builder agent. Follow the tagged Development Workflow.

Build: [feature or bug fix]
Acceptance criteria: [observable behavior that must work]
Scope: [feature area and any exclusions]
Dependencies: [PRs that must land first, or none]

Implement, run focused checks and local smoke QA, open a draft PR against
main, then test the changed flow in the browser on its Vercel preview.
Fix any issues, push updates and repeat affected QA on the new preview.
Post the QA handoff comment on the PR and mark ready when current-head QA
and required checks pass.
Return the PR, preview URL, exact tested SHA, checks, and limitations.
Stop at the ready PR; Integration handles merging and releases.
```

### Start the Integration thread

```text
You are the Integration agent. Follow the tagged Development Workflow.

Review and integrate ready Builder PRs for this work, in dependency order.
Use the main merge queue under the authorized DevelopedByDev identity.
Check the diff, required checks, and current-preview QA evidence; resolve
findings before queue entry. Verify each merge and report the accepted SHA.
Process independent ready PRs while others are still being built or fixed.

Keep using this thread for subsequent PRs. Report blockers with the exact
failure and the next action. Stop after the available queue is processed;
use supported wait or notification tools if this session supports them.
Main pushes automatically deploy to Vercel; verify the native Vercel deployment SHA and production smoke result.
```

## Builder instructions

### 1. Own one feature

Read the task and acceptance criteria. Make routine implementation decisions yourself. Ask only when a missing product decision or dependency prevents useful progress.

Fetch current `origin/main` and create one descriptive `codex/<slug>` branch in an isolated feature worktree, following [Agentic Development](agentic-development.mdx). Keep other agents' branches and unrelated owner edits intact. Each Builder owns its feature branch through the PR handoff.

If the feature depends on another PR, declare the dependency. Land shared foundations first, then start the dependent features from updated main.

### 2. Implement and run local smoke QA

Build the requested behavior and update affected living documentation and root `CHANGELOG.md` under Unreleased in the same change.

Package render tests preload the shared Node stylesheet and JSX shims, matching ordinary CI rendering; run the package's own test command when adding render coverage.

Run the smallest checks that cover the change. Use `npm run dev` for local web work with your engineer-owned dev backend. Run a smoke check of the affected route or behavior before pushing. Record the actual commands and results. Required repository CI remains mandatory.

Match QA to risk: visual changes need rendered UI checks; auth, billing, tenant boundaries, migrations, and backend changes need their relevant stronger checks. Read the installed Next.js guides before writing Next.js code.

Web and admin ESLint configurations pin their own TypeScript config roots so a
single changed-file check can include both apps without ambiguous root detection.

### 3. Open a draft PR to get the preview

Commit and push the feature branch and open a draft PR against `main`. Opening
the draft PR starts normal CI; adding `needs-preview` requests the hosted build.
Keep the PR draft while implementation or QA is incomplete. Later commits go to
the same branch and PR. PR previews require `needs-preview`. Record the decision
and evidence in the PR:

- Request a preview for UI/interactions; auth, routing, cookies, uploads, payments, streaming or persistence; isolated backend QA; environment/build changes; uncertainty CI cannot resolve; or explicit browser QA.
- Ordinarily use CI alone for well-tested Dependabot patch/minor upgrades, documentation, tests/fixtures, CI metadata, formatting/comments and type-only changes. Dependency risk can still justify a preview.

The trusted controller runs protected main code, validates the internal PR, provisions its branch app URL, then requests an exact-SHA Vercel Preview using the existing token. The build deploys/seeds only `preview/pr-<number>`. The controller assigns `pr-<number>.preview.getoverlay.io` only after READY and backend verification. While labeled, new commits request the new head. Reconciliation reuses healthy current builds and renews the backend; a missing/expired backend requires a fresh build.

Removing the label or closing the PR settles running builds, removes its alias/domain/app-URL override and deletes the owned Convex preview backend and its synthetic data. Cleanup verifies absence before reporting success; a failure remains visible for retry. Unlabeled PRs receive successful “Preview not requested” status and still require normal CI. Manual workflow dispatch reconciles this policy; it does not bypass the label. Forks receive no Preview credentials.

Wait for the deployment result and verify that its SHA matches the current PR head before browser QA.

Use the shared hosting settings above. Do not copy `.env.local` wholesale or deploy shared development or production backends from the feature worktree.

The build wrapper resolves missing PR-number metadata by public branch/SHA lookup without sending credentials. Inspect controller/build logs for failures. Never test an older deployment as evidence for the new head.

### Preview preflight and recovery

Run `node scripts/release/preview-doctor.mjs <PR>` before browser QA. It checks
the canonical alias against the current PR SHA and reports missing capability
settings without credential values. `--require-full` additionally rejects missing
capability configuration. Each metadata subprocess has a thirty-second deadline. This is configuration evidence, not live provider or
browser acceptance. The complete REST inventory avoids connector summaries that
truncate environment lists to 100 entries; never create another key because a
summary omitted an existing one.

Native Git Preview deployments may be `BLOCKED` by the intended REST-only policy.
Inspect the controller-created deployment for the same SHA before diagnosing an
account hold. A blocked controller deployment is a failure requiring source-policy,
REST permission and team-access checks; inspect build/runtime logs for other
failures. Reconcile the requested Preview after correcting the cause. Older
deployments remain diagnostic evidence only. Keep the PR draft until current-head
acceptance succeeds. The unrelated admin deployment status is not a required
customer-web check; relevant admin changes still require their own acceptance.

Preview registers the production schedule from its first deployment. Background
work requires isolated providers, exact PR callback URLs and hosting access on
the backend; outbound guards fail closed until those settings are present. Verify
automations, ingestion, projections, supervision and reconciliation through their
normal schedules. Workflow projection must read SDK events through the authenticated web callback; a running cron or manually seeded subscription row does not prove projection. Include a run that finishes between ticks and verify its projected events without manual inserts. Email/webhooks additionally require the test destination lists
in Convex Workflow. Browser access does not prove server callback access.

For exhausted fixtures, prefer the trusted `Preview QA Recovery` workflow on
`main`. For example, `gh workflow run preview-qa-recovery.yml --ref main -f
pr_number=<PR> -f fixture=paid-workspace -f available_cents=1000` requests synthetic
available credit; choose `personal` or `exhausted-workspace` and omit
`available_cents` for a free-quota reset. `computer-workspace` is also supported.
Wait for the current-head READY Preview first. The workflow reuses existing
`release-control` credentials, verifies the internal labeled PR, exact web head
and owned Preview backend, and invokes only `dev/qa:recover`. Builders need GitHub
workflow-dispatch access, not a Convex deploy key in their VM. It never deploys
code or changes the real provider cap. Rerunning the same Actions run is
replay-safe; an optional non-secret `request_id` can identify a specific recovery.

An authenticated operator can still invoke internal `dev/qa:recover` directly on
the verified Preview reference with a unique `requestId`, one of the four
fixtures and `availableCents` for paid fixtures. Use a Preview-scoped key-only
file or authenticated CLI, never `.env.local`. Recovery is explicit and audited;
deployment seeding never resets usage or credit. Synthetic credits do not pay
real provider costs.

For a quarantined free-model route, inspect its failure first. Preview-only
internal `dev/qa:recoverRoute` accepts the exact `routeKey`, `expectedReason` and
a new `requestId`. It rejects changed reasons, unsettled leases and nonzero
pricing, records the recovery, and expires catalog/canary eligibility. Run the
normal catalog refresh and require fresh verification before retrying inference;
clearing quarantine is not evidence that the provider is safe or working.

Interactive browser acceptance uses `computer_browser` on a Boat Computer (E2B
where explicitly selected for self-hosting). Verify page navigation, snapshots,
approvals and visible desktop state on the same machine. Do not configure a
separate browser service or browser credits.

Exercise Free, paid, exhausted-credit and multi-identity scenarios separately.
A synthetic collaborator principal is not a second authenticated QA identity.
Provision verified member/outsider sandbox users and configure their
`PREVIEW_MEMBER_LOGIN_*` / `PREVIEW_OUTSIDER_LOGIN_*` settings. The Preview login
identity header selects only those configured accounts; the seed gives each a
personal workspace and adds only the member to Preview QA Team.
Seeded entitlements do not establish Stripe checkout or webhook acceptance.
Billing-enabled Preview builds provision and verify an owned Stripe test endpoint
on their backend. Rebuilds retain its signing secret; the trusted controller
cleans the endpoint before its backend. Confirm actual payment/event processing,
replay handling and cancellation in addition to endpoint configuration.
Record capability configuration, provider calls, persistence, scheduled work,
permission failures and cleanup separately; missing infrastructure stays BLOCKED.

### 4. Test the preview in the browser

Cloud Builders without a Vercel session should use the authenticated Vercel MCP
`get_access_to_vercel_url` tool for the exact canonical PR URL and open its result
in their QA browser. This works across agent platforms that support Vercel MCP;
connect it once per platform under the authorized Divyansh account. Keep temporary
share links private and return to the clean PR URL before capturing evidence.
Runners without MCP can use `VERCEL_AUTOMATION_BYPASS_SECRET` from their private
runtime secret store. Follow the [cloud browser protection recipe](browser-testing-with-agent-browser.md).
Keep protection enabled. GitHub/Vercel secrets do not automatically populate a
cloud Builder VM. Overlay sandbox login is separate.

When Devin is the coding agent, use the existing Pro demo credentials from the
Devin secret store to perform authenticated QA on the canonical PR preview URL.
Reuse credentials already available to the session instead of asking the owner
to provide them again. Never copy credential values into source, documentation,
logs, screenshots or PR comments. Use these credentials for QA only on
`https://pr-<number>.preview.getoverlay.io`, not on production.

Verify the signed-in identity and effective plan in the isolated preview before
testing paid features. A Pro account in another environment does not automatically
give the preview Pro entitlements: its backend has independent billing and
workspace fixtures. If the preview reports Free or lacks a multi-member workspace,
report that specific fixture gap rather than requesting the same credentials
again or claiming paid/scope-isolation acceptance. Provision approved synthetic
fixtures only on the PR's isolated backend; never change production billing or
invite real people to make a test pass.

For approved paid/workspace QA, the opt-in internal `dev/seed:initQa` mutation
creates a synthetic **Preview QA Team**, two human principals (one is the configured
QA identity), separate Personal/Workspace agents, and a paid fixture with a one-time
$1 allowance. It does not charge Stripe, enable automatic top-ups, or send invitations.
It refuses non-Preview deployments and ordinary preview seeding does not invoke it.
For hosted seeding without exporting credentials, set
`OVERLAY_PREVIEW_QA_FIXTURES=paid-workspace` on **only the approved PR branch's**
Vercel Preview environment. Its next successful build invokes the fixture on that
PR backend with the existing Preview deploy key. Do not set this flag globally.
Alternatively, after confirming the current PR deployment and its isolated backend, run it with
the project-scoped Preview deploy key in a private key-only environment file:

```sh
npx convex run dev/seed:initQa '{}' --deployment preview/pr-<number> --env-file <preview-key-only-file>
```

Never use `.env.local`, a Production key, or a shared development backend for this
command. Reruns preserve existing fixtures and do not replenish spent allowance.
Select **Preview QA Team** in the app before verifying Pro entitlement and scope
isolation; the original Personal workspace and its billing remain unchanged.

Computer lifecycle QA uses `OVERLAY_PREVIEW_QA_FIXTURES=computer-workspace` on its exact Preview branch to invoke `dev/seed:initComputerQa`. Ordinary seeding remains free; the existing `paid-workspace` fixture is separate. Combine fixtures with `OVERLAY_PREVIEW_QA_FIXTURES=paid-workspace,computer-workspace`; duplicate names run once and unknown names fail before deployment. Both are Preview-only, preserve spent balances on rebuild, and use the existing scoped credential.

Other Builders can use the configured sandbox QA identity or the
[preview login recipe](browser-testing-with-agent-browser.md). Exercise the
feature as a user would:

- Complete its main interaction from start to finish.
- Test the changed journey in the deployed app, including sign-in and navigation
  where relevant. An HTTP fetch or a READY deployment alone is not browser QA.
- Check that the rendered UI matches the existing app design.
- Reload and verify persistence when the feature stores data.
- Exercise relevant errors, permissions, and tenant boundaries.
- Check browser console or network failures when behavior is unexpected.

Use synthetic data and test providers. Capture screenshots or a short recording where they help demonstrate the result. Capture sanitized failure evidence before cleanup. Keep failed fixtures only for a bounded investigation within the open PR lifecycle; closure/label removal still deletes its owned backend and resources. Clean up created provider resources and successful test data.

Fix findings, commit, and push. Wait for the updated deployment and repeat the affected QA on the new revision. Keep the final evidence tied to the current PR head.

### 5. Submit the ready PR and stop

After testing, post a **QA handoff** comment on the PR so Integration can read the
result without opening the Builder thread. Also keep the PR description and thread
summary current. Match the full tested SHA to the current PR head immediately
before posting. Use the clean preview URL, never the private MCP access link.

```markdown
## QA handoff

Result: PASS / BLOCKED
Tested PR head: <full SHA>
Preview: https://pr-<number>.preview.getoverlay.io
Deployment/backend: <deployment ID and isolated Convex backend>
Access: Vercel MCP / existing browser session / automation bypass
Checks: <commands and actual results; required CI status>
End-to-end flows: <actions, expected outcomes and observed results>
Persistence/error/permission cases: <results where relevant>
Evidence: <sanitized screenshots or recording links, if useful>
Dependencies/backend steps: <required steps, or none>
Limitations/blockers: <anything unverified, or none>
```

For changes that do not need a preview, use the same comment with
`Preview: Not requested — <rationale>` and omit deployment/browser-only fields.
If browser access, CI or acceptance checks fail, report `BLOCKED` with the concrete
failure and keep the PR draft. Separate QA results from pending CI; do not claim
readiness while required checks are pending. New commits supersede older QA
comments: push the fix, rerun affected QA and post a new comment with the new SHA.
Post comments using a structured API or `gh pr comment <number> --body-file
<qa-file>`; keep secrets and browser state out of both the comment and attachments.

Mark the draft PR ready when the feature meets its acceptance criteria,
current-revision QA passes, the QA comment is posted, and required checks pass.
Include this concise handoff in your thread response:

```text
Outcome: [what now works]
PR: [URL]
Head and tested preview SHA: [SHA]
Preview: [URL and SHA, or reason preview was not requested]
Checks: [commands and actual results; required CI status]
Browser QA: [flows exercised and evidence links]
Dependencies: [PRs, or none]
Risk and rollback: [how to undo the change safely]
Backend/migration steps: [required steps, or none]
Limitations: [anything incomplete or unverified, or none]
```

For sensitive changes, expand acceptance checks on the same isolated PR preview. Respond to Integration findings with new commits and refreshed QA. Keep the worktree until Integration confirms merge. The Builder stops at PR readiness and leaves queue entry, merging, and releases to Integration.

## Integration instructions

### 1. Choose the next ready PR

Use GitHub PRs and checks as the queue and detailed record. Process dependencies first, then follow the owner's priority order; use ready time when no priority is specified. Continue with independent ready PRs when another PR is blocked.

Read the full diff and relevant implementation. Verify the base is main, the scope matches the assignment, dependencies are satisfied, and docs/CHANGELOG are updated. Read the latest QA handoff comment: confirm its tested SHA matches the current head and its preview evidence covers the acceptance criteria. Older QA is superseded after a push. Perform additional QA where the evidence or risk calls for it, using Vercel MCP for protected browser access when needed.

Post a concise Integration review comment with the reviewed SHA, accepted QA or
specific blockers, and queue decision. After release, add the accepted main SHA,
Vercel deployment ID and actual production smoke result to the same PR. Keep
ready, queued, merged, deployed and verified states distinct.

Review while CI runs. If a check fails, inspect the failed job and concrete logs. Return actionable findings through the PR; send a follow-up to the Builder thread when the owner has authorized messaging it. Resolve findings before merging.

### 2. Enqueue and verify the merge

Once required checks and proportionate QA pass and conversations are resolved, enqueue the PR under `DevelopedByDev`, the sole authorized merge identity. No second human approving review is required in the current sole-maintainer setup.

The native merge queue runs required checks on the combined revision containing current main and earlier queued changes. If that combined revision fails, investigate the interaction and fix it before retrying.

Preserve meaningful commits with merge merging; squash only trivial or noisy history. Cloud Builder changes go through PRs and the queue; local DevelopedByDev integration may use the authorized direct-push path. Never force-push or reset release branches. Other bypass use requires explicit authorization.

Verify the PR is merged, its accepted changes reached `origin/main`, and record the accepted main SHA. Verify the native Vercel deployment serves the accepted main SHA, synchronize Convex if this release changes the backend, and check production smoke. Preserve needed work and evidence before archiving a completed feature worktree.

### 3. Report and continue

Report each accepted PR and main SHA, or the concrete blocker and next action. Describe the state accurately: ready, queued, merged, deployed, or verified. Continue processing the available authorized PRs in this Integration thread.

Main changes automatically deploy to production through Vercel’s Git integration; Integration then runs proportionate smoke checks.

## Automatic production release

### Required CI checks

Dependency-owning jobs use Namespace Linux AMD64 profiles: `overlay-ci-small`
(2 vCPU, 4 GB) for docs/static checks, `overlay-ci-medium` (4 vCPU, 8 GB) for
standalone typechecking, `overlay-ci-benchmark` (8 vCPU, 16 GB) for compilation,
and `overlay-ci-tests` (8 vCPU, 16 GB) for Node 24 test shards. Other checks,
controllers and publication use equivalent explicit Namespace shapes without
writable cache volumes. Runner controls bind jobs to
`github.run_id` to avoid cross-run assignment, prioritize compilation, and give
background publishing/canaries lower priority than required checks. PR revisions
cancel obsolete checks; main/merge-group runs use unique concurrency groups so
GitHub cannot replace an older pending run. Keep Vercel hosting settings separate.

`Security Checks` runs lint/boundaries, typechecking, production compilation and
two complete test shards in parallel. Both ordinary-test shards use Node 24, matching the Agent Host
CLI's minimum runtime so built-CLI contracts run without skipping or weakening the
version guard. `next typegen` generates current route validators before the
required standalone typecheck; only the CI compilation job skips the duplicate
Next TypeScript pass. Ordinary Vercel builds retain their existing type checks. Customer-web production
compilation uses `next build --webpack` with `webpackBuildWorker` and
`webpackMemoryOptimizations` enabled; the `.js` extension alias resolves NodeNext
workspace imports to their TypeScript source; local development keeps the default dev engine.
Keep reusable components outside route entry-point exports so generated route validators pass.
Configuration and Convex boundary checks that depend on generated Workflow routes
stay after compilation. Gateway tests retain their react-server condition in a
dedicated discovered group; route and gateway suites run once through the shards.

CI reuses exact installed trees through Namespace local cache volumes rather
than downloading dependency archives. The key covers full Node/npm version,
OS/architecture, lockfile, workspace manifests and installation policy/helper.
Incomplete snapshots are rejected; misses run
`npm ci --ignore-scripts --no-audit --no-fund`. Copies preserve relative workspace
links, cache completion is atomic, and retention is bounded to two exact trees. Docs uses the same root installation;
admin keeps its isolated workspace installation. **Each Namespace profile must
have Protected branches enabled for `main` in the account settings before this
cache is used.** PR-editable runner labels alone are insufficient protection.
Keep the default per-profile/repository cache identities, without explicit
shared tags. Node 24 tests have a separate profile; background jobs have no
writable dependency volume. Namespace uses last-write-wins snapshots, so those
jobs must not discard newly seeded installs from another role or runtime. Never cache secrets or reuse installed trees in privileged
release/publication jobs. The dependency audit remains required.

Persist only `.next/cache` and the content-based ESLint cache for compiler/lint
reuse. The native checker gets fresh project inputs on each run. Cache keys cover the relevant tool
configuration and dependencies, with per-revision snapshots. Always compile the
current source, regenerate route types, and execute the required checks. A cache
hit is not a successful check. Lint and typechecking run independently and both
must pass the fail-closed aggregate. Keep hosted build validation unchanged.

The standalone compiler uses pinned Bun's native checker, while the installed
TypeScript API remains available to Next/Convex. `typecheck-native.mjs` derives
the legacy compiler's automatic ambient types and type roots into a temporary
project config, preserving the source project and generated route validators.
CI fails if the pinned checker is unavailable; local machines without it retain
`tsc`. The boundary-check chain remains required. Re-run the opt-in
`typecheck-benchmark.mjs` parity/negative probes before changing the checker.
Hosted Next builds keep their own TypeScript validation.

Full cached ESLint remains required. The opt-in `lint-oxlint-parity.mjs` checks
migration against intentionally invalid fixtures and real files; a stock Oxlint
migration currently drops custom syntax/import controls and changes scoped rule
behavior. Do not replace ESLint until those rules pass equivalent checks.

Affected selection is advisory only: `affected-shadow.mjs <full-base-SHA>` reports
transitive test candidates; configuration, unknown imports/deleted inputs and
missing coverage fall back to the full inventory. It never changes shard
execution. Before activating pruning, compare shadow results with exhaustive CI
and intentionally failing real-repository changes, including workspace/package,
route, dependency and configuration changes. Package atomic groups and live-only
classification must remain intact. Pool/isolation/startup experiments are opt-in;
retain process/file isolation unless Linux runner measurements and leakage
negative controls prove a safe improvement.

The runner inventories every tracked `*.test.{ts,tsx,mts,mjs}` file and classifies
the live-only suites in `scripts/ci/integration-tests.mjs` separately.
`npm run test:all` runs all ordinary suites, including mixed unit/live files.
`npm run test:integration -- --list` lists opt-in live suites;
`npm run test:integration -- --only <group>` runs explicitly configured ones.
Select service credentials explicitly; never point CI at production.
Package groups build once and execute only their selected files. Weighted
assignment accounts for expensive atomic package builds before distributing
ordinary files; unknown suites still participate. Group timings include package
builds. Keep two exhaustive shards and verify every file runs exactly once. Each shard
verifies complete, disjoint coverage; package test commands that build their own
outputs stay atomic on one worker. Invalid/empty selections fail. The existing
`Schema and Routing Contracts` context now reports the test jobs' result from this
workflow; do not recreate a separate installation-heavy gateway workflow.

`Required Quality and Security Gates` runs even after a prerequisite fails and
requires every lint/type, build, test, secret-scan, public-env and applicable
dependency-review lane to succeed. Docs, CodeQL, Semgrep and CLA remain separate
required contexts. Docs health runs in the complete Docs check on every main push.
Update CodeQL init, analyze and SARIF upload pins together; mixed action versions
fail when reading the generated CodeQL configuration. Workflow contract tests
enforce a shared commit pin.
Dependabot groups these action updates into one PR.
PR and merge-group triggers remain mandatory; no application or dependency change
is exempted by path filters. Do not treat cancellation, missing output or an
unexpectedly skipped lane as success. Keep protections synchronized with check
names. The post-merge main run also protects authorized direct owner pushes.

1. Vercel’s native Git integration deploys pushes to `main` in `LayerNorm/overlay-web` to the `overlay-landing` production project. The owner enabled Git as a production deployment source on 2026-10-14.
2. Keep `git.deploymentEnabled.main=true` in root `vercel.json`, production branch `main`, and automatic production domain assignment enabled. No custom GitHub Actions deployer or Vercel deployment token is required.
3. Integration verifies the exact live SHA. If Convex source, imported shared code or runtime dependencies changed, synchronize the production backend from clean current canonical main after matching web is live; frontend-only releases need no backend push.
   Harness personal admission checks backend readiness before creating a run,
   retaining the previous runner only while the server-owned capability marker is absent.
   This preserves the web-first release order; authentication and transport
   failures do not trigger fallback. See Convex Workflow.
4. Integration runs proportionate authenticated production smoke and records the deployed SHA and result. Vercel Git deployment does not itself synchronize Convex or run these application checks. Report live and verified only after the relevant checks pass.

The former custom Production Release workflow, promotion script and production deployment token have been retired. Do not recreate them for ordinary releases. Use Vercel’s deployment history for authorized redeploy/rollback, and follow [Production deployment details](worktree-staging-qa.mdx) for backend safety and recovery.

## Coordination rules

- Give each Builder a clear outcome and feature boundary. Assign one owner for shared files or contracts that multiple features need.
- Keep implementation, QA evidence, and review attached to the PR. No separate Markdown PR ledger is needed.
- Ask for the exact failure when an agent is blocked: error, affected step, attempts made, and the action needed to proceed.
- Reuse configured preview environments and test credentials. Keep secrets and session cookies out of commits, PR text, and screenshots.
- Keep checks proportional and act when the evidence is sufficient. Required CI and current-preview QA determine readiness.

For detailed repository mechanics, read [Agentic Development](agentic-development.mdx), [Release Workflow](release-workflow.mdx), and [Convex Workflow](convex-workflow.mdx).

### Exhausted-quota acceptance

Include `exhausted-workspace` in the comma-separated fixture list to create a
separate Free **Exhausted QA** workspace with consumed weekly turn/transcription
counters. It makes no provider calls and grants no paid plan. Ordinary rebuilds
preserve its state. Use explicit `dev/qa:recover` with that fixture and a new
request ID to reset only its own counters, then verify normal admission again.
The Personal fixture remains available for ordinary Free acceptance.
