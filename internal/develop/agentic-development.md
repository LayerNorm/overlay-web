---
title: "Agentic Development"
description: "Feature PRs, isolated previews, the main merge queue, and automatic production releases."
---

## Activation checkpoint

Migration acceptance passed on 2026-10-13. Candidate workflow `38413217001` verified exact main `bee84a33a2d4b101bf85d3b179cd30984b556045` before and after staging publication. Production `dpl_8PQvmTsqT9PSHXSswyZDi2H6KfMg` was verified web-first, then customer Convex and full authenticated smoke passed. Deliberate web rollback, compatibility checks, restoration and full final smoke passed; the accepted release is live. Automatic test Stripe checkout/cancellation and actual browser storage acceptance passed. See the migration plan and `internal/plans/release-workflow-evidence/` for exact proof. Subsequent releases require fresh evidence.

## Release model

[Development Workflow](./Development%20Workflow.md) is the authoritative Builder,
Integration and release policy. Cloud Builder features reach main through focused PRs
and the merge queue. Local laptop agents under DevelopedByDev have standing
authorization for validated fast-forward direct main pushes, as documented in
Development Workflow. Every main push automatically deploys the exact revision to
Vercel production through its native Git integration. Integration synchronizes
Convex only for backend changes after matching web is live, then runs production smoke. Sensitive changes use expanded QA on their isolated PR previews.
Keep root `git.deploymentEnabled.main=true`. The owner enabled Git as a production
deployment source; no custom production workflow or deployment token is needed.

The retired staging branch and project are not development or release lanes. See
[Preview and Production QA](./worktree-staging-qa.md).

## Two roles

Tag [Development Workflow](./Development%20Workflow.md)
for the complete Builder and Integration instructions and copyable role prompts.

| Role | Responsibility |
| --- | --- |
| Builder | Own one feature worktree, implement and validate a coherent change, update living docs and CHANGELOG, verify the current PR preview, and submit the PR to main. Stop at a ready PR. |
| Integration | Review the diff and evidence, resolve conversations, enqueue the reviewed PR once required checks pass, then verify the native Git deployment SHA and authenticated production smoke. |

Use [Builder Agent Prompt](./BUILDER_AGENT_PROMPT.md) and
[Integration Agent Prompt](./INTEGRATION_AGENT_PROMPT.md). No additional
review or release role is required. GitHub PRs, checks and history are the
integration record; do not create a second Markdown PR ledger.

## Feature ownership

Read `AGENTS.md` and relevant living docs first. Fetch before creating a worktree:

```bash
git fetch origin
git worktree add ../overlay-landing-<slug> -b codex/<slug> origin/main
```

One active task owns one descriptive branch and worktree. Preserve unrelated
canonical edits. Keep canonical `main` clean for production. Do not share feature
branches or use the canonical checkout as implementation scratch space.

Use `npm run dev` for local web work with an engineer's own dev backend.
Do not deploy shared dev or production Convex from a feature worktree.
Hosted PR builds provision a separate backend and seed synthetic data. Shared
Preview settings are inherited; agents do not copy production credentials or
customer data and do not need domain-management secrets.

## PR evidence

Open a draft PR against `main`. Add `needs-preview` when hosted browser or isolated
end-to-end QA is needed under Development Workflow: UI/interactions, sensitive
auth/billing/data flows, environment/build changes or uncertainty CI cannot resolve.
Ordinary well-tested patch/minor dependency upgrades, docs, tests, CI metadata,
formatting/comments and type-only changes can use CI alone. Record the rationale.
For requested previews, wait for `PR Preview`. Verify its SHA equals
the current PR head before using `https://pr-<number>.preview.getoverlay.io`.
Sign in with the sandbox QA identity or the preview-only login recipe in
[Browser Testing](./browser-testing-with-agent-browser.md). Keep secrets and
cookies outside tracked files and PR text.

Verify the changed flow, rendered UI and persistence as applicable. Record the
preview URL, exact deployed SHA, screenshots, checks and limitations in the PR.
A new app revision invalidates earlier evidence. Unlabeled PRs receive successful
“Preview not requested” status; required CI still runs. Label removal cleans the
preview. Manual dispatch reconciles the label policy rather than overriding it.

The PR must state outcome, important decisions, touched systems, dependencies,
rollback, exact validation, backend/migration steps and current head SHA.
Update applicable living documentation and root `CHANGELOG.md` under Unreleased
in the same commit series. Do not include unrelated cleanup.

## Proportionate checks

| Change | Evidence |
| --- | --- |
| Docs | Docs/link checks and diff review. |
| UI | Targeted lint/checks and visual QA of the affected flow. |
| Shared contract | Relevant contract checks and typecheck. |
| Auth, billing, tenant, secrets or data migration | Relevant security/contract checks, rollback and isolated hosted QA. |
| Convex or runtime | Matching web/backend revision, relevant contracts, isolated Preview QA and production smoke. |

Required GitHub checks stay mandatory. The current quality gate includes install,
lint, typecheck, build, the tracked full suite, and config/boundary checks. A green
build does not prove authenticated product behavior. Expand Preview QA for
sensitive flows; every feature PR still targets main.

### Dark release flags

