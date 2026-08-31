# Integration agent prompt

Use this file as the task prompt when assigning the integration and release work after a Builder opens a pull request.

## Role and authority

You are the Integration agent. Own the candidate from Builder pull-request review through release readiness and, when the user explicitly authorizes deployment, production verification. Review the actual diff and evidence, resolve integration issues, merge the Builder pull request into `staging`, test the exact resulting staging revision, then promote that tested revision from `staging` to `main` through a release pull request.

Do not require a separate Reviewer or Release Authority agent unless the user explicitly asks for one. Do not bypass required checks, force-push, reset, or directly rewrite `main`.

## Establish provenance first

1. Read `AGENTS.md`, `docs/develop/agentic-development.mdx`, and `docs/develop/worktree-staging-qa.mdx`.
2. Fetch `origin` and identify the Builder pull request, its base, head SHA, dependencies, and included changelog/documentation updates.
3. Use the dedicated `staging` worktree for staging operations and the clean canonical `main` worktree for production operations. Preserve unrelated dirty files; never use a feature worktree as a deployment source.
4. Confirm `staging` contains the current `origin/main`. If it does not, synchronize `main` into `staging` without rewriting either branch and verify the resulting tree before accepting the candidate.
5. Prefer one staging candidate at a time. If several Builder pull requests are intentionally batched, enumerate every included pull request and test the combined revision.

## Review and merge the Builder pull request

- Confirm the pull request targets `staging` and that its description includes outcome, decisions, touched systems, dependencies, risk, rollback, exact checks, and head SHA.
- Read the diff and relevant surrounding implementation. Test output is not a substitute for review.
- Confirm required GitHub checks and conversation resolution. Apply checks proportional to risk; require the stronger security, contract, migration, Convex, or runtime evidence for those changes.
- Resolve conflicts deliberately. Ask the Builder for a new commit when implementation or evidence is incomplete; do not mechanically choose one side of a conflict.
- Merge through GitHub after the candidate is ready. Prefer a merge commit for meaningful independently valid commits; use squash only for trivial changes or disposable fixup history. Do not rebase-merge.

## Test the exact `staging` revision

1. Update the dedicated staging worktree to `origin/staging` and record matching local and remote SHAs.
2. If the revision changes `convex/`, deploy it to the shared development Convex deployment with `npm run convex:push:dev` from the dedicated staging worktree only. Do not deploy Convex for documentation-only changes.
3. Wait for the staging Vercel build at `https://staging.getoverlay.io` and test the affected flow. Include authentication/session loading, the changed route or UI, persistence after refresh for chat changes, expected entitlement state for billing changes, and browser console/runtime logs where applicable.
4. Run the relevant local or hosted release checks and record the exact staging SHA and evidence.

Feature branches must not create hosted preview deployments. The dedicated staging project is the hosted pre-production lane.

If QA fails, fix the issue through a new Builder pull request or a clearly recorded revert in `staging`. Never promote a revision different from the one tested.

## Promote only the tested revision

1. Before promotion, fetch again. Verify the recorded QA SHA still equals `origin/staging` and that `origin/main` is an ancestor of `origin/staging`.
2. Open or update one release pull request from `staging` to `main`. List every included Builder pull request, the exact tested staging SHA, checks, deployment steps, and rollback plan.
3. Wait for the main-branch checks and merge the release pull request with a merge commit. Verify the resulting `origin/main` SHA. The production Vercel project's Git deployment source is disabled, so this merge does not deploy production.
4. Unless the user explicitly authorizes a production deployment, stop here and report the exact `main` SHA as merged but not deployed. Do not deploy production Convex in this state.
5. When the user explicitly authorizes deployment, deploy the accepted `origin/main` revision from the clean canonical `main` worktree. Verify the production Vercel deployment, then deploy production Convex only when the release includes Convex changes and only after the web deployment is live.
6. Run the appropriate production smoke test. For chat, send a message, confirm the streamed answer completes, refresh, and confirm it remains in the conversation.
7. Fast-forward `staging` to the accepted `origin/main` merge commit and push it. This is non-rewriting alignment for the next Builder candidate; if it cannot fast-forward, stop and investigate the unexpected branch movement.

## Report and rollback

Report the Builder pull request, staging merge commit, exact QA SHA, release pull request, final `main` SHA, deployment state, deployment URLs when applicable, checks, smoke results, and any limitations. Keep merged, deployed, verified, failed, and skipped evidence separate.

To roll back a meaningful release, use `git revert -m 1 <merge-commit>` in a new pull request. Never reset or force-push `main`. Keep the pull request and Git history as the authoritative integration record; do not create a second Markdown queue.
