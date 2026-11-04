# Mockup reference rules

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

[double-sidebar-bordered-mockup.html](double-sidebar-bordered-mockup.html)
remains a supporting reference for the framed main/right-panel arrangement.
Floating detail panels use the elevated semantic surface as a fallback when
rendered outside the sidebar's scoped shell variables, so they stay opaque in
both themes.

Production components and styles are the source of truth; the standalone
mockup's simulated task behavior is not a production contract.

## Other retained previews

Brand, landing, pricing, account, onboarding, diagnostic, and isolated component
previews are not workspace-shell references. Their content may still be useful,
but any illustrative workspace chrome inside them is historical and must not
be copied. Use the approved shell when presenting those features in a workspace.

The incompatible single-sidebar, wide-navigation, and earlier unframed-shell
workspace mockups have been removed. They remain recoverable in Git history,
not as active design examples.

## Rebuild the canonical preview

With the repository's React, Radix, Lucide, Sonner, esbuild, PostCSS and Tailwind
dependencies installed:

```sh
node internal/plans/mockups/build-agent-thread-activity.cjs
```

The output is a self-contained HTML file. Open it directly in a browser; it
does not require authentication, live services, or production mutations.
