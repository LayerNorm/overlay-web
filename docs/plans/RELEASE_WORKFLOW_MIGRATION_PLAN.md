# Release workflow migration plan

Moves Overlay from direct pushes to `main` plus an optional branch-based staging
lane, using one shared dev Convex, to the target workflow in
[`RELEASE_WORKFLOW_TARGET.md`](RELEASE_WORKFLOW_TARGET.md): per-PR previews,
merge queue on `main`, staging deployed from `main`, manual production promotion.

## Approved preview-domain approach — 2026-10-12

Use ordinary wildcard custom domains plus automated per-PR aliases:
`https://pr-<number>.preview.getoverlay.io`. Do not buy or enable Vercel's native
Preview Deployment Suffix. The implementation includes DNS/HTTPS, canonical
OAuth origins, trusted alias automation, current-head SHA validation, and
idempotent cleanup. Normal platform usage costs and limits still apply.

Implementation begins with the preview foundations (Phases 1–4); cut over the
release lane only after their live acceptance checks pass. A separately scoped
Vercel CI credential is required for unattended domain and deployment control.

## Account preflight — verified 2026-10-12

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
and the preview-only QA login are implemented in the migration worktree.
Local full-suite, typecheck, build, lint, config, release-safety, boundary, docs,
and production-audit checks pass; the staged diff passes the secret scan. These are not yet a live, verified preview lane. Trusted PR alias provisioning/cleanup and merge-group CI support are also
implemented locally, with contract tests. Four blocking dependency advisories
were fixed and the production audit gate passes. Live alias/HTTPS/auth checks,
merge queue enablement, staging cutover, and production promotion remain open.
The Vercel CLI's app credential cannot create a CI token (API 403). The supported
token UI can scope a 90-day token to `overlay-web-staging`; creation and storage
as GitHub's `VERCEL_STAGING_TOKEN` are awaiting the browser-required action-time
confirmation.

Plan adjustments before implementation:

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

## Where we are today

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

- [ ] **Convex:** the plan includes preview deployments; note the maximum
      number and retention period.
- [ ] **Convex:** decide where staging lives. Options:
      (a) a separate Convex project `overlay-staging` whose production deployment
      is staging (recommended: clean isolation, its own deploy key);
      (b) keep the current shared dev deployment as staging and give each
      engineer their own dev deployment for local work.
- [x] **WorkOS:** confirm the staging environment accepts a wildcard redirect URI
      such as `https://*.preview.getoverlay.io/api/auth/callback`. Accepted,
      registered, and verified; no relay is needed for this pattern.
- [ ] **Vercel:** verify ordinary wildcard domains and custom alias permissions
      in the staging project, and check concurrent-build and domain/alias limits.
      Do not enable the paid Preview Deployment Suffix add-on.
- [x] **DNS:** confirm `getoverlay.io` already uses Vercel nameservers, which
      support the wildcard certificate. Phase 3 configures the preview domain.
- [x] **GitHub:** confirm merge queue is available for `LayerNorm/overlay-web`.

## Phase 1 — Preview builds in the staging project

Goal: every open PR gets a Vercel preview that builds and loads. It still talks
to the shared dev Convex backend; that changes in Phase 2.

Code:
- [ ] `scripts/vercel-ignore-build.sh`: when `VERCEL_ENV=preview` in the project
      with `PREVIEW_BUILDS=pr`, run the build only if `VERCEL_GIT_PULL_REQUEST_ID`
      is set (open PR); otherwise keep current fail-closed behaviour. Leave the
      production project's behaviour unchanged. Update the header comment.
- [ ] Add tests for the new guard branches next to the existing guard tests (or
      add a small shell test if none exist).

Dashboard (owner):
- [ ] `overlay-web-staging` → Environment Variables: tick **Preview** on every
      variable that holds a dev/test-mode value. Add `PREVIEW_BUILDS=pr` (Preview only).
- [ ] `overlay-web-staging` → Git: enable preview deployments for pull requests.
- [ ] Keep `overlay-landing` previews disabled.

Done when: opening a PR produces one preview in the staging project, none in the
production project, and pushes to branches without a PR build nothing.

Note: a push made before its PR is opened has no PR id; the first build happens
on the next push or via a redeploy. Document this for agents.

