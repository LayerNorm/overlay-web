# Development Workflow

Use multiple Builder threads to develop independent features and one Integration thread to review and merge ready PRs. Each Builder has its own computer or VM, browser, repository access, and configured test environments.

**The workflow:** assign a feature → implement → local smoke QA → draft PR → Vercel preview interaction QA → ready PR → Integration review → main merge queue.

Production follows **merge to main → automatic Vercel Git production deployment → production smoke checks**. Integration synchronizes Convex when backend changes require it, after matching production web is live. PR previews provide the acceptance environment for sensitive changes too. This document is the authoritative workflow.

## Shared hosting and parallel work

| Setting | Development rule |
| --- | --- |
| Vercel project | Use `overlay-landing` for both Preview and Production. The separate staging project, branch and subdomain are retired. |
| Build source | Keep Git allowed for both environments. Vercel starts builds automatically when branches/main change. |
| Build machine | Keep **Basic**. Let slow builds finish; inspect concrete failures before changing configuration. |
| Build concurrency | Keep on-demand concurrency enabled with **Run up to one build per branch** (`WAIT_FOR_NAMESPACE_QUEUE`). Different PRs build in parallel; revisions sharing one branch/backend build sequentially. |
| Preview URL and backend | Use `https://pr-<number>.preview.getoverlay.io` and that PR's isolated Convex backend. A READY build must match the current PR head before browser QA. |
| Test settings | Shared Preview credentials inherit once per environment and have no scheduled expiry. Keep Preview and Production variable scopes separate. |

The trusted `PR Preview` workflow uses the existing `VERCEL_PREVIEW_TOKEN` in
GitHub's `release-control` environment for ordinary custom URL assignment and
cleanup, plus the existing scoped Convex Preview credential for backend renewal.
The Git deployment-source rule permits builds; these credentials support URL and
backend management. Reuse them across PRs. Builders do not create tokens or copy
shared settings for each feature. No Production deployment token or purchased
Preview Deployment Suffix is needed.

Open PR backends renew within Convex's retention limits. Closing a PR removes its
owned URL and branch app setting, stops backend renewal, and leaves the hostname
returning HTTPS 404. Credential lifetime and backend retention are separate.

Assign independent features to separate Builders so implementation, builds and
browser QA can proceed in parallel. Each Builder owns one branch and PR. Share
foundations through declared PR dependencies and land them before dependent work.
Integration reviews ready PRs in dependency order and uses GitHub's main merge
queue to check combined revisions. Vercel's build concurrency does not replace
that integration check.

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
Fix any issues and mark the PR ready when the current revision passes QA.
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

Run the smallest checks that cover the change. Use `npm run dev` for local web work with your engineer-owned dev backend. Run a smoke check of the affected route or behavior before pushing. Record the actual commands and results. Required repository CI remains mandatory.

Match QA to risk: visual changes need rendered UI checks; auth, billing, tenant boundaries, migrations, and backend changes need their relevant stronger checks. Read the installed Next.js guides before writing Next.js code.

### 3. Open a draft PR to get the preview

Commit and push the feature branch, then promptly open a draft PR against `main`. Vercel’s native Git integration builds the Preview environment. The trusted `PR Preview` workflow assigns the custom URL and renews the isolated backend. Wait for its deployment result and verify that its deployed SHA matches the current PR head.

Use the shared hosting settings above. Do not copy `.env.local` wholesale or deploy shared development or production backends from the feature worktree.

Vercel can start a first build before the draft PR exists. The build wrapper
briefly looks up the public repository's open internal main PR, verifying its
exact branch and SHA when Vercel's PR-number metadata is missing. It sends no
credentials to this lookup. A missing PR number is a metadata/timing problem;
keep concurrent builds enabled and inspect the failed build and `PR Preview`
workflow logs. If the lookup times out, ensure the PR is open against main and
push a new revision. Never test an older deployment as evidence for the new head.

Documentation/GitHub-only changes may receive the controller's hosted-app exemption. Review the docs and required checks; use `needs-preview` if an app preview is needed.

### 4. Test the preview in the browser

Sign in using the configured sandbox QA identity or the [preview login recipe](browser-testing-with-agent-browser.md). Exercise the feature as a user would:

- Complete its main interaction from start to finish.
- Check that the rendered UI matches the existing app design.
- Reload and verify persistence when the feature stores data.
- Exercise relevant errors, permissions, and tenant boundaries.
- Check browser console or network failures when behavior is unexpected.

Use synthetic data and test providers. Capture screenshots or a short recording where they help demonstrate the result. Clean up the test data you create.

Fix findings, commit, and push. Wait for the updated deployment and repeat the affected QA on the new revision. Keep the final evidence tied to the current PR head.

### 5. Submit the ready PR and stop

Mark the draft PR ready when the feature meets its acceptance criteria, current-revision QA passes, and required checks pass. Include this handoff in the PR description and your thread response:

```text
Outcome: [what now works]
PR: [URL]
Head and tested preview SHA: [SHA]
Preview: [URL, or hosted-app exemption]
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

Read the full diff and relevant implementation. Verify the base is main, the scope matches the assignment, dependencies are satisfied, and docs/CHANGELOG are updated. Confirm the preview evidence matches the current head and covers the acceptance criteria. Perform additional QA where the evidence or risk calls for it.

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

1. Vercel’s native Git integration deploys pushes to `main` in `LayerNorm/overlay-web` to the `overlay-landing` production project. The owner enabled Git as a production deployment source on 2026-10-14.
2. Keep `git.deploymentEnabled.main=true` in root `vercel.json`, production branch `main`, and automatic production domain assignment enabled. No custom GitHub Actions deployer or Vercel deployment token is required.
3. Integration verifies the exact live SHA. If Convex source, imported shared code or runtime dependencies changed, synchronize the production backend from clean current canonical main after matching web is live; frontend-only releases need no backend push.
4. Integration runs proportionate authenticated production smoke and records the deployed SHA and result. Vercel Git deployment does not itself synchronize Convex or run these application checks. Report live and verified only after the relevant checks pass.

The former custom Production Release workflow, promotion script and production deployment token have been retired. Do not recreate them for ordinary releases. Use Vercel’s deployment history for authorized redeploy/rollback, and follow [Production deployment details](worktree-staging-qa.mdx) for backend safety and recovery.

## Coordination rules

- Give each Builder a clear outcome and feature boundary. Assign one owner for shared files or contracts that multiple features need.
- Keep implementation, QA evidence, and review attached to the PR. No separate Markdown PR ledger is needed.
- Ask for the exact failure when an agent is blocked: error, affected step, attempts made, and the action needed to proceed.
- Reuse configured preview environments and test credentials. Keep secrets and session cookies out of commits, PR text, and screenshots.
- Keep checks proportional and act when the evidence is sufficient. Required CI and current-preview QA determine readiness.

For detailed repository mechanics, read [Agentic Development](agentic-development.mdx), [Release Workflow](release-workflow.mdx), and [Convex Workflow](convex-workflow.mdx).
