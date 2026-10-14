# Contributing to Overlay

Thank you for helping improve Overlay. Small, focused pull requests with clear tests are the easiest to review and release safely.

## Before You Start

- Use Node.js 22 or newer and npm 11.11.0.
- Read the relevant guide under `internal/develop/` before changing an architectural area.
- Follow `docs/develop/agentic-development.mdx` for worktrees, branch ownership, pull requests, commit history, and integration.
- Use [`BUILDER_AGENT_PROMPT.md`](internal/develop/BUILDER_AGENT_PROMPT.md) when assigning implementation work and [`INTEGRATION_AGENT_PROMPT.md`](internal/develop/INTEGRATION_AGENT_PROMPT.md) when assigning review, staging QA, and promotion.
- Never include production credentials, customer data, or copied authentication state.
- Report security issues privately through the process in `SECURITY.md`.

## Development

```bash
npm ci --ignore-scripts
cp .env.example .env.local
npm run dev
```

Use placeholders for local secrets. Feature worktrees use personal dev backends; hosted PR builds deploy only their isolated preview backend. Manually dispatched main release-candidate CI deploys its dedicated backend. Only clean canonical main may deploy customer production Convex after matching production web is live. See `docs/develop/worktree-staging-qa.mdx`.

## Pull Requests

1. Create a focused branch from the latest `main`.
2. Open a draft Builder PR against main and verify its current-head isolated preview. The legacy staging branch is frozen.
3. Update the relevant living documentation in the same pull request.
4. Run the smallest checks that cover the change, plus `npm run typecheck` for cross-contract changes.
5. Explain user-visible behavior, security or billing impact, and rollback considerations.
6. Hand the ready PR and current-head evidence to Integration for review and merge queue entry. When preparing a release, manually dispatch the exact-main candidate; production remains a separate owner-authorized promotion of that verified SHA. Use `needs-staging` for stronger staging QA without changing PR base.

Meaningful, independently valid commits are merged with a merge commit so their identities and the pull-request boundary remain available for targeted reverts. Squash merging is reserved for trivial changes or noisy fixup history. Rebase merging is not used. User-visible and operational pull requests must also update `CHANGELOG.md` under `Unreleased`.

The main release gate is the `Security Checks` workflow. Useful local checks include:

```bash
npm run lint
npm run check:web-complexity
npm run typecheck
npm run test:release-safety
npm run check:tenant-boundaries
npm run security:audit
```

## Licensing

All first-party material stored directly in this repository is `AGPL-3.0-only`. Run `npm run license:check` when dependencies or package boundaries change. See `LICENSE`, `docs/legal/licensing.mdx`, and `NOTICE.md`.

LayerNorm uses a Contributor License Agreement because accepted contributions may also be distributed under paid commercial licenses. The draft is in `CLA.md`. Outside contributors must sign by commenting `I have read the CLA Document and I hereby sign the CLA` on the pull request; the `CLA Signatures` workflow records identity, CLA version, timestamp, repository, and pull request. A checkbox is not a signature. **Do not merge outside contributions until that check is green.** The CLA text is still a draft until counsel finalizes governing-law and entity-signing terms; founder commits from `DevelopedByDev` are allowlisted.

Contributors retain copyright and attribution while granting the copyright and patent rights described in the CLA. Do not submit code owned by an employer or client without written authorization, and identify all third-party material.