## Phase 2 — One Convex backend per preview

Goal: each preview runs against its own Convex preview deployment with seed data.

Code:
- [ ] `scripts/vercel-build.sh`: choose the build by `VERCEL_ENV`:
      - preview → `npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --preview-run dev/seed:init`
      - otherwise → current behaviour (`npm run build`), so prod and staging are untouched.
- [ ] `src/server/database/convex-url.ts`: when a preview build has a
      Convex-injected URL, use it instead of `DEV_NEXT_PUBLIC_CONVEX_URL`
      (e.g. a `CONVEX_PREVIEW=1` marker set by the build script). Extend
      `convex-url.test.ts` for preview, staging and production.
- [ ] `convex/dev/seed.ts`: an internal mutation `init` that creates test users
      matching the preview test login (Phase 4), a workspace, a conversation,
      notes, files and an automation. It must refuse to run unless the
      deployment is a preview (check a `OVERLAY_DEPLOYMENT_ENV=preview` Convex
      env var) so it can never touch staging or production.
- [ ] Crons and outbound side effects (`convex/crons.ts`, email, provider calls):
      skip when `OVERLAY_DEPLOYMENT_ENV=preview`, or route to no-op adapters.
- [ ] Automation callbacks: set the preview's app URL on its Convex backend
      during the build (`npx convex env set` against the preview), or disable
      callback-driven flows on previews and mark them staging-only.

Dashboard (owner):
- [ ] Convex → project settings → generate a **Preview Deploy Key**; add it in
      Vercel as `CONVEX_DEPLOY_KEY`, **Preview scope only**.
- [ ] Convex → default environment variables for preview deployments: WorkOS
      issuer/JWKS values for the staging environment, `INTERNAL_API_SECRET`,
      `INTERNAL_SERVICE_AUTH_SECRET` (matching the Vercel Preview values, and
      different from each other), `OVERLAY_DEPLOYMENT_ENV=preview`, and any
      test-mode provider keys Convex actions need.
- [ ] Vercel → `overlay-web-staging` → Build Command: `bash scripts/vercel-build.sh`.

Done when: two PRs that change the schema in incompatible ways both build and
work on their previews at the same time, and the shared dev deployment is untouched.

## Phase 3 — Stable preview URLs and WorkOS sign-in

Goal: real sign-in works at each PR's stable custom address, with no native
Preview Deployment Suffix purchase.

Code:
- [ ] Add trusted PR lifecycle automation. On open/reopen, derive
      `https://pr-<number>.preview.getoverlay.io` from the verified PR number,
      register the domain in the staging project, and set the source branch's
      Preview-scoped `NEXT_PUBLIC_APP_URL` override before requesting a build.
      Shared Preview secrets remain inherited; no manual per-PR configuration.
- [ ] On Preview deployment readiness, validate the staging project ID,
      environment, repository, branch, open PR, and current head SHA before
      assigning the custom address with `vercel alias set` or the equivalent
      Vercel API. Serialize alias updates per PR and reject stale deployments.
      Publish the canonical URL and deployed SHA for QA.
- [ ] On PR close/merge, remove its alias/domain and branch-scoped app URL
      override, handling missing resources idempotently. Keep the shared
      wildcard domain and WorkOS wildcard callback. Convex preview cleanup
      follows its configured retention policy. Reject unassigned and closed PR
      hostnames; removing an alias must not allow the shared wildcard to serve
      staging under that hostname. Add reconciliation for missed lifecycle events.
- [ ] Keep credential-bearing automation on trusted workflow code; do not
      execute PR code with domain-management credentials or automatically
      provision secret-bearing previews for outside contributors' forks.
- [ ] `src/server/web/app-url.ts`: use the configured canonical PR alias for
      `VERCEL_ENV=preview`, validating that it is an HTTPS
      `pr-<number>.preview.getoverlay.io` origin. Prevent fallback to staging or
      raw `VERCEL_BRANCH_URL`/`VERCEL_URL` for preview OAuth redirects. Add tests
      covering the alias, missing configuration, staging, and production.
