# Development and release workflow target

Current policy, 2026-10-14. [Development Workflow](../develop/Development%20Workflow.md)
is authoritative. Historical migration drills remain in
[Release workflow migration plan](RELEASE_WORKFLOW_MIGRATION_PLAN.md).

## Environments

| Environment | Source and hostname | Backend and providers |
| --- | --- | --- |
| Local | Engineer working tree, localhost | Engineer-owned Convex dev backend and test credentials |
| PR Preview | Internal main PR head, `pr-<number>.preview.getoverlay.io` | Per-PR `preview/pr-<number>` Convex and shared sandbox providers |
| Production | Native Git deployment of main, `www.getoverlay.io` | Customer Convex `colorful-chickadee-419` and live providers |

Both hosted environments belong to Vercel `overlay-landing`. The old staging
project, branch, and subdomain are being retired; see the migration checkpoint
for live cutover progress. Sensitive changes use expanded QA on the same PR
preview. There is no staging release gate or staging-to-main promotion.

## Builder and Integration

1. Builder owns one feature worktree from current main and runs focused checks.
2. Open a draft main PR. Vercel Git builds its Preview; the trusted main
   controller validates the exact head, assigns the custom URL, and renews its
   isolated backend. Test the feature in the browser and attach the tested SHA.
3. Mark the PR ready and stop. Integration reviews evidence and code, resolves
   findings, and enqueues it. The merge queue checks combined revisions.
4. Main automatically deploys to Production via Vercel Git. Integration verifies
   the exact live SHA and runs proportionate authenticated smoke. Synchronize
   customer Convex only for backend changes, from clean current canonical main,
   after matching web is live.

Local laptop agents acting as `DevelopedByDev` have owner authorization to push
reviewed work directly to main using fast-forward pushes, preserving unrelated
edits. Cloud Builders use PRs and the merge queue. Never force-push main.

## Preview implementation

- Enable Git deployment sources for Preview and Production. Keep
  `git.deploymentEnabled.main=true`; do not create a custom Production deployer.
- Use ordinary custom aliases, without purchasing Preview Deployment Suffix.
  Reserve `codex/preview-unassigned` only for wildcard certificate registration;
  it must never have a fallback deployment alias.
- The non-expiring project-scoped `VERCEL_PREVIEW_TOKEN` lives in GitHub's
  `release-control` environment. It automates branch app URLs, domains, aliases
  and cleanup; native Git starts builds. The rule and token serve these separate
  functions. No Production deployment token is required.
- Preview and Production environment variable targets stay separate. Configure
  shared sandbox WorkOS, test Stripe, bounded test models, and isolated R2 once
  in Preview. Never copy `.env.local` wholesale. Shared credentials have no
  scheduled expiry; usage budgets still apply.
- The build wrapper accepts only internal PR metadata and an explicitly scoped
  Convex preview key. Reuse `pr-<number>` backends between pushes without
  destructive recreation. The compatibility lane value `staging` is accepted
  by old PR heads only within Vercel Preview; it does not require staging.
- Renew open PR backends every six hours within Convex retention limits. If a
  backend already expired, push a new PR revision for a fresh Git build.
- Closure removes the owned alias, domain, and branch app URL; backend renewal
  stops. Unknown and closed hosts must return HTTPS 404.
- Docs/GitHub-only PRs may be exempted from hosted app QA. Use `needs-preview`
  when a real app preview is required.

## Acceptance and recovery

Verify preview SHA, canonical HTTPS, sandbox login, tenant-bound application
access, provider isolation and closure cleanup. Test sensitive features using
test providers and synthetic data. A READY build alone is not feature QA.

Verify exact main SHA on Production and affected authenticated behavior after
each release. Use Vercel deployment history for authorized web rollback; check
compatibility with the retained backend first. Production Convex must never
receive `.env.local`, feature-worktree source, or a shared dev deploy command.
