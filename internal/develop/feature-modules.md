---
title: "Adding Feature Modules"
description: "Package boundaries, module checklist, and settings panel registration."
---
Feature modules should keep behavior reusable without coupling presentational UI to the web runtime.

## Package Boundaries

- `@overlay/app-core`: shared contracts, app shell registries, and renderless controller helpers.
- `@overlay/api-client`: typed transport wrappers for the web `/api/v1/*` routes.
- `@overlay/ui`: low-level primitives and design tokens.
- `@overlay/modules-react`: React DOM presentational components for feature modules.
- `src/features/<domain>/*`: web containers and feature-local helpers that bind routing, auth, Convex-backed APIs, uploads, billing, and local browser APIs.
- `src/components/{ui,layout,providers}/*`: shared UI primitives, app chrome, and runtime providers.

Presentational components must accept data and callbacks only. They must not import `fetch`, `next/navigation`, auth contexts, Convex, or `overlayAppClient`. Run `npm run check:module-boundaries` before committing module package changes.

## Module Checklist

1. Add cross-surface contracts to `@overlay/app-core`.
2. Add typed methods to `@overlay/api-client` that call existing `/api/v1/*` routes without changing endpoint behavior.
3. Put pure selection, filtering, sorting, dirty-state, and tree-building logic in `@overlay/app-core/modules`.
4. Put React DOM presentation in `@overlay/modules-react`, built from `@overlay/ui`.
5. Keep the web screen as a container that wires router, auth, upload flows, billing, local storage, and client methods into the shared module.
6. Add Storybook stories that import public package APIs only.

## Primary navigation items

Primary rail items come from `DEFAULT_OVERLAY_NAVIGATION` in `@overlay/app-core/app-shell`. An item can require a
runtime capability (`requiredCapabilities`), which hides it from the rail, the mobile drawer, and the Alt+1 to Alt+6
shortcuts (they index the visible items). **Work** is the first item, above Agents, and requires the `work`
capability (`OVERLAY_FEATURE_WORK`); Alt+1 is Work when it is on, and the other sections move down one. Its secondary
panel is navigation only (`SecondaryPanelKind` `work`, not a resource list): Personal and Workspace, each with
List, Board, and Timeline beneath, kept in the URL as `?scope=` and `?view=`.

The default brand `homeHref`, authenticated root/app entry and ordinary web auth returns point to `/app/work`. Explicit white-label `homeHref` overrides and explicit Account/desktop auth returns remain intact. The destination stays static for the prerendered shell: `OVERLAY_FEATURE_WORK=0` shows the Work-unavailable notice with an Agents link, and missing `work.use` permission retains the existing access-denied boundary.

## Settings Panels

Register panel metadata in `src/overlay.config.ts`:

```ts
settingsPanels: [
  {
    id: 'security',
    sectionId: 'account',
    label: 'Security',
    componentKey: 'acme.settings.security',
    order: 25,
  },
]
```

Then map `componentKey` to a local renderer in the web settings container. Other surfaces can reuse the registry metadata and provide their own renderer for the same key.

Capability gates should match the panel's direct function. The built-in Memories section and panel require `memory`, while semantic retrieval and the knowledge-search tool separately require `vectorSearch`. This keeps memory CRUD reachable in deployments that intentionally disable vector search.

The Memories web container is workspace-aware: its single member filter contains `All` plus active human members, defaults to `All`, and renders creator attribution supplied by the memory API. Do not infer attribution client-side from the signed-in user.

## Extending UI Primitives

Prefer composition over editing existing primitives. Add a new primitive to `@overlay/ui` only when it is broadly reusable and can preserve the current visual language. Feature-specific surfaces belong in `@overlay/modules-react`.
