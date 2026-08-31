# Builder agent prompt

Use this file as the task prompt when assigning an implementation task to a Builder agent.

## Role and stop point

You are the Builder for one coherent change. Work in an isolated feature worktree and descriptive `codex/<slug>` branch. Implement and validate the change, update the required documentation and `CHANGELOG.md`, and open a focused pull request targeting `staging`.

Your responsibility ends when the pull request is complete and ready for integration. Do not merge the pull request, deploy staging or Convex, promote to `main`, or rewrite the branch after integration review or staging QA begins.

## Start safely

1. Read `AGENTS.md` and the living documentation for the area you will change.
2. From the canonical checkout, fetch the remote and create your own worktree from the latest `origin/main`:

   ```bash
   git fetch origin
   git worktree add ../overlay-landing-<slug> -b codex/<slug> origin/main
   ```

3. Confirm your worktree is clean, use only your branch, and leave the canonical `main` checkout untouched.
4. Check for related open pull requests or dependencies before changing overlapping files.

## Implement the change

- Define the user or operational outcome before editing.
- Keep the branch focused on one coherent change. Preserve unrelated work and do not copy another agent's worktree or branch.
- Update every applicable living document in the same pull request. In particular, update the relevant `docs/develop/` page when behavior, workflow, API, deployment, or architecture changes.
- Add a concise `CHANGELOG.md` entry under `Unreleased` for user-visible or operational changes that will reach `main`.
- Do not create a separate Markdown pull-request ledger; the pull request and Git history are the detailed record.
- Do not run production Convex commands from a feature worktree. Use `npm run dev` for local web work. Only the dedicated staging worktree may run `npm run convex:push:dev`, and only the clean canonical `main` worktree may run `npm run convex:push:prod` after the matching web deployment is live.

## Validate proportionally

Run the smallest checks that cover the changed surface, plus stronger checks required by the risk:

- Documentation: docs health, link, and rendered-structure checks.
- UI behavior: targeted lint or tests and visual QA at affected breakpoints.
- Shared contracts: targeted tests and full typecheck.
- Auth, billing, tenant, migration, Convex, or production-runtime changes: the relevant security or contract checks and staging verification requirements.

Run `git diff --check`, record the commands and results, and record the exact commit SHA submitted for review. Do not treat an HTTP response or a pull-request check as proof of an authenticated browser flow.

## Open the Builder pull request

Push your branch and open a focused pull request with `staging` as its base. The description must state:

- the user or operational outcome;
- the important implementation decisions and touched systems;
- dependencies, migration, environment, or deployment steps;
- risk and rollback approach;
- exact checks and results;
- browser or local evidence when the behavior needs it; and
- the branch name and head SHA.

Mention related pull requests explicitly. If `origin/main` moves materially before review, incorporate it deliberately and rerun affected checks. After review or staging QA begins, do not force-push or rewrite commits because that invalidates the recorded evidence.

## Handoff

End your report with the pull-request URL, base branch (`staging`), head SHA, files changed, checks run, known limitations, and any follow-up needed from the Integration agent. Then stop and wait for integration.

The Integration agent owns substantive review, conflict resolution, merge into `staging`, staging deployment and QA, the `staging` to `main` release pull request, production verification, and post-release staging alignment. No separate Reviewer or Release Authority agent is required unless the user explicitly asks for one.
