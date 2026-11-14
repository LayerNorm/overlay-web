# Mockup reference rules

New mockups always go in this folder, without asking. Use the gitignored root
`artifacts/` folder only when the owner explicitly asks for it.

## Approved workspace structure

Use [agent-thread-activity.html](agent-thread-activity.html) as the canonical
workspace mockup. Its [React source](agent-thread-activity.tsx) imports the
production `DoubleSidebar` component, and its stylesheet imports
`src/app/double-sidebar.css`. Do not recreate the workspace shell from scratch.

Workspace mockups must strictly preserve:

- The 60px primary icon rail and resizable contextual sidebar (272px by default).
- The contextual title, search/add actions, and Personal/Workspace scope control.
- Agents and expandable nested threads inside that sidebar, never in tabs or a
  horizontal strip above the conversation.
- The production breadcrumb/header, framed main surface, transcript/composer
  proportions, semantic light/dark tokens, typography, and Overlay UI primitives.
- Existing docked detail-panel framing when that panel is shown.
- Sidebar/drawer navigation at narrow widths, not stacked resource tabs.

Only change the feature being proposed. Do not redesign navigation, branding,
spacing, or surrounding chrome incidentally. Compare rendered desktop and narrow
layouts in both themes against the canonical mockup and the current production
components before sharing.

Floating detail panels use the elevated semantic surface as a fallback when
rendered outside the sidebar's scoped shell variables, so they stay opaque in
both themes.

Production components and styles are the source of truth; the standalone
mockup's simulated task behavior is not a production contract.

## What else lives here

Mockups for shipped features are deleted once they land; Git history keeps
them. Besides the canonical workspace mockup, this folder holds only:

- `paid-first.html` (built by `build-paid-first.mjs`): the approved onboarding
  design for the in-progress `PAID_FIRST_EXECUTION_PLAN.md`. Delete it when
  that plan completes.
- Brand source: `build-aligned-brand.py` generates `aligned-brand.*`,
  `overlay-brand-approved/` and the production `ApprovedBrand.tsx`;
  `export-brand-pngs.cjs` exports the raster assets. These are production
  source, not mockups.

Add new mockups here and remove them when their feature ships.

## Rebuild the canonical preview

With the repository's React, Radix, Lucide, Sonner, esbuild, PostCSS and Tailwind
dependencies installed:

```sh
node internal/plans/mockups/build-agent-thread-activity.cjs
```

The output is a self-contained HTML file. Open it directly in a browser; it
does not require authentication, live services, or production mutations.
