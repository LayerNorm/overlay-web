# Target release workflow: previews, trunk, staging, production

> **Status: target state, not the current process.** Until the migration in
> [`RELEASE_WORKFLOW_MIGRATION_PLAN.md`](https://github.com/LayerNorm/overlay-web/blob/main/docs/plans/RELEASE_WORKFLOW_MIGRATION_PLAN.md) lands,
> follow `docs/develop/agentic-development.mdx` and `docs/develop/worktree-staging-qa.mdx`.

Preparation status: preview foundations are merged. Dedicated staging backend
`doting-cuttlefish-819` in project `overlay-staging` is provisioned but empty.
The staging controller is being prepared behind an unset
`RELEASE_STAGING_FROM_MAIN` repository variable. The current branch-based
staging lane remains authoritative until the migration checkpoint and cutover.

The prepared production command is `bash scripts/release/promote.sh <main-sha>`;
append `--check` for preflight only. It requires clean canonical current `main`,
Divyansh's identities and complete canonical staging smoke proof, including
reactive authorization. It builds production remotely without assigning domains,
verifies and publishes web, then pushes production Convex and runs authenticated
smoke with a separate synthetic account. Live promotion and rollback rehearsal
remain pending. See `docs/develop/worktree-staging-qa.mdx` for configuration,
checkpoints and the rollback runbook.

The separate production QA identity and deployment-scoped Convex credential are
prepared privately. WorkOS password authentication passed; production application
smoke and deployment remain pending. The bootstrap hosted-provider gate also
remains closed in test apps until their model keys are accepted. Enabling model
QA requires the shared hosted-access flag and emergency-switch settings described
in the staging guide, followed by a rebuild and a real application reply.

## Preview-domain decision — 2026-10-12

Implement stable `pr-<number>.preview.getoverlay.io` URLs with ordinary Vercel
custom domains and automated aliases. The native Preview Deployment Suffix
add-on is not a prerequisite and must remain disabled. This saves the add-on
subscription; existing hosting, build, domain, and backend usage charges still
apply. We own the alias provisioning, revision checks, and cleanup automation.

## Goals

- Many people, each running many coding agents, ship features in parallel.
- No feature regresses `main`, and every change is tested before production.
- Staging always matches `main` without anyone maintaining that by hand.
- Production stays a deliberate, manual step.

## Core idea

There is one integration branch, `main`. Every change reaches it through a pull
request. Each pull request is tested in **its own preview environment**, so
features are verified in isolation and in parallel. **Staging is a deployment of
`main`**, not a branch that collects work. Production is a **promotion of a
specific `main` commit** that has already passed on staging.

```
feature branch (one per task; one worktree per agent)
   │  PR → main
   ├─ CI: lint, typecheck, tests, build, config and boundary checks
   ├─ Preview: Vercel preview aliased to pr-<number>.preview.getoverlay.io
   │           + its own Convex preview backend, seeded with test data
   │           ← the agent and reviewer verify the feature here
   ▼
merge queue → main      ← re-runs CI on the PR combined with the latest main
   ▼
automatic deploy of main → staging.getoverlay.io + staging Convex
   │  smoke tests; webhook, billing and OAuth flows; migrations against realistic data
   ▼
manual promotion of that exact SHA → getoverlay.io (web first, then Convex prod)
```

## Environments

| Environment | Web | Convex backend | WorkOS | Third parties | Built from |
|---|---|---|---|---|---|
| Local | `localhost` | Each engineer's own Convex dev deployment | Staging environment | Test mode, CLI forwarding | Working tree |
| Preview | `pr-<number>.preview.getoverlay.io` (ordinary custom alias in the staging Vercel project, Preview scope) | One Convex preview deployment per PR, renewed while open and expired after close | Staging environment, wildcard redirect URI | Test mode; webhooks not delivered | Each PR head |
| Staging | `staging.getoverlay.io` (staging Vercel project, Production scope) | Dedicated staging deployment | Staging environment | Test mode with real webhooks | Every push to `main` |
| Production | `getoverlay.io` (production Vercel project) | Production deployment | Production environment | Live mode | A `main` SHA, promoted manually |

Rules that follow from this table:

- Shared configuration and secrets are set **once per environment scope**.
  Vercel's Preview scope and Convex's default preview environment variables cover
  every preview. Automation supplies the per-PR app URL through a branch-scoped
  Preview variable, and the Convex build injects that preview's backend URL.
  Neither requires copying secrets or configuring each PR by hand.
- Reuse existing development credentials through an explicit mapping. This
  repository's `.env.local` contains both dev and production settings: verified
  `DEV_STRIPE_*` values supply test billing, while shared-dev Convex selectors,
  live Stripe and the production OpenRouter key are excluded. Preserve separate
  preview/staging internal secrets. Update existing Convex previews separately
  when rotating credentials; defaults affect newly created backends only.
- Preview and staging secrets are **test-mode only**. Preview builds run whatever
  code a pull request contains, so they must never hold a production secret.
- A disabled integration, browser, sandbox or web-search provider also disables
  its feature flag. Release builds reject a `none` provider advertised as an
  enabled capability; this prevents chat from loading unavailable connectors.
- No environment shares a Convex backend with another, so one feature's schema
  change cannot break someone else's testing.

## Preview URLs without the paid suffix

Use Vercel's ordinary custom domains and aliases. **Do not purchase or enable
the native Preview Deployment Suffix add-on.** The workflow does not depend on
it; normal Vercel build, Convex, and other service usage costs still apply.

Add `*.preview.getoverlay.io` to the staging project using Vercel DNS and HTTPS.
`getoverlay.io` already uses Vercel nameservers. Trusted automation manages each
open PR's stable address, for example `pr-123.preview.getoverlay.io`:

The wildcard is registered for DNS and certificate coverage on the reserved
`codex/preview-unassigned` branch, with no deployment alias. Never deploy that
branch or use it for a PR. Only exact PR hostnames receive aliases; an unknown
or removed hostname must return HTTPS `404` without redirecting to staging.

1. On PR open or reopen, register its custom domain and configure the branch's
   Preview-scoped `NEXT_PUBLIC_APP_URL` before requesting a build. The server,
   browser, WorkOS callback, and enabled Convex callbacks use this same origin.
2. On a successful deployment, verify its project, Preview environment, source
   branch, and SHA against the PR's current head, then assign the address with
   `vercel alias set` or the equivalent Vercel API. Serialize updates per PR so
   an older deployment cannot replace a newer one.
3. Report the canonical URL and tested SHA in the PR. Browser QA runs after the
   alias resolves over HTTPS and points to that revision.
4. On PR close or merge, remove its alias/domain and branch-scoped app URL
   override, read back their absence, and require HTTPS `404`. Keep the shared wildcard and WorkOS callback registered; Convex
   preview backends follow their configured expiration/cleanup policy. Reject
   unassigned or closed PR hostnames so wildcard routing cannot expose staging
   under an address that appears to be a valid PR preview.

WorkOS staging accepts
`https://*.preview.getoverlay.io/api/auth/callback`; this callback is already
registered and verified. Preview sign-in uses the custom origin rather than a
generated `.vercel.app` hostname. Alias automation runs from trusted code with
scoped credentials; outside contributors' forks do not automatically receive
preview secrets or domains. Existing deployment protection remains in place.

References: [Vercel custom aliases for previews](https://vercel.com/kb/guide/how-to-alias-a-preview-deployment-using-the-cli),
[Vercel wildcard domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain),
[WorkOS wildcard callback rules](https://workos.com/docs/reference/authkit/authentication/get-authorization-url).

## The life of a change

Runtime, dependency and build changes receive hosted app previews. A PR confined
to docs, root Markdown or GitHub metadata/workflows keeps required CI and its
docs preview without rebuilding the unchanged app. `needs-preview` or a manual
PR Preview dispatch requests an app preview explicitly. Unknown or incomplete
file inventories still build. This avoids maintenance-only builds consuming the
capacity needed for feature QA.

1. **Start.** Create a `codex/<slug>` branch in its own worktree from the latest
   `origin/main`. One task per branch, one agent per worktree.
2. **Build.** Keep the change small. Unfinished user-facing work goes behind a
   feature flag so it can merge without being visible.
3. **Open a PR against `main`.** The description states what changed, how it
   was verified, and whether it needs staging-only verification (see below).
4. **Verify on the preview.** CI runs and the preview builds with its own Convex
   backend. Automation assigns its `pr-<number>.preview.getoverlay.io` address
   after checking the deployed SHA. The agent signs in with the preview-only
   test login, exercises the feature, and posts evidence in the PR: screenshots,
   test output, routes checked.
5. **Review.** A human reviews anything touching protected areas (see
   *Ownership*). Low-risk PRs merge once checks are green.
6. **Merge through the queue.** The merge queue tests the PR combined with the
   latest `main` and anything queued ahead of it, then merges. Merge commits keep
   meaningful history; trivial PRs may be squashed.
7. **Staging deploys automatically.** A GitHub Action builds each accepted
   `main` revision remotely in the staging project with its dedicated Convex
   backend. Keep `git.deploymentEnabled.main = false` in the shared Vercel
   configuration to preserve manual production releases. Automated smoke tests
   run against staging and record the exact revision.
8. **Staging-only checks.** PRs labelled `needs-staging` are checked on staging
   after merge: Stripe webhooks, Slack and connector OAuth, email, migrations
   against realistic data.
9. **Promote.** On a regular cadence (daily, or on demand), pick a `main` SHA
   that is green on staging. Deploy the production web app from that SHA, confirm
   it is live, then deploy production Convex from the same SHA and run
   production smoke tests.
10. **Roll back if needed.** Use Vercel's instant rollback for web. Because
    schema changes are backward compatible (below), the previous web build still
    works with the current Convex backend.

## What is tested where

| Concern | Preview | Staging | Production |
|---|---|---|---|
| UI and feature behaviour | ✅ primary | smoke | smoke |
| Convex functions and schema | ✅ with seed data | ✅ with realistic data | after promotion |
| Sign-in (WorkOS) | ✅ via test login and wildcard redirect | ✅ | ✅ |
| Stripe checkout and webhooks | checkout in test mode only | ✅ | live smoke |
| Slack, Google and other connector OAuth | ❌ fixed callback URLs | ✅ | ✅ |
| Automation callbacks (Convex → app) | when the preview app URL is configured | ✅ | ✅ |
| Data migrations and backfills | dry run on seed data | ✅ | after promotion |
| Combination with other merged work | ❌ | ✅ (that is staging's job) | — |

## Rules that keep `main` always shippable

- **Merge queue on `main`.** No PR merges against a stale `main`.
- **Feature flags for unfinished work.** Merging is not the same as releasing.
- **Backward-compatible Convex changes (expand, then contract).** Release 1 adds
  new fields or tables, writes both shapes, and backfills. A later release
  removes the old shape. Web and Convex deploy separately, so each must work
  with the previous version of the other.
- **Small, short-lived PRs.** Merged within a day or two. Long-running branches
  are where conflicts and regressions accumulate.
- **Never push or force-push `main` directly.** Everything goes through the
  queue, including the owner's changes.

## Ownership and review

- `CODEOWNERS` identifies the review owner for `convex/schema.ts`, migrations, auth
  (`src/server/auth/`, `src/app/api/auth/`), billing (`src/server/billing/`,
  Stripe webhooks), tenant boundaries, and release configuration (`vercel.json`,
  build scripts, `.github/`).
- Mandatory approving/code-owner reviews wait until a second eligible maintainer
  joins. With one owner, required approval remains zero under the standing owner
  instructions; Integration review and the stronger relevant QA still apply.
- Everything else may merge once checks pass and the preview has been verified.
- Agents may open and update PRs, verify previews, and enqueue merges for
  low-risk changes. Production promotion is always a human decision.

During the sole-owner period, retain CODEOWNERS and substantive agent review
without requiring an approving human review that the sole author cannot supply.
Enable the human approval gate when a second eligible reviewer joins.

## Roles

- **Builder** (human or agent): implements one change, verifies it on its
  preview, updates docs and `CHANGELOG.md`, opens the PR, and responds to review.
- **Release owner** (a human, rotating once the team grows): watches staging,
  runs staging-only checks, promotes to production, and handles rollback.

The separate Integration agent and its dedicated `staging` worktree are no
longer needed: the merge queue integrates, and staging deploys itself.

## Known limits

- Previews cannot receive third-party webhooks or finish third-party OAuth with
  fixed callback URLs. Those flows are verified on staging.
- Seed data does not reproduce every real data shape. Migrations are always
  checked on staging before production.
- Preview count is bounded by Vercel concurrent builds and Convex preview
  deployment limits. Previews build only for open pull requests.
- Custom preview addresses depend on alias automation. Failed builds leave the
  last successful alias in place; QA must check the deployed SHA before treating
  a preview as evidence for the current PR head.

Prepared staging backend: `doting-cuttlefish-819` has separately generated
internal secrets, its sandbox smoke identity and staging app URL configured, with
readback verified. Application functions and synthetic fixtures are not deployed
yet. The gated build sequence deploys backend functions, seeds guarded fixtures,
then builds web; Convex `deploy --cmd` alone runs the command before its push.
Activation still requires provider isolation, authenticated smoke and the cutover.

Shared Vercel Preview settings and Convex preview defaults now contain the
existing LayerNorm sandbox Stripe credentials/prices and the test Gateway key,
verified by readback. The dedicated staging Convex backend has corresponding
test settings with its own Gateway key. OpenRouter test access and isolated R2
storage remain pending. No provider credentials need copying per new PR.

Initial staging cutover is prepared as a candidate build and authenticated smoke
on its verified native hostname, leaving the current staging alias unchanged.
Publication requires provider isolation plus complete smoke evidence from that
same serialized workflow run; canonical staging is then smoked again. Automatic
main-based staging stays disabled until this live cutover succeeds.

Owner decision (2026-10-12): cut over when live isolation and staging smoke
checks pass; the planned one-to-two-week waiting period is waived.