- [ ] Ensure the build's `NEXT_PUBLIC_APP_URL`, server redirects
      (`workos-auth.ts` and `normalizeAuthRedirect`), browser links, and enabled
      Convex callbacks agree on the custom alias. Generated Vercel URLs are
      deployment identifiers, not the preview's canonical sign-in origin.
- [ ] Check CSP, CORS and allowed-origin lists (`npm run check:config`) accept
      `*.preview.getoverlay.io` on previews only.

Dashboard (owner):
- [ ] Add the ordinary wildcard domain `*.preview.getoverlay.io` to
      `overlay-web-staging`, configure its DNS in the existing Vercel zone, and
      verify HTTPS issuance. Leave the native Preview Deployment Suffix disabled.
- [ ] Provision scoped Vercel credentials to the trusted alias automation and
      retain existing deployment protection. QA uses an authorized login or
      scoped automation bypass where required.
- [x] WorkOS staging environment: add
      `https://*.preview.getoverlay.io/api/auth/callback` as a redirect URI.
- [ ] Add allowed origins/CORS only if the preview actually uses browser-side
      WorkOS API calls; server-side OAuth callbacks do not require this.

Done when: two open PRs have distinct `pr-<number>.preview.getoverlay.io` aliases,
valid HTTPS, and separate Convex data; a human can sign in with Google/email on
each. A subsequent push advances only that PR's alias to its current successful
SHA, a stale deployment cannot replace it, and closing the PR removes its domain
and app URL override; its former hostname cannot serve staging. The paid
Preview Deployment Suffix remains disabled.

## Phase 4 — Preview-only test login for agents

Goal: agents verify their own PRs end to end without real OAuth.

Code:
- [ ] `src/app/api/auth/preview-login/route.ts`: mints an `overlay_session` for
      a seeded test user. Returns 404 unless **all** of: `VERCEL_ENV=preview`,
      `OVERLAY_DEPLOYMENT_ENV=preview`, and a `PREVIEW_LOGIN_SECRET` header match.
      Add a release-safety test that fails if the route can respond in a
      production or staging configuration.
- [ ] Update `docs/develop/browser-testing-with-agent-browser.md` with the
      preview sign-in recipe.
- [ ] Update the Builder prompt: verify on the PR's preview and attach evidence.

Dashboard (owner):
- [ ] Vercel Preview scope: `PREVIEW_LOGIN_SECRET` (random, preview only). Give
      it to cloud agents through their secret store, not the repo.

Done when: an agent, given only the PR number, finds the preview URL, signs in,
and posts screenshots to the PR.

**Checkpoint:** previews are now fully usable. Run Phases 1–4 for a week or two
alongside the current staging flow before changing the release lane.

## Phase 5 — Staging deploys from `main`

Goal: staging always equals `main`. This is the cutover.

Code:
- [ ] Add a GitHub Action on pushes to `main` that requests a remote build of
      that exact SHA in `overlay-web-staging`, with scoped staging credentials
      and serialized deployments. Retain root `git.deploymentEnabled.main = false`:
      it applies to both connected projects, so changing the staging project's
      production branch alone cannot enable automatic builds. Record the web
      deployment, backend, and SHA together as promotion evidence.
- [ ] `scripts/vercel-build.sh`: in the staging project's production build,
      deploy the staging Convex backend first
      (`npx convex deploy --cmd 'npm run build'` with the staging deploy key),
      so staging web and Convex always come from the same commit.
- [ ] `convex-url.ts`: remove the `staging.getoverlay.io` host sniffing once
      staging sets `OVERLAY_DEPLOYMENT_ENV=staging` explicitly.
- [ ] Staging smoke tests: a GitHub Action on `deployment_status` for staging
      that runs a short Playwright suite (sign in, open chat, send a message,
      open notes) against `staging.getoverlay.io`.

Dashboard (owner):
- [ ] `overlay-web-staging` → Git → Production Branch: `main`;
      set `DEPLOY_BRANCH=main` and explicitly permit the authorized staging CI
      remote-build path. Keep unrelated refs and manual sources blocked.
- [ ] Convex staging (decision from Phase 0): create the deploy key and set it
      as `CONVEX_DEPLOY_KEY` in the staging project's **Production** scope.
