# Release workflow migration plan

Moves Overlay from direct pushes to `main` plus an optional branch-based staging
lane, using one shared dev Convex, to the target workflow in
[`RELEASE_WORKFLOW_TARGET.md`](https://github.com/LayerNorm/overlay-web/blob/main/docs/plans/RELEASE_WORKFLOW_TARGET.md): per-PR previews,
merge queue on `main`, on-demand exact-main release candidates, manual production promotion.

## Current acceptance — 2026-10-13

Migration acceptance completed on 2026-10-13. The native main queue accepted the release; current-main candidate [run 38413217001](https://github.com/LayerNorm/overlay-web/actions/runs/38413217001) passed all ten authenticated checks before publication and again at canonical staging. Release `bee84a33a2d4b101bf85d3b179cd30984b556045` was promoted from clean canonical main: production web `dpl_8PQvmTsqT9PSHXSswyZDi2H6KfMg` was verified live before pushing customer Convex `colorful-chickadee-419`. Normal production sign-in, note CRUD/stale-edit 409, fresh Auto reply and reload persistence, Files, realtime tenant authorization and exact synthetic cleanup passed.

A deliberate web rollback to `dpl_H3bjroYBhAhJCx6EY8TAviPNNz3f` passed normal sign-in, note create/read and Files against the retained compatible backend. The current release was restored, its canonical alias verified, and the complete production smoke passed again. Production is left on `dpl_8PQvmTsqT9PSHXSswyZDi2H6KfMg`. The old baseline has no Git SHA metadata; its deployment ID is the rollback reference.

Dedicated staging `dpl_BvojtujMXadjjPjzGfp5F2quSXkt` uses isolated `doting-cuttlefish-819`. A real fake-card Stripe checkout, paid chat consumption and natural cancellation passed automatically: app Free/canceled, used credits preserved and unused paid allowance removed. This fresh acceptance needed no replay; the earlier failed synthetic event was repaired separately. Actual staging file-input upload, exact download, browser image rendering, metadata deletion and R2 HEAD 404 cleanup also passed.

Main merges create neither staging nor production deployments. The legacy staging branch stays frozen. Shared test credentials have no scheduled expiry; existing model budgets and platform preview renewal limits still apply. An earlier candidate run `38399463218` at `fd137da306aab1ee80b1fc3402946752397bb57b` failed its real-chat assertion. A subsequent live diagnostic reproduced malformed Auto output routed to `poolside/laguna-xs-2.1:free`; the unchanged checks passed on retry `38400746171`. The failed run did not publish staging. The release gate correctly refused that failed attempt. CODEOWNERS approval and removal of the emergency owner bypass are conditional on a second eligible maintainer joining. No purchased Preview Deployment Suffix is required.

## Approved preview-domain approach — 2026-10-12

Use ordinary wildcard custom domains plus automated per-PR aliases:
`https://pr-<number>.preview.getoverlay.io`. Do not buy or enable Vercel's native
Preview Deployment Suffix. The implementation includes DNS/HTTPS, canonical
OAuth origins, trusted alias automation, current-head SHA validation, and
idempotent cleanup. Normal platform usage costs and limits still apply.

Implementation begins with the preview foundations (Phases 1–4); cut over the
release lane only after their live acceptance checks pass. A separately scoped
Vercel CI credential is required for unattended domain and deployment control.

## Historical setup checkpoints — 2026-10-12

These dated setup notes describe the state during migration. Current acceptance above supersedes their pending-work statements.

### Initial account preflight

- GitHub CLI is authenticated as `DevelopedByDev` with repository admin access.
  `LayerNorm/overlay-web` is public and organization-owned, so GitHub merge queue
  is available even though the organization is on the Free plan.
- Vercel CLI and MCP access the production and staging projects. The team is on
  Pro. Staging currently builds `staging`, blocks previews, and requires Vercel
  authentication for previews. Many Preview-scoped variables already exist;
  audit their values and isolation rather than blindly copying staging values.
- `getoverlay.io` already uses Vercel nameservers. Use an ordinary wildcard
  domain with automated per-PR aliases (`pr-<number>.preview.getoverlay.io`).
  The native Preview Deployment Suffix is not enabled and is a $100/month Pro
  add-on; this migration will not purchase or enable it.
- WorkOS MCP has admin access to the LayerNorm sandbox and production
  environments. The sandbox accepted
  `https://*.preview.getoverlay.io/api/auth/callback` in a dry run; it was then
  added and verified by readback, preserving every existing callback and the
  default URI. A relay is unnecessary for this domain pattern.
- The signed-in LayerNorm Chrome profile can access Convex. The team currently
  uses Starter; Overlay has production `colorful-chickadee-419` and development
  `different-caiman-77`. Current Convex documentation supports previews on Free
  and Starter, with five-day expiration and a 40-deployment team limit.

Bootstrap progress: the WorkOS sandbox callback is registered; the QA account
`overlay-preview-qa@getoverlay.io` is created and password authentication is
verified. Overlay's project-scoped Convex preview key and preview defaults
(sandbox identity, internal secrets, email disabled) are provisioned and verified
by readback. Vercel has verified `*.preview.getoverlay.io` on the staging project.

Preview build/URL isolation, internal seed fixtures, outbound-delivery guards,
preview-only QA login, trusted alias control and merge-group CI support are
merged through PR #187 into `main` at
`bb8e346573ba4b834d5f36f8ef80346d840c4d7f`. Accepted PR head
`f0f48e6ecc3b16045a2ad3940b31e589d9fca87e` passed every required GitHub check,
exact-head sandbox login, note CRUD, stale-edit `409`, seed preservation and
authenticated browser rendering.
Local full-suite, typecheck, build, lint, config, release-safety, boundary, docs,
production audit and staged secret scan passed. These foundations do not yet
complete the release-lane migration.

The owner-approved non-expiring `VERCEL_STAGING_TOKEN` is stored in GitHub's
`release-control` environment, whose branch policy permits only `main`.
It is restricted to `overlay-web-staging` and remains valid until revoked. API scope
checks succeeded for staging and denied production access. Initial Preview
configuration contained 46 isolated sandbox variables; all 71 existing Production
variables were preserved. Shared test Stripe/Gateway settings are now configured
and readback verified. Separate non-expiring OpenRouter test keys now have a $1 total
limit each with no reset. Shared Preview web/defaults and the dedicated staging
backend readback passed; a real application Free Router reply and reload persistence passed. Authenticated R2 upload/finalization, exact byte download, browser image
rendering and CORS isolation passed on PR #194. Preview deployment policy permits
REST API sources only; native Preview Git builds remain disabled.

PR #187's accepted Preview was READY at
`https://pr-187.preview.getoverlay.io`, deployment
`dpl_BCsNtWxTT8bR9B5ShcQsNpcoNV9y`, with backend `zany-dalmatian-999`
(reference `preview/pr-187`). After merge, the first trusted-main workflow
run `38312156190` completed successfully and cleaned its domain, alias and
branch app URL; the former origin returned HTTPS `404`. This verifies access to
the main-only control secrets and real lifecycle execution in GitHub Actions.
The production deployment remained `dpl_H3bjroYBhAhJCx6EY8TAviPNNz3f`; no
production deployment was created for the merge SHA. Existing shared staging
was preserved. Subsequent open/update probes verified unattended builds, isolated backends,
current-head alias assignment, cancellation of superseded builds and cleanup.

Temporary draft QA PRs #188 and #189 were simultaneously READY with distinct
backends `laudable-lynx-602` and `accomplished-mallard-199`. Live internal queries
proved incompatible string and number values in the same schema column. These
PRs must never merge. Genuine sandbox login passed in both; a note created and
updated in #188 was absent from #189, where reading its ID returned `404` and
existing notes stayed unchanged. The temporary note was removed. Live head-race QA
pushed revision B while revision A built, confirmed A became `CANCELED`, and
verified its deployment never replaced the existing alias. The current-head
rebuild advanced only #188's alias and preserved its backend and fixture. Both
QA PRs are closed without merging; domain/alias/branch-URL readback confirmed
removal, and each former hostname returned HTTPS `404` without a redirect.
Repeated cleanup was idempotent. The Builder prompt now
requires draft PR preview evidence before integration handoff.

Wildcard inspection found an old staging fallback alias. The wildcard now uses
reserved branch `codex/preview-unassigned`, registered only for DNS/certificates,
with no deployment alias. Unknown preview hostname HTTPS `404` and the unchanged
existing staging alias were verified by readback. The controller refuses a
fallback wildcard or that reserved branch as a PR source, retries transient GET
reads only, and checks HTTPS `404` after close cleanup. Do not blindly retry
mutations whose responses were lost; reconcile ownership and state first.

The Convex preview key successfully renewed backend expiry with API readback.

Live chat preparation found that provider `none` still left integration
capabilities enabled, causing `500: Integrations are disabled` before the model
call. The unscoped Vercel Preview defaults now explicitly disable integrations,
browser use, sandboxes and web search with their corresponding feature flags;
readback preserved every legacy Production variable. Release builds reject
inconsistent disabled-provider flags. Existing deployments need rebuilding to
receive these settings. PR #194 subsequently passed a real Free Router reply,
reload persistence, isolated R2 upload/download, image rendering and CORS denial.
These provider checks do not activate staging or production.
Reconciliation renews validated open PR backends within Starter's five-day
limit; closed PRs expire naturally. Missing or expired backends force a fresh
same-SHA frontend build and seed. PR #190's unattended open event built accepted head
`2675e4a700725ace91dcc30cc40e3347235856ce` and assigned its canonical URL.
Authenticated note create/read/update/delete and stale-edit `409` checks passed;
the normal browser sign-in opened Files with both synthetic fixtures. Provider QA
was subsequently accepted on PR #194; merge queue enablement, staging cutover
and production promotion remain open.
These results apply to that revision; subsequent commits require fresh checks.

Staging preparation: Divyansh's Convex team now has project `overlay-staging`
(`3199896`) and persistent backend `doting-cuttlefish-819`. Its deployment-scoped
key is stored privately with no expiry; it is not a team credential.
Staging core and test Stripe/Gateway variables are configured and verified by readback, including
fresh internal API/service secrets and the sandbox smoke identity. The web secrets
are installed in staging Vercel Production scope, preserving Preview defaults.
The staging project production branch is `main`, with automatic domain assignment
disabled; at that checkpoint its canonical alias served the previous staging deployment. App functions and guarded synthetic fixtures have been deployed; no customer
data was copied.
Original Overlay production/development deployments were preserved by readback.
The prepared `staging-control.mjs` and `staging-release.yml` require the exact
Divyansh Vercel team/project, internal repository, `main` SHA, and dedicated
backend. Builds are serialized, abandoned builds are settled, automatic aliases
are disabled, and READY provenance is checked before assigning staging.
`RELEASE_STAGING_FROM_MAIN` remains unset and is obsolete in the manual-only workflow: the existing staging branch and web
deployment still serve the current lane. This is preparation, not Phase 5
acceptance. Authenticated staging smoke, provider isolation,
platform cutover, and the process-doc rewrite must precede activation.

Plan adjustments before implementation:

- Measured PR #190 timings: full suite 2m39s, required quality gate 9m7s,
  preview queue 20m56s, hosted build 4m. The queue dominated that PR's wall time.
  Cancel obsolete PR CI revisions; omit app previews for complete docs/root
  Markdown/GitHub-only diffs while retaining required checks and a manual or
  `needs-preview` override. Runtime/build/dependency and unknown diffs still build.
  Dependency Review must execute its comparison, not infer availability from an
  absent repository field. Separate paid canaries from required contract checks
  so deployment-status skips cannot obscure the actual PR result.

- Agent test login must create a session containing a genuine sandbox WorkOS
  access token accepted by Convex, with the same user identity used by the seed.
  Creating an `overlay_session` cookie alone does not authenticate Convex.
- Required human review needs a second eligible reviewer. Keep the sole-owner
  setup operable until another engineer joins; add CODEOWNERS without enabling
  an approval requirement the author cannot satisfy.
- Audit all required checks for merge-group support, including CLA and
  PR-specific dependency checks, before requiring the merge queue.

Sources: [GitHub merge queue availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue),
[Vercel preview suffix](https://vercel.com/docs/deployments/preview-deployment-suffix),
[Vercel custom aliases for previews](https://vercel.com/kb/guide/how-to-alias-a-preview-deployment-using-the-cli),
[Vercel pricing](https://vercel.com/docs/pricing),
[Convex deployment types and limits](https://docs.convex.dev/production/multiple-deployments).

## Baseline before migration

This table records the original lane. Current implementation progress is above
and in each phase's checklist.

| Area | Current state | Source |
|---|---|---|
| Vercel projects | `overlay-landing` (prod, branch `main`) and `overlay-web-staging` (branch `staging`) | `scripts/vercel-ignore-build.sh` |
| Preview builds | Blocked in both projects by the ignore-build guard (`DEPLOY_BRANCH`), fail-closed | `scripts/vercel-ignore-build.sh` |
| Prod auto-deploy | Off: `git.deploymentEnabled.main = false`; prod is `vercel deploy --prod` by hand | `vercel.json` |
| Convex | One prod deployment (`colorful-chickadee-419`) and one **shared** dev deployment used by local work and staging | `package.json` `convex:push:*` |
| Convex URL choice | `prefersDevConvexUrl()` sends `VERCEL_ENV=preview` to `DEV_NEXT_PUBLIC_CONVEX_URL`, i.e. the shared dev backend | `src/server/database/convex-url.ts` |
| App URL | `getBaseUrl()` prefers `NEXT_PUBLIC_APP_URL` over `VERCEL_URL`, so a preview would call itself staging | `src/server/web/app-url.ts` |
| WorkOS callback | `${getBaseUrl()}/api/auth/callback`; redirect URIs are fixed in the WorkOS dashboard | `src/server/auth/workos-auth.ts` |
| CI | `Security Checks` runs on `pull_request` and pushes to `main`/`master`/`staging`; **no `merge_group` trigger** | `.github/workflows/security.yml` |
| Branch rules | PR + required checks on `main` and `staging`; `DevelopedByDev` bypass; no merge queue; no required review | `AGENTS.md` |
| Feature flags | No flag system in app code | — |
| Process docs | Builder / Integration agent roles, standing direct-push authorisations, "main and staging may diverge" | `AGENTS.md`, `docs/develop/agentic-development.mdx`, `docs/develop/worktree-staging-qa.mdx` |

## Principles for the migration

- Phases 1–4 **add** preview capability without changing the current release
  lane. Nothing about how `staging` and `main` ship changes until Phase 5.
- Each phase is independently useful and independently reversible.
- Dashboard changes (Vercel, Convex, WorkOS, GitHub, DNS) are the owner's; code
  changes go through normal PRs. Each phase lists both.
- Use ordinary custom domains and automated aliases for preview URLs. No native
  Preview Deployment Suffix subscription is required. Shared secrets remain
  environment-scoped; automation manages each PR's app URL and domain lifecycle.

## Phase 0 — Confirm prerequisites (owner, ~1 hour)

Answer these before writing code; several later choices depend on them.

- [x] **Convex:** Starter supports previews with five-day retention and a
      40-deployment team limit. Keep open PRs alive by bounded expiry renewal
      through the project preview key, not by assuming a push resets expiration.
- [x] **Convex:** use a separate `overlay-staging` project with its own staging
      deployment/key. Project `3199896`, backend `doting-cuttlefish-819`, and a
      deployment-scoped key are provisioned. Its isolated configuration, functions and synthetic fixtures are now deployed.
      Canonical staging publication remains gated on complete smoke.
- [x] **WorkOS:** confirm the staging environment accepts a wildcard redirect URI
      such as `https://*.preview.getoverlay.io/api/auth/callback`. Accepted,
      registered, and verified; no relay is needed for this pattern.
- [x] **Vercel:** verify ordinary wildcard domains and custom alias permissions
      in the staging project, and check concurrent-build and domain/alias limits.
      Do not enable the paid Preview Deployment Suffix add-on.
- [x] **DNS:** confirm `getoverlay.io` already uses Vercel nameservers, which
      support the wildcard certificate. Phase 3 configures the preview domain.
- [x] **GitHub:** confirm merge queue is available for `LayerNorm/overlay-web`.

Checkboxes below track code implementation and platform configuration. Phase
acceptance still requires each "Done when" result. PR #187 is merged; trusted
`main` automation is active and its first real cleanup run passed.

## Phase 1 — Preview builds in the staging project

Goal: every internal PR targeting main gets one Vercel preview that builds and
loads. Enable this together with Phase 2 so no hosted PR uses shared dev Convex.

Code:
- [x] `scripts/vercel-ignore-build.sh`: when `VERCEL_ENV=preview` in the project
      with `PREVIEW_BUILDS=pr`, run the build only if `VERCEL_GIT_PULL_REQUEST_ID`
      is set (open PR); otherwise keep current fail-closed behaviour. Leave the
      production project's behaviour unchanged. Update the header comment.
- [x] Add tests for the new guard branches next to the existing guard tests (or
      add a small shell test if none exist).

Dashboard (owner):
- [x] `overlay-web-staging` → Environment Variables: replace inherited Preview
      configuration with isolated sandbox values and `PREVIEW_BUILDS=pr`.
      Preserve Production scopes. Provision dedicated test providers before
      claiming model, upload, or billing acceptance.
- [x] `overlay-web-staging` → deployment policy: enable Preview **REST API**
      sources for the trusted PR controller. Keep native Preview Git sources
      disabled so duplicate builds and automatic branch aliases cannot race
      current-head validation. The final cutover also disables Production Git sources; both scopes use
      trusted REST controllers.
- [x] Keep `overlay-landing` previews disabled.

Done when: opening a PR produces one preview in the staging project, none in the
production project, and pushes to branches without a PR build nothing.

The trusted controller provisions the app URL and explicitly requests the exact
head revision on PR open/reopen. An unassociated branch push creates no build.

## Phase 2 — One Convex backend per preview

Goal: each preview runs against its own Convex preview deployment with seed data.

Code:
- [x] `scripts/vercel-build.sh`: choose the build by `VERCEL_ENV`:
      - preview → `npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --preview-run dev/seed:init`
      - otherwise → current behaviour (`npm run build`), so prod and staging are untouched.
- [x] `src/server/database/convex-url.ts`: when a preview build has a
      Convex-injected URL, use it instead of `DEV_NEXT_PUBLIC_CONVEX_URL`
      (e.g. a `CONVEX_PREVIEW=1` marker set by the build script). Extend
      `convex-url.test.ts` for preview, staging and production.
- [x] `convex/dev/seed.ts`: an internal mutation `init` that creates test users
      matching the preview test login (Phase 4), a workspace, a conversation,
      notes, files and an automation. It must refuse to run unless the
      deployment is a preview (check a `OVERLAY_DEPLOYMENT_ENV=preview` Convex
      env var) so it can never touch staging or production.
- [x] Crons and outbound side effects (`convex/crons.ts`, email, provider calls):
      skip when `OVERLAY_DEPLOYMENT_ENV=preview`, or route to no-op adapters.
- [x] Automation callbacks: set the preview's app URL on its Convex backend
      during the build (`npx convex env set` against the preview), or disable
      callback-driven flows on previews and mark them staging-only.

Dashboard (owner):
- [x] Convex → project settings → generate a **Preview Deploy Key**; add it in
      Vercel as `CONVEX_DEPLOY_KEY`, **Preview scope only**.
- [x] Convex → default environment variables for preview deployments: WorkOS
      issuer/JWKS values for the staging environment, `INTERNAL_API_SECRET`,
      `INTERNAL_SERVICE_AUTH_SECRET` (matching the Vercel Preview values, and
      different from each other), `OVERLAY_DEPLOYMENT_ENV=preview`, and any
      test-mode provider keys Convex actions need.
- [x] The trusted controller supplies `bash scripts/vercel-build.sh` as the
      Preview deployment's build-command override. Keep the legacy staging
      Production project setting unchanged until Phase 5; its branch does not
      yet contain the wrapper.

Done when: two PRs that change the schema in incompatible ways both build and
work on their previews at the same time, and the shared dev deployment is untouched.

## Phase 3 — Stable preview URLs and WorkOS sign-in

Goal: real sign-in works at each PR's stable custom address, with no native
Preview Deployment Suffix purchase.

Code:
- [x] Add trusted PR lifecycle automation. On open/reopen, derive
      `https://pr-<number>.preview.getoverlay.io` from the verified PR number,
      register the domain in the staging project, and set the source branch's
      Preview-scoped `NEXT_PUBLIC_APP_URL` override before requesting a build.
      Shared Preview secrets remain inherited; no manual per-PR configuration.
- [x] On Preview deployment readiness, validate the staging project ID,
      environment, repository, branch, open PR, and current head SHA before
      assigning the custom address with `vercel alias set` or the equivalent
      Vercel API. Serialize alias updates per PR and reject stale deployments.
      Publish the canonical URL and deployed SHA for QA.
- [x] On PR close/merge, remove its alias/domain and branch-scoped app URL
      override, handling missing resources idempotently. Keep the shared
      wildcard domain and WorkOS wildcard callback. Convex preview cleanup
      follows its configured retention policy. Reject unassigned and closed PR
      hostnames; removing an alias must not allow the shared wildcard to serve
      staging under that hostname. Add reconciliation for missed lifecycle events.
- [x] Reconcile Convex preview expiry for open PRs using the project preview
      key. Validate project, preview type, reference and identifier before
      renewal; never renew closed PRs. If a backend expired, force a fresh web
      build and seed at the same SHA rather than reusing a READY frontend.
- [x] Keep credential-bearing automation on trusted workflow code; do not
      execute PR code with domain-management credentials or automatically
      provision secret-bearing previews for outside contributors' forks.
- [x] `src/server/web/app-url.ts`: use the configured canonical PR alias for
      `VERCEL_ENV=preview`, validating that it is an HTTPS
      `pr-<number>.preview.getoverlay.io` origin. Prevent fallback to staging or
      raw `VERCEL_BRANCH_URL`/`VERCEL_URL` for preview OAuth redirects. Add tests
      covering the alias, missing configuration, staging, and production.
- [x] Ensure the build's `NEXT_PUBLIC_APP_URL`, server redirects
      (`workos-auth.ts` and `normalizeAuthRedirect`), browser links, and enabled
      Convex callbacks agree on the custom alias. Generated Vercel URLs are
      deployment identifiers, not the preview's canonical sign-in origin.
- [x] Check CSP, CORS and allowed-origin lists (`npm run check:config`) accept
      `*.preview.getoverlay.io` on previews only.

Dashboard (owner):
- [x] Add the ordinary wildcard domain `*.preview.getoverlay.io` to
      `overlay-web-staging`, configure its DNS in the existing Vercel zone, and
      verify HTTPS issuance. Registered on reserved branch
      `codex/preview-unassigned` for certificate coverage only, without a
      deployment alias. Unknown/closed hosts must return HTTPS `404`. Leave the
      native Preview Deployment Suffix disabled.
- [x] Provision scoped Vercel credentials to the trusted alias automation and
      retain existing deployment protection. QA uses an authorized login or
      scoped automation bypass where required.
- [x] WorkOS staging environment: add
      `https://*.preview.getoverlay.io/api/auth/callback` as a redirect URI.
- [x] Confirm WorkOS uses server-side OAuth callbacks; additional browser-side
      WorkOS API origins/CORS are not required by this implementation.

Done when: two open PRs have distinct `pr-<number>.preview.getoverlay.io` aliases,
valid HTTPS, and separate Convex data; a human can sign in with Google/email on
each. A subsequent push advances only that PR's alias to its current successful
SHA, a stale deployment cannot replace it, and closing the PR removes its domain
and app URL override; its former hostname cannot serve staging. The paid
Preview Deployment Suffix remains disabled.

## Phase 4 — Preview-only test login for agents

Goal: agents verify their own PRs end to end without real OAuth.

Code:
- [x] `src/app/api/auth/preview-login/route.ts`: mints an `overlay_session` for
      a seeded test user. Returns 404 unless **all** of: `VERCEL_ENV=preview`,
      `OVERLAY_DEPLOYMENT_ENV=preview`, and a `PREVIEW_LOGIN_SECRET` header match.
      Add a release-safety test that fails if the route can respond in a
      production or staging configuration.
- [x] Update `docs/develop/browser-testing-with-agent-browser.md` with the
      preview sign-in recipe.
- [x] Update the Builder prompt: verify on the PR's preview and attach evidence.

Dashboard (owner):
- [x] Vercel Preview scope: `PREVIEW_LOGIN_SECRET` (random, preview only). Give
      it to cloud agents through their secret store, not the repo.

Done when: an agent, given only the PR number, finds the preview URL, signs in,
and posts screenshots to the PR.

**Checkpoint:** the owner waived the one-to-two-week soak on 2026-10-12.
Cut over after live provider isolation and authenticated staging smoke pass.
A calendar waiting period is not required; the acceptance checks still are.

## Phase 5 — On-demand exact-main release candidates

**Owner decision, 2026-10-13:** PR previews replace the routine staging lane.
Keep `overlay-web-staging` because it hosts PR previews. Reuse its dedicated
`doting-cuttlefish-819` test backend only for release rehearsals requiring
production-like Convex behavior, stable webhook integrations or migrations.
Do not deploy staging after every merge. The legacy staging branch is frozen.

- [x] Prepare manual-only `staging-release.yml` on protected main; no push trigger
      or `RELEASE_STAGING_FROM_MAIN` activation is required. Always build an
      unpublished native candidate first, with exact SHA/project/backend guards.
- [x] Deploy dedicated test functions, guarded synthetic fixtures, then web in a
      serialized remote build. Preserve root `git.deploymentEnabled.main=false`.
- [x] Select backend using explicit staging environment instead of host sniffing.
- [x] Require normal Sandbox sign-in, note CRUD/stale conflict and cleanup, real
      chat, Files UI and realtime authorization in same-run smoke evidence.
- [x] Accept successful unpublished native candidate proof for manual production
      promotion. Validate trusted manual producer, current main, ready deployment
      and exact native hostname. Never accept a PR-head preview as merged-main proof.
- [x] Prepare optional `publish_candidate=true` for stable staging integrations;
      require provider isolation, complete first smoke and canonical second smoke.
- [x] Configure preview project's Production branch as main, REST-only deployment
      policy, automatic aliases disabled and isolated dedicated test providers.
- [x] Freeze legacy staging through a no-bypass update rule and read it back.
- [x] Execute complete live exact-main candidate acceptance and production drill;
      see current acceptance and recorded evidence above.

Done when: an owner-dispatched current-main release candidate passes complete
behavioral checks, qualifies for promotion, and main merges create neither staging
nor customer production deployments.

## Phase 6 — Merge queue and review rules

Goal: parallel merges cannot break `main`.

Code:
- [x] All required check workflows, including security, support `merge_group:`.
      Without it, queued PRs wait forever for checks.
- [x] Drop `staging` from security push branches once Phase 5 is done.
- [x] `.github/CODEOWNERS`: owners for `convex/schema.ts`, `convex/migrations/`,
      `src/server/auth/`, `src/app/api/auth/`, `src/server/billing/`,
      `src/app/api/webhooks/`, `vercel.json`, `scripts/vercel-*.sh`, `.github/`.
- [x] `.github/pull_request_template.md`: change summary, preview evidence,
      `needs-staging` checkbox, schema-change checkbox (expand/contract confirmed).

Dashboard (owner):
- [x] `main` ruleset: require merge queue; keep required checks and history
      protection. Configure main separately so legacy staging is not queued.
- Deferred until a second eligible maintainer joins: require CODEOWNERS approval.
      Standing owner instructions prohibit reinstating approving reviews while
      the sole author cannot approve their own PR. The current requirement stays
      zero; owner-authorized Integration review and protected-area QA still apply.
- Deferred until a second engineer joins: remove the `DevelopedByDev` bypass (keep it
      only as an emergency break-glass, documented).
- [x] Create the `needs-staging` label.

Done when: two PRs that conflict semantically (each green alone) cannot both
land; the second fails in the queue.

## Phase 7 — Production promotion and safety rails

Goal: promotion is boring and reversible.

Migration acceptance passed on 2026-10-13. Candidate workflow `38413217001` verified exact main `bee84a33a2d4b101bf85d3b179cd30984b556045` before and after staging publication. Production `dpl_8PQvmTsqT9PSHXSswyZDi2H6KfMg` was verified web-first, then customer Convex and full authenticated smoke passed. Deliberate web rollback, compatibility checks, restoration and full final smoke passed; the accepted release is live. Automatic test Stripe checkout/cancellation and actual browser storage acceptance passed. See the migration plan and `docs/plans/release-workflow-evidence/` for exact proof. Subsequent releases require fresh evidence.

Code:
- [x] Prepare `scripts/release/promote.sh <sha>`: checks the SHA is on `main` and has a
      green staging smoke run, deploys prod web (`vercel deploy --prod` at that
      SHA, remote build), waits for it to be live, then runs `convex:push:prod`
      from a clean checkout of that SHA, then runs the production smoke suite.
      Keeps today's ordering rule: web first, Convex after.
- [x] Feature flags: `createReleaseFlags` evaluates an explicit set of boolean
      PostHog keys once per authenticated request, bounded to 300ms with an off
      fallback. No product feature is enabled automatically; callsites still
      need both-path QA before rollout.
- [x] Document expand/contract for Convex schema changes in
      `docs/develop/convex-workflow.mdx`, with a worked example.
- [x] Prepare the rollback runbook in `worktree-staging-qa.mdx`: verify the
      previous web deployment before instant rollback; restore previous function
      source through reviewed main history while retaining expanded schema.
      A feature checkout or obsolete schema is not a production rollback lane.
- [x] Provision the separate production QA identity and single-deployment
      Convex credential (expires 2027-01-10); store privately outside previews.
- [x] Perform application production smoke, live promotion and deliberate
      rollback with recorded deployment/alias readback; restore the accepted release
      and pass the complete production smoke again.

Done when: the owner promotes a SHA with one command and has rolled back once
on purpose as a drill.

## Phase 8 — Rewrite the process docs

Do this in the same PR as Phase 5/6 so docs never describe a lane that no
longer exists.

- [x] `AGENTS.md`: replace the Convex worktree-safety rule, staging direct-push
      authorisation, `main` direct-push authorisation, "main and staging may
      diverge", Integration agent, `dev:with-convex` and staging worktree rules
      with the target model. Keep the Vercel manual-production rule.
- [x] `docs/develop/agentic-development.mdx`: Builder-only model, preview
      verification, merge queue, `needs-staging`.
- [x] `docs/develop/worktree-staging-qa.mdx`: becomes "staging and production
      promotion" (staging-only checks, promotion script, rollback).
- [x] `docs/develop/convex-workflow.mdx`: preview / staging / prod deployments,
      deploy keys, seed function, expand/contract.
- [x] `docs/develop/BUILDER_AGENT_PROMPT.md`: preview evidence required.
      Retire or repurpose `INTEGRATION_AGENT_PROMPT.md` as a release-owner checklist.
- [x] Retain both owner-requested plan files and add
      `docs/develop/release-workflow.mdx` as the living operating contract, linked
      from the target plan and registered in the `AGENTS.md` documentation table.
- [x] `CHANGELOG.md`: operational entry for the new release process.

## Order and effort

| Phase | Depends on | Changes the release lane? | Rough size |
|---|---|---|---|
| 0 Prerequisites | — | No | 1 hour, owner |
| 1 Preview builds | 0 | No | Small |
| 2 Convex previews | 1 | No | Medium (seed function is most of it) |
| 3 Preview URLs + WorkOS | 1 | No | Medium (alias lifecycle automation and URL configuration) |
| 4 Agent test login | 2, 3 | No | Small |
| 5 On-demand main candidates | 2 | **Yes (cutover)** | Small code, careful dashboard work |
| 6 Merge queue + review | 5 | Yes | Small |
| 7 Promotion + rails | 5 | No | Medium |
| 8 Docs | 5, 6 | — | Medium |

## Risks

| Risk | Mitigation |
|---|---|
| A preview build gets a production secret | Production project keeps previews off; staging project's Preview scope holds only test-mode values; secret scan stays required. |
| Preview test login reachable outside previews | Triple condition plus a release-safety test that runs in CI. |
| Seed function runs against staging or prod | It refuses unless the Convex deployment says `OVERLAY_DEPLOYMENT_ENV=preview`. |
| Preview crons hit real third parties | Crons and outbound adapters no-op on previews. |
| Build volume and cost | PR-only builds; watch Vercel build minutes and Convex preview count for the first month. |
| An old deployment replaces a PR's latest alias | Serialize updates per PR, validate the current head SHA before assignment, and record the deployed SHA for QA. |
| OAuth returns to staging or a generated Vercel hostname | Set the canonical PR app URL before building and verify the full sign-in flow on its custom alias. |
| A closed PR leaves domains or URL overrides behind | Idempotent cleanup on close/merge, with reconciliation for missed lifecycle events. |
| Merge queue stalls because CI ignores `merge_group` | Add the trigger before enabling the queue. |
| Cutover confusion while agents follow old docs | Docs change in the same PR as the cutover; freeze the `staging` branch. |

## Rollback of the migration

- Phases 1–4: turn previews off in the staging project (or revert the guard
  change), disable alias provisioning, and remove per-PR aliases/domains and
  branch-scoped app URL overrides. Shared staging domains remain intact.
- Phase 5: set the staging project's production branch back to `staging` and
  unfreeze the branch.
- Phase 6: disable the merge-queue requirement in the ruleset.

Owner decision (2026-10-12): cut over when live isolation and staging smoke
checks pass; the planned one-to-two-week waiting period is waived.

Additional preparation (2026-10-12): Stripe test account
`acct_1SzOAWFmeUVgDzgI` now has a dedicated synthetic staging product, monthly
$1 unit price, $1 top-up unit price and a test billing portal configuration.
These earlier resources remain unused; the active LayerNorm test account,
shared test configuration and dedicated webhook are described below.
Following the owner's request to reuse `.env.local`, the shared Vercel Preview
settings and Convex preview defaults instead use the existing **LayerNorm sandbox**
credentials (`acct_1SyJ6jPH7ssnO0LI`) and its verified test prices. Corresponding
settings are configured on the dedicated staging Convex backend. All are readback
verified; the newly prepared resources in the other test account are unused.
Future PRs inherit these shared defaults; no per-PR provider-key setup is needed.
Only the canonical app URL and injected Convex identity vary per PR.

The file is a mixed configuration, not an importable dev-only bundle: its primary
Stripe key is live, its OpenRouter key matches production and its Convex URLs
point to shared development. Those values are excluded from the new defaults.
Separate test Gateway and OpenRouter keys are configured per preview/staging
lane. Both OpenRouter keys have no expiry and reject requests after $1 total use,
without a reset. Native key limits and shared environment readback
passed; Preview hosted-access settings are enabled for a fresh application QA
build. The customer production gate and legacy staging web scope are preserved.
Cloudflare browser and existing CLI login are refreshed under Divyansh. The
existing development S3 key remains restricted to `overlay-dev`. Separate lane
buckets and non-expiring Object Read & Write credentials are configured. Own-lane
write/read, cross-lane/shared-dev denial, browser image rendering, CORS isolation
and object cleanup passed on PR #194. Provider isolation is accepted; staging
publication still requires its own exact-revision authenticated smoke.

The PR rebuild probe found a legacy note `textContent` field masking accepted
`content` edits; the canonical text-update fix and regression coverage are
included before accepting the updated revision.

### Shared test credential lifetime (owner decision, 2026-10-13)

Shared Preview/staging credentials have no scheduled expiry: the project-scoped
Vercel controller token, deployment-scoped staging Convex key, separate Gateway
and OpenRouter lane keys, and bucket-restricted R2 credentials. Readback confirms
the new keys and shared defaults; existing PR #194 backend settings were also
updated. R2 keys passed write/read, cross-lane/shared-dev denial and cleanup checks.
Application chat and reload persistence passed. Authenticated upload/finalization, exact byte download and browser image
rendering passed at `6e076e318efe9a4715cabb9a8c46e46e1cba7269`. Use
`OVERLAY_PROVIDER_OBJECT_STORAGE=r2` and `STORAGE_PROVIDER=r2`; the similar
`OVERLAY_PROVIDER_STORAGE` name is ignored.

Keep the existing $1 total model limits without resets; increasing a depleted
limit does not require replacing the key. Store defaults once and inherit them
for future PRs. Remove owned PR aliases/resources when closed or merged. Convex
Starter managed previews still have its service-imposed five-day retention;
trusted reconciliation renews open PRs automatically and rebuilds expired backends.
Session JWT and presigned upload URL lifetimes remain short.

### Historical initial dedicated staging execution (2026-10-13)

PR #194 merged at `896b3803b0689d82a32cb5ea01a3f2dc25e5cc38`. The staging
project now permits controller REST sources in both scopes, with native Git
deployments blocked. A protected WorkOS API-key export was empty; it was restored
from the verified private Sandbox configuration. The latest candidate passed
Sandbox sign-in and fixture CRUD but exposed stale-note PATCH returning 500
because ordinary developer errors are redacted on a production-type Convex
backend. Structured application-error transport and regression checks are in
the cutover change. At this initial checkpoint no candidate had replaced canonical staging. Later accepted candidates and the current production drill are recorded above.

The dedicated Stripe test endpoint delivered a real test PaymentIntent event to
staging, recorded as processed. At that checkpoint checkout completion, canonical staging smoke, queue semantic verification and the production/rollback drill remained unverified. All passed subsequently; see current acceptance.


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
`6bb3e0d8294a955030e3c6b2f7ba7d353f6475d7`, after all nine combined checks
passed. Readback confirmed that the merge created no staging or customer
production deployment.

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


## 2026-10-14 automatic production policy

The owner authorized replacing manual-only production with automatic releases on
main changes. Production Release dispatches fresh exact-main Release Candidate
acceptance and then uses the existing guarded web-first promotion, production
Convex and authenticated smoke. Main-only production environment secrets and a
non-canceling production lock protect this lane. Root Git deployment remains
disabled to avoid an independent native Vercel build bypassing these checks.
Historical manual-only checkpoints above describe the migration at acceptance;
current operating instructions are in `docs/develop/worktree-staging-qa.mdx`.
