# Contributing to Overlay

Thank you for helping improve Overlay. Small, focused pull requests with clear tests are the easiest to review and release safely.

## Before You Start

- Use Node.js 22 or newer and npm 11.11.0.
- Read the relevant guide under `docs/develop/` before changing an architectural area.
- Never include production credentials, customer data, or copied authentication state.
- Report security issues privately through the process in `SECURITY.md`.

## Development

```bash
npm ci --ignore-scripts
cp .env.example .env.local
npm run dev
```

Use placeholders for local secrets. Feature worktrees must not deploy Convex. The dedicated staging worktree may run `npm run convex:push:dev`; only the clean canonical `main` worktree may run `npm run convex:push:prod` after the matching web deployment is live. See `docs/develop/worktree-staging-qa.mdx`.

## Pull Requests

1. Create a focused branch from the latest `main`.
2. Update the relevant living documentation in the same pull request.
3. Run the smallest checks that cover the change, plus `npm run typecheck` for cross-contract changes.
4. Explain user-visible behavior, security or billing impact, and rollback considerations.
5. Wait for required GitHub checks before merging.

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

All first-party material stored directly in this repository is `AGPL-3.0-only`. Run `npm run license:check` when dependencies or package boundaries change. See `LICENSE`, `LICENSE.md`, and `NOTICE.md`.

LayerNorm uses a Contributor License Agreement because accepted contributions may also be distributed under paid commercial licenses. The draft is in `CLA.md`. Outside contributors must sign by commenting `I have read the CLA Document and I hereby sign the CLA` on the pull request; the `CLA Signatures` workflow records identity, CLA version, timestamp, repository, and pull request. A checkbox is not a signature. **Do not merge outside contributions until that check is green.** The CLA text is still a draft until counsel finalizes governing-law and entity-signing terms; founder commits from `DevelopedByDev` are allowlisted.

Contributors retain copyright and attribution while granting the copyright and patent rights described in the CLA. Do not submit code owned by an employer or client without written authorization, and identify all third-party material.
