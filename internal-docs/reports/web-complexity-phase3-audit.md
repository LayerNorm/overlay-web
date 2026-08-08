# Phase 3 Complexity Audit

**Date:** 2026-08-08

**Scope:** First controlled simplification slice for the workspace domain. The change is intentionally additive and contract-preserving: it reduces concentrated UI/repository complexity without changing routes, schema, provider selection, feature flags, or workspace behavior.

## Changes

### Workspace switcher seam

- `WorkspaceSwitcher.tsx` now owns browser state, outside-click/escape handling, workspace navigation, and create/switch orchestration.
- `WorkspaceSwitcherView.tsx` owns the trigger, menu/list, portal positioning surface, and create dialog composition.
- The existing `rootRef`/`menuRef` containment behavior is preserved for both inline and portal menus. Workspace URL construction, resource-selector clearing, showcase query handling, account-menu placement, and create-workspace navigation remain in the controller.

### Postgres governance seam

- `PostgresWorkspaceRepository#setSharingPolicy` now delegates SQL construction to `workspace-sharing-policy-sql.ts`.
- Insert defaults, patch-preserves-stored-value behavior, explicit null resets, array typing, timestamps, and the existing aliased `RETURNING` projection remain unchanged.
- The repository contract and `WorkspaceSharingPolicy` response shape are unchanged.

## Complexity evidence

| Metric | Phase 3 starting baseline | Phase 3 baseline | Change |
| --- | ---: | ---: | ---: |
| Complex functions over 25 | 59 | 57 | -2 |
| Large production files over 500 LOC | 56 | 56 | 0 |
| Route handlers over 250 LOC | 8 | 8 | 0 |
| Exact duplicate groups | 0 | 0 | 0 |

The two removed complexity exceptions are `WorkspaceSwitcher#WorkspaceSwitcher` and `PostgresWorkspaceRepository#setSharingPolicy`. The new view and SQL helper functions are all below the complexity threshold, and `npm run check:web-complexity` passes without adding a baseline exception.

## Verification

- `npm run typecheck` — pass, including shared boundary and public-showcase checks.
- Targeted ESLint for the controller, view, repository, and SQL helper — pass.
- `npm run check:web-complexity` — pass with the reduced baseline.
- `npm run check:module-boundaries` — unchanged architecture guard remains available for the phase gate.
- `npm run docs:health` — pass after recording the new decomposition seam.
- `npm run test:route-characterization` — pass, 69/69.
- Fixture-environment production build — pass with `INTERNAL_API_SECRET`, fixture Convex URL, and test deployment environment.

## Follow-up seams

The next Phase 3 PRs should extract WorkspaceService membership/invitations and teams/governance/resource scopes behind narrow repository interfaces. Each extraction should preserve the current endpoint contracts and add a focused contract test before removing its baseline exception.