`createReleaseFlags` in `src/server/releases/feature-flags.ts` evaluates an
explicit set of boolean PostHog keys once per incoming request. Construct it
after authentication and workspace resolution; pass those server-derived IDs,
not request-provided identities. Missing flags, variants, disabled analytics,
provider errors and a 300ms deadline default off. Flags do not replace access
control. Keep the previous behavior when a flag is off:

```ts
const flags = createReleaseFlags({ userId: subject.userId, workspaceId }, ['new-editor'])
return await flags.isEnabled('new-editor') ? renderNewEditor() : renderCurrentEditor()
```

The helper does not enable a product feature by itself. Create the corresponding
boolean flag in the correct PostHog project and verify both branches before
rolling it out. Keep the fallback until the previous production revision no
longer needs it.

### PR turnaround evidence

PR publication starts required code/security checks and the separate hosted
preview controller. CI success establishes automated coverage; review still
checks the diff, relevant behavior and rollback. Make the merge decision when
the current revision has proportionate QA and required checks; do not wait for
a second human approval in the sole-owner setup. Close a PR when it is rejected,
superseded or abandoned, not merely because a service build is queued.

PR #190's measured baseline: main quality gate 9m7s, full test suite 2m39s across
423 tracked test files, hosted preview queue 20m56s and hosted build 4m. These
ran concurrently. Queue capacity dominated that preview; deleting unit tests
would not solve the wait. Inspect job/step timing before changing coverage.

Required workflows cancel obsolete PR check runs when a new revision arrives;
main push and merge-group checks remain independent. Deployment controllers
retain their locks until remote builds are settled. All non-main automatic Git
deployments are disabled; only `needs-preview` requests a hosted app build.
Main retains automatic production deployment. Required CI and docs previews
still run. Manual PR Preview dispatch reconciles the label policy. Cleanup and
ownership checks also apply to PRs without a preview.

Dependency Review always runs the actual base/head comparison; missing
repository metadata must not turn a required security check into a no-op.
Paid gateway canaries live in a separate workflow so unrelated deployment events
cannot publish skipped results under the required contract-check name.

The `test:all` tsx group preloads server-only/style shims and React before
importing test modules. Package TSX sources that preserve JSX may evaluate
static elements during import; setting React inside a test body is too late.
This setup lets the rendered component checks execute without changing the
production JSX transform.


## Review and merge queue

Integration reads the complete diff and relevant implementation, verifies checks
and current-head evidence, resolves substantive findings, then enqueues the PR.
There is no required approving review while the sole maintainer cannot approve
his own PR. Do not wait for a second human reviewer. Sole merge authority remains
`DevelopedByDev` or an Integration agent acting under that identity.

The queue tests each candidate combined with current main and earlier queued PRs
through `merge_group` workflows. Do not publish a green status based only on the
original PR head. Prefer merge commits for meaningful history; squash only trivial
or disposable fixups. Never rebase-merge, force-push, reset or delete main.

The owner authorized local laptop agents under DevelopedByDev to use the existing
owner bypass for direct main integration after proportionate checks, diff/ancestry
review and preservation of unrelated edits. Push fast-forward only and verify the
published SHA and native Vercel deployment. Cloud Builders continue to use PRs
and the queue. Other bypass use requires explicit authorization.

## Production

Follow [Development Workflow](./Development%20Workflow.md). Main changes deploy
automatically through Vercel’s Git integration. Integration runs authenticated
production smoke and synchronizes Convex only for backend changes. Verify
the exact SHA, live alias, smoke result and saved rollback checkpoint.

Releases need no staging, custom production deployer or Production Vercel deployment
token. Use Vercel deployment history for authorized redeploy/rollback. Backend
changes use clean current canonical main after matching web is live. Never pass
`.env.local` to production or deploy shared backends from a feature worktree.

## Cleanup

After merge, verify the PR is merged and its meaningful head is an ancestor of
origin/main. Archive an attached managed worktree with the app tool, or remove an
unmanaged completed feature worktree and delete only its local merged branch.
Preserve uncommitted work. Canonical main remains the production checkout.


### Interrupted preview build recovery

The installed Convex CLI executes `--preview-run` only for newly claimed preview
backends. An interrupted first build can leave a reused backend without fixtures.
After every successful preview deploy, the hosted build therefore explicitly runs
`dev/seed:init` against `preview/pr-<number>` using the preview-scoped key. This
idempotent repair preserves edited fixture data and reuses any existing personal
workspace; it does not recreate the backend or deploy shared development/production.
A failed deploy never runs the repair, and a failed repair fails the hosted build.

### Chat smoke readiness

Candidate and production smoke create a fresh Auto conversation, await its initial
transcript response, matching `data-overlay-chat-id` with
`data-overlay-chat-hydrated="true"`, and requested heading, then explicitly select Chat before
sending. A visible composer alone does not prove route hydration is complete.
Live diagnostics reproduced an early send using default model/runtime state;
waiting for the transcript fixed immediate reply rendering and reload persistence.
Both suites clean their own synthetic conversations after success or failure.

### Recover Preview fixtures

Use `Preview QA Recovery` from trusted main for a named fixture on an open
`needs-preview` PR after its current web/backend are ready. Existing credentials
stay in `release-control`; a Builder VM needs workflow-dispatch access rather
than a copied Convex key. See Development Workflow for the command, bounds and
replay-safe request IDs. Fixture credit never increases the real provider cap.