- [ ] Freeze the `staging` branch: leave it in place (branch deletion is blocked
      by history rules) and restrict pushes, so nothing lands there by accident.

Done when: a merge to `main` produces a staging deployment of that SHA within
minutes, and the smoke suite reports on it.

## Phase 6 — Merge queue and review rules

Goal: parallel merges cannot break `main`.

Code:
- [ ] `.github/workflows/security.yml`: add `merge_group:` to `on:` (required —
      without it, queued PRs wait forever for checks). Drop `staging` from the
      push branches once Phase 5 is done.
- [ ] `.github/CODEOWNERS`: owners for `convex/schema.ts`, `convex/migrations/`,
      `src/server/auth/`, `src/app/api/auth/`, `src/server/billing/`,
      `src/app/api/webhooks/`, `vercel.json`, `scripts/vercel-*.sh`, `.github/`.
- [ ] `.github/pull_request_template.md`: change summary, preview evidence,
      `needs-staging` checkbox, schema-change checkbox (expand/contract confirmed).

Dashboard (owner):
- [ ] `main` ruleset: require merge queue; require CODEOWNERS review; keep
      required checks; keep force-push and deletion blocks.
- [ ] Remove the `DevelopedByDev` bypass once a second engineer joins (keep it
      only as an emergency break-glass, documented).
- [ ] Create the `needs-staging` label.

Done when: two PRs that conflict semantically (each green alone) cannot both
land; the second fails in the queue.

## Phase 7 — Production promotion and safety rails

Goal: promotion is boring and reversible.

Code:
- [ ] `scripts/release/promote.sh <sha>`: checks the SHA is on `main` and has a
      green staging smoke run, deploys prod web (`vercel deploy --prod` at that
      SHA, remote build), waits for it to be live, then runs `convex:push:prod`
      from a clean checkout of that SHA, then runs the production smoke suite.
      Keeps today's ordering rule: web first, Convex after.
- [ ] Feature flags: add a minimal flag helper (PostHog flags are already in the
      stack) so unfinished work can merge dark.
- [ ] Document expand/contract for Convex schema changes in
      `docs/develop/convex-workflow.mdx`, with a worked example.
- [ ] Rollback runbook: Vercel instant rollback for web; Convex rollback is
      "deploy the previous SHA's functions", safe because of expand/contract.

Done when: the owner promotes a SHA with one command and has rolled back once
on purpose as a drill.

## Phase 8 — Rewrite the process docs

Do this in the same PR as Phase 5/6 so docs never describe a lane that no
longer exists.

- [ ] `AGENTS.md`: replace the Convex worktree-safety rule, staging direct-push
      authorisation, `main` direct-push authorisation, "main and staging may
      diverge", Integration agent, `dev:with-convex` and staging worktree rules
      with the target model. Keep the Vercel manual-production rule.
- [ ] `docs/develop/agentic-development.mdx`: Builder-only model, preview
      verification, merge queue, `needs-staging`.
- [ ] `docs/develop/worktree-staging-qa.mdx`: becomes "staging and production
      promotion" (staging-only checks, promotion script, rollback).
- [ ] `docs/develop/convex-workflow.mdx`: preview / staging / prod deployments,
      deploy keys, seed function, expand/contract.
- [ ] `docs/develop/BUILDER_AGENT_PROMPT.md`: preview evidence required.
      Retire or repurpose `INTEGRATION_AGENT_PROMPT.md` as a release-owner checklist.
- [ ] Move `RELEASE_WORKFLOW_TARGET.md` into `docs/develop/` as the live process
      doc and add it to the `AGENTS.md` living-docs table.
- [ ] `CHANGELOG.md`: operational entry for the new release process.

## Order and effort

| Phase | Depends on | Changes the release lane? | Rough size |
|---|---|---|---|
| 0 Prerequisites | — | No | 1 hour, owner |
| 1 Preview builds | 0 | No | Small |
| 2 Convex previews | 1 | No | Medium (seed function is most of it) |
| 3 Preview URLs + WorkOS | 1 | No | Medium (alias lifecycle automation and URL configuration) |
| 4 Agent test login | 2, 3 | No | Small |
| 5 Staging from `main` | 2 | **Yes (cutover)** | Small code, careful dashboard work |
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
