---
title: "Preview and Production QA"
description: "Isolated PR previews and native Git production releases."
---

The current release contract is [Development Workflow](./Development%20Workflow.md)
and [Release Workflow](./release-workflow.md). This page records the
operational checks. The former staging project, branch, and subdomain are not
part of the release path. Historical staging drills are preserved in
`internal/plans/release-workflow-evidence/` and git history.

## PR preview

1. Open an internal PR against `main` and add `needs-preview` when hosted QA is
   required under Development Workflow. Automatic non-main Git builds are disabled.
   The trusted main controller requests the exact SHA through REST API using the
   existing project token, then manages its URL/backend. Unlabeled PRs pass
   “Preview not requested” and still require normal CI.
2. Use `https://pr-<number>.preview.getoverlay.io`. The controller assigns
   the alias only after the deployment is READY at the current PR head SHA and
   its `preview/pr-<number>` Convex backend exists. The wildcard registration
   branch `codex/preview-unassigned` has no deployment alias.
3. Preview values are scoped separately from Production. Use the shared test
   WorkOS, Stripe, model, email, and R2 settings. Never copy `.env.local`
   wholesale or use customer Production values in a PR preview.
4. Exercise the affected interaction in the browser, including sensitive
   flows when requested. Check authentication, persistence, expected error
   states, relevant permissions, and network failures. Record the tested SHA.
5. Removing `needs-preview` or closing the PR settles builds and removes the owned alias, domain, and branch app URL. The
   isolated Convex backend and its synthetic data are deleted with ownership and
   absence checks. Six-hour reconciliation also cleans retained closed/unlabeled
   PR backends. Re-adding the label creates a fresh backend and fixtures.
   Closed and unknown preview hosts must return HTTPS 404.

Shared Preview defaults combine paid, Computer and exhausted fixtures. The
`computer-workspace` fixture creates a separate Computer QA workspace with an
initial $5 synthetic wallet; the seed allocates no machine. Existing balances,
holds, memberships and plan changes survive rebuilding. Use the trusted Preview
QA Recovery workflow for an explicit refill rather than creating another deploy
key. The real provider cap remains independent of synthetic credit.

Keep Personal free for negative admission checks and use Computer QA for funded
lifecycle tests. Use the existing restricted Preview Boat credential, allocate
one disposable machine at a time, and verify stop/delete and metering cleanup.
The $1 paid layout fixture is below the default cloud startup floor.

## Production

1. Cloud Builder PRs enter the main merge queue after checks and proportionate
   Preview QA. Local agents under the authorized `DevelopedByDev` owner identity
   may fast-forward push reviewed work directly to main.
2. Vercel's native Git integration automatically deploys `main` to Production
   in `overlay-landing`. Confirm the exact live Git SHA and READY deployment.
   Root `vercel.json` keeps `git.deploymentEnabled.main=true`.
3. If the release changes Convex functions, schema, imported shared code or
   runtime dependencies, deploy customer Convex `colorful-chickadee-419` only
   from a clean current canonical main checkout after matching web is live.
   Frontend-only releases require no backend push.
4. Run proportionate authenticated Production smoke. Check the changed flow,
   session continuity and relevant backend operation; record the deployed SHA
   and result. A READY Vercel build alone is not application QA.
5. Use Vercel deployment history for authorized web rollback. Check web and
   backend compatibility before any rollback that spans a backend change.

Do not recreate a GitHub Actions/CLI/REST Production deployer or a Production
Vercel token. Production Git deployment and Preview alias automation are
separate mechanisms.
