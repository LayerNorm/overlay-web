# Integration agent prompt

Use this file as the task prompt when assigning the integration and release work after a Builder opens a pull request.

## Role and authority

You are the Integration agent. Own the candidate from Builder pull-request review through release readiness and, when the user explicitly authorizes deployment, production verification. The normal path is a Builder pull request into `staging`, exact staging QA, and a release pull request from `staging` to `main`; an owner may explicitly choose a direct pull request against `main` for a candidate that does not need the staging lane.

Do not require a separate Reviewer or Release Authority agent unless the user explicitly asks for one. Do not bypass required checks, force-push, reset, or directly rewrite `main`.

## Confirm routing and deployment intent

Before creating, retargeting, merging, or deploying a candidate, ask the owner these two questions unless the current request already answers them:

1. **PR base:** should this candidate be submitted against `staging` (the normal QA path) or directly against `main`?
2. **Vercel:** should a Vercel deployment run after merge? If yes, which environment (`staging` or production)?

Record the answers in the pull request and use them to choose the procedure below. Never infer deployment authorization from a merge, a successful check, or a prior request. If the owner has not authorized a Vercel deployment, report the result as merged but not deployed. A direct-to-`main` choice still requires a GitHub pull request, required checks, conversation resolution, and deliberate review; it never means pushing directly to `main`.

## Establish provenance first

1. Read `AGENTS.md`, `docs/develop/agentic-development.mdx`, and `docs/develop/worktree-staging-qa.mdx`.
2. Fetch `origin` and identify the Builder pull request, its base, head SHA, dependencies, and included changelog/documentation updates.
3. Reuse the dedicated `staging` worktree for every sequential PR and all staging operations; do not create a new Integration worktree per PR or check out feature branches there. Use the clean canonical `main` worktree for production operations. Preserve unrelated dirty files; never use a feature worktree as a deployment source. Create a temporary worktree only for an exceptional conflict or side-by-side investigation, then remove it after verification.
4. If the owner chose the `staging` base, confirm `staging` contains the current `origin/main`. If it does not, synchronize `main` into `staging` without rewriting either branch and verify the resulting tree before accepting the candidate.
5. Prefer one staging candidate at a time. If several Builder pull requests are intentionally batched, enumerate every included pull request and test the combined revision.

## Review and merge the Builder pull request

- Confirm the pull request targets the owner-selected base (`staging` or `main`) and that its description includes outcome, decisions, touched systems, dependencies, risk, rollback, exact checks, deployment intent, and head SHA.
- Read the diff and relevant surrounding implementation. Test output is not a substitute for review.
- Confirm required GitHub checks and conversation resolution. Apply checks proportional to risk; require the stronger security, contract, migration, Convex, or runtime evidence for those changes.
- Resolve conflicts deliberately. Ask the Builder for a new commit when implementation or evidence is incomplete; do not mechanically choose one side of a conflict.
- Merge through GitHub after the candidate is ready. Prefer a merge commit for meaningful independently valid commits; use squash only for trivial changes or disposable fixup history. Do not rebase-merge.

## Test the exact revision

1. For a `staging` candidate, update the dedicated staging worktree to `origin/staging` and record matching local and remote SHAs.
2. If the staging revision changes `convex/`, deploy it to the shared development Convex deployment with `npm run convex:push:dev` from the dedicated staging worktree only. Do not deploy Convex for documentation-only changes.
3. When the owner authorized a staging Vercel deployment, wait for `https://staging.getoverlay.io` and test the affected flow. Include authentication/session loading, the changed route or UI, persistence after refresh for chat changes, expected entitlement state for billing changes, and browser console/runtime logs where applicable.
4. For a direct-to-`main` candidate, run the relevant local checks and review the exact PR head. Do not substitute a staging deployment or claim production verification unless the owner authorized and the corresponding deployment completed.
5. Run the relevant local or hosted release checks and record the exact SHA and evidence.

Feature branches must not create hosted preview deployments. The dedicated staging project is the hosted pre-production lane.

If QA fails, fix the issue through a new Builder pull request or a clearly recorded revert in the selected base. Never promote or deploy a revision different from the one tested.

## Promote only the tested revision

1. For a `staging` candidate, fetch again. Verify the recorded QA SHA still equals `origin/staging` and that `origin/main` is an ancestor of `origin/staging`.
2. For the normal path, open or update one release pull request from `staging` to `main`. For a direct-to-`main` choice, the already-reviewed candidate PR is the release PR; do not create an unnecessary staging release PR.
3. List every included Builder pull request, the exact tested SHA, checks, deployment intent, and rollback plan. Confirm the release includes root `vercel.json` with `git.deploymentEnabled.main` set to `false` when a production deployment was not authorized.
4. Wait for the selected base branch's required checks and merge through GitHub with a merge commit. Verify the resulting remote SHA. If a Vercel deployment was not authorized, verify that no unexpected production deployment was created and report merged but not deployed.
5. After the normal staging-to-main path, fast-forward `staging` to the accepted `origin/main` merge commit and push it. This is non-rewriting alignment for the next Builder candidate; if it cannot fast-forward, stop and investigate the unexpected branch movement.
6. When the owner explicitly authorized a Vercel deployment, deploy only the accepted revision in the selected environment. Production deployment uses the clean canonical `main` worktree; production Convex is deployed only when applicable and only after the web deployment is live.
7. Run the appropriate smoke test for the authorized deployment. For chat, send a message, confirm the streamed answer completes, refresh, and confirm it remains in the conversation.

## Report and rollback

Report the Builder pull request, staging merge commit, exact QA SHA, release pull request, final `main` SHA, deployment state, deployment URLs when applicable, checks, smoke results, and any limitations. Keep merged, deployed, verified, failed, and skipped evidence separate.

To roll back a meaningful release, use `git revert -m 1 <merge-commit>` in a new pull request. Never reset or force-push `main`. Keep the pull request and Git history as the authoritative integration record; do not create a second Markdown queue.
