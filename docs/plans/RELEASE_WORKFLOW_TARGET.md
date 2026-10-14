# Target release workflow: previews, trunk, release candidates, production

> Current policy (2026-10-14): follow `docs/develop/Development Workflow.md`.
> Native Vercel Git deploys main; staging is optional. The custom production
> workflow and promotion command are retired. The plan below is historical.

**Status: implemented and live verified.**

Migration acceptance completed on 2026-10-13. The native main queue accepted the release; current-main candidate [run 38413217001](https://github.com/LayerNorm/overlay-web/actions/runs/38413217001) passed all ten authenticated checks before publication and again at canonical staging. Release `bee84a33a2d4b101bf85d3b179cd30984b556045` was promoted from clean canonical main: production web `dpl_8PQvmTsqT9PSHXSswyZDi2H6KfMg` was verified live before pushing customer Convex `colorful-chickadee-419`. Normal production sign-in, note CRUD/stale-edit 409, fresh Auto reply and reload persistence, Files, realtime tenant authorization and exact synthetic cleanup passed.

A deliberate web rollback to `dpl_H3bjroYBhAhJCx6EY8TAviPNNz3f` passed normal sign-in, note create/read and Files against the retained compatible backend. The current release was restored, its canonical alias verified, and the complete production smoke passed again. Production is left on `dpl_8PQvmTsqT9PSHXSswyZDi2H6KfMg`. The old baseline has no Git SHA metadata; its deployment ID is the rollback reference.

Dedicated staging `dpl_BvojtujMXadjjPjzGfp5F2quSXkt` uses isolated `doting-cuttlefish-819`. A real fake-card Stripe checkout, paid chat consumption and natural cancellation passed automatically: app Free/canceled, used credits preserved and unused paid allowance removed. This fresh acceptance needed no replay; the earlier failed synthetic event was repaired separately. Actual staging file-input upload, exact download, browser image rendering, metadata deletion and R2 HEAD 404 cleanup also passed.

Main merges create neither staging nor production deployments. The legacy staging branch stays frozen. Shared test credentials have no scheduled expiry; existing model budgets and platform preview renewal limits still apply. An earlier candidate run `38399463218` at `fd137da306aab1ee80b1fc3402946752397bb57b` failed its real-chat assertion. A subsequent live diagnostic reproduced malformed Auto output routed to `poolside/laguna-xs-2.1:free`; the unchanged checks passed on retry `38400746171`. The failed run did not publish staging. The release gate correctly refused that failed attempt. CODEOWNERS approval and removal of the emergency owner bypass are conditional on a second eligible maintainer joining. No purchased Preview Deployment Suffix is required.

The operating contract and commands are in `docs/develop/agentic-development.mdx` and `docs/develop/worktree-staging-qa.mdx`. Each later release still needs fresh evidence for its exact current-main SHA.

## Preview-domain decision — 2026-10-12

Implement stable `pr-<number>.preview.getoverlay.io` URLs with ordinary Vercel
custom domains and automated aliases. The native Preview Deployment Suffix
add-on is not a prerequisite and must remain disabled. This saves the add-on
subscription; existing hosting, build, domain, and backend usage charges still
apply. We own the alias provisioning, revision checks, and cleanup automation.

The living operating contract is [Release Workflow](/develop/release-workflow);
the migration plan retains the exact activation/acceptance checkpoint.

## Goals

- Many people, each running many coding agents, ship features in parallel.
- No feature regresses `main`, and every change is tested before production.
- Production releases verify exact merged main on demand, without a staging branch.
- Production stays a deliberate, manual step.

## Core idea

There is one integration branch, `main`. Every change reaches it through a pull
request. Each pull request is tested in **its own preview environment**, so
features are verified in isolation and in parallel. Before a production release, an **on-demand candidate of current main** verifies
the combined result against isolated test providers. Production is a **manual
promotion of that verified exact commit**. There is no automatic staging lane.

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
on-demand exact-main candidate → native deployment URL + dedicated test Convex
   │  smoke tests; webhook, billing and OAuth flows; migrations against realistic data
   ▼
manual promotion of that exact SHA → getoverlay.io (web first, then Convex prod)
```

## Environments

| Environment | Web | Convex backend | WorkOS | Third parties | Built from |
|---|---|---|---|---|---|
| Local | `localhost` | Each engineer's own Convex dev deployment | Staging environment | Test mode, CLI forwarding | Working tree |
| Preview | `pr-<number>.preview.getoverlay.io` (ordinary custom alias in the staging Vercel project, Preview scope) | One Convex preview deployment per PR, renewed while open and expired after close | Staging environment, wildcard redirect URI | Test mode; webhooks not delivered | Each PR head |
| Staging | `staging.getoverlay.io` (staging Vercel project, Production scope) | Dedicated staging deployment | Staging environment | Test mode with real webhooks | Owner-dispatched current `main` SHA |
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
- Shared test provider credentials and release automation tokens have **no scheduled
  expiry**, while keeping lane scopes and existing $1 total model limits. Rotate
  them when necessary and update inherited defaults plus existing backends.
  A depleted model budget can be raised without reissuing credentials. Per-PR
  resources are cleaned on close/merge; managed Convex retention is renewed
  automatically for open PRs. Session and presigned URL expiry stays short.
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
7. **Prepare a release candidate on demand.** When ready to release, manually
   dispatch `staging-release.yml` on current main. It builds and verifies that
   exact merged SHA using the dedicated test backend. Native candidate evidence
   qualifies directly; `publish_candidate=true` optionally updates the stable
   staging alias after smoke. Keep `git.deploymentEnabled.main=false`. Merges
   trigger neither staging nor customer production deployments.
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

- **Builder** (human or agent): implements one focused change in a feature
  worktree, verifies its preview, updates docs and CHANGELOG, and submits the PR.
- **Integration** (human or agent): reviews and enqueues the PR, verifies accepted
  main, dispatches on-demand release QA and performs owner-authorized production
  promotion and rollback. No dedicated staging worktree or branch is needed.

## Known limits

- Providers that require fixed webhook or OAuth callback URLs are verified on
  staging. WorkOS accepts the configured wildcard preview callback.
- Seed data does not reproduce every real data shape. Migrations are always
  checked on staging before production.
- Preview count is bounded by Vercel concurrent builds and Convex preview
  deployment limits. Previews build only for open pull requests.
- Custom preview addresses depend on alias automation. Failed builds leave the
  last successful alias in place; QA must check the deployed SHA before treating
  a preview as evidence for the current PR head.

Dedicated staging backend: `doting-cuttlefish-819` has separately generated
internal secrets, its sandbox smoke identity and staging app URL configured, with
readback verified. Application functions and synthetic fixtures are deployed. The gated build sequence deploys backend functions, seeds guarded fixtures,
then builds web; Convex `deploy --cmd` alone runs the command before its push.
Provider isolation, complete authenticated smoke and cutover passed on the
accepted application revision recorded below. Each future candidate requires
fresh smoke evidence.

Shared Vercel Preview settings and Convex preview defaults now contain the
existing LayerNorm sandbox Stripe credentials/prices and the test Gateway key,
verified by readback. The dedicated staging Convex backend has corresponding
test settings with its own Gateway and OpenRouter keys. Each OpenRouter key has
no expiry and a $1 total limit without reset. Shared Preview model keys and
hosted-access flags are verified by readback; an actual Free Router reply and reload persistence passed. Authenticated R2 upload/finalization, exact byte download, browser image
rendering and CORS isolation also passed. No provider credentials need copying per new PR.

Each on-demand candidate is tested on its verified native hostname before any
optional canonical publication. Publication requires provider isolation plus
complete smoke evidence from the same serialized workflow run; canonical staging
is then smoked again. Both gates passed for the accepted application revision
`bee84a33a2d4b101bf85d3b179cd30984b556045`, now served by canonical staging.
Main merges never deploy staging; this workflow remains manual-only.

Owner decision (2026-10-12): cut over when live isolation and staging smoke
checks pass; the planned one-to-two-week waiting period is waived.

### Cutover acceptance status (2026-10-13)

Migration acceptance passed on 2026-10-13. Candidate workflow `38413217001` verified exact main `bee84a33a2d4b101bf85d3b179cd30984b556045` before and after staging publication. Production `dpl_8PQvmTsqT9PSHXSswyZDi2H6KfMg` was verified web-first, then customer Convex and full authenticated smoke passed. Deliberate web rollback, compatibility checks, restoration and full final smoke passed; the accepted release is live. Automatic test Stripe checkout/cancellation and actual browser storage acceptance passed. See the migration plan and `docs/plans/release-workflow-evidence/` for exact proof. Subsequent releases require fresh evidence.

### Interrupted preview build recovery

The installed Convex CLI executes `--preview-run` only for newly claimed preview
backends. An interrupted first build can leave a reused backend without fixtures.
After every successful preview deploy, the hosted build therefore explicitly runs
`dev/seed:init` against `preview/pr-<number>` using the preview-scoped key. This
idempotent repair preserves edited fixture data and reuses any existing personal
workspace; it does not recreate the backend or deploy shared development/production.
A failed deploy never runs the repair, and a failed repair fails the hosted build.


### Verified workspace and queue protections

Release smoke resolves and activates the synthetic account's actual personal
workspace through the authenticated app API. It uses that ID for chat, Files and
realtime checks, including when seeding reuses an app-created workspace. It creates
a fresh Auto-model smoke conversation, verifies its real reply and reload, then
cleans that conversation; seed examples are not model-response evidence.

Main protection is consolidated in ruleset `21959970`: PRs, conversation
resolution, nine required GitHub Actions checks and the native merge queue.
The duplicate classic owner-only push protection was retired; queue publication
is governed by these rules. History ruleset `16007495` separately blocks force
pushes and deletion for main/staging with no bypass. Legacy staging is frozen by
`24986525`. Owner emergency bypass and zero sole-author approvals remain.
Queue interaction probes #196/#197 passed individually but their combined tree
was marked UNMERGEABLE; both closed without merging and the temporary check was
removed. PR #195 merged through the native queue at
`6bb3e0d8294a955030e3c6b2f7ba7d353f6475d7`, with all nine combined checks
passing and no automatic staging or customer deployment.

### Chat smoke readiness

Candidate and production smoke create a fresh Auto conversation, await its initial
transcript response, matching `data-overlay-chat-id` with
`data-overlay-chat-hydrated="true"`, and requested heading, then explicitly select Chat before
sending. A visible composer alone does not prove route hydration is complete.
Live diagnostics reproduced an early send using default model/runtime state;
waiting for the transcript fixed immediate reply rendering and reload persistence.
Both suites clean their own synthetic conversations after success or failure.

### Checkout cancellation acceptance

Fresh test-only acceptance passed at canonical staging: Stripe checkout completed/paid, both checkout and creation webhooks processed, and the app showed the $20 active paid plan. A real Auto chat consumed 100 micros. Natural cancellation processed its deleted event and the app became Free/canceled; used and included micros both remained 100, reserved micros were zero, and unused paid funding was removed. No manual replay was used for this fresh event. The earlier synthetic cancellation that failed before the fix was repaired separately after its accepted staging deployment. The Chrome return reached canonical staging with an expired/guest browser session; billing and ownership were verified using the existing normally authenticated synthetic Sandbox session.

Cancellation also removes unused paid funding as pre-existing holds release or settle below their estimate. Both release smoke suites await actual transcript hydration and clean their exact synthetic chats on success or failure.

### Complete dedicated candidate (2026-10-13)

The first complete candidate was `f863915508795c695d9778f33476eaaf4d14436e`, workflow `38394669549`. Its recorded evidence remains historical. The final current-main candidate and production/rollback acceptance are recorded in the activation checkpoint above and `docs/plans/release-workflow-evidence/`.

### Production CLI output and readiness

Vercel CLI 63 non-interactive deployment JSON is parsed explicitly, including native-hostname inspection output. The command polls the owned exact-SHA deployment until READY, rejecting changed provenance, terminal errors and a bounded timeout. Web publication/live verification precedes production Convex and authenticated smoke. Earlier remote-build capture attempts left unpublished READY builds and preserved the customer alias. Structured CLI parsing/readiness merged through PR #203; asynchronous submission and bounded command capture merged through PR #204. The complete corrected command, production smoke and rollback/restoration passed on the release recorded above.

### Asynchronous production build submission

Production uses `vercel deploy --prod --skip-domain --no-wait` and the owned exact-SHA READY poll. Other release commands retain a bounded 16 MiB capture. The earlier synchronous attempt stopped at local ENOBUFS while its remote build continued, preserving the customer alias and backend. The corrected complete command passed on the release recorded above; both unpublished earlier builds remain historical.
