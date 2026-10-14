# shadcn/ui migration plan

_Started 2026-10-13. Progress verified 2026-10-14 against GitHub and
`origin/main` at `6a5218fe9510e3df37ec0d4698b3af328112851f`. Companion visual
mockup: [`mockups/shadcn-migration-preview.html`](https://github.com/LayerNorm/overlay-web/blob/main/docs/plans/mockups/shadcn-migration-preview.html)._

## Progress

| Phase | Status | PR / next action |
|---|---|---|
| 0a Tailwind v4 | Merged; production acceptance recorded for `4698f8347caf0bc44b3a0fab29781ff744fc6629` | [#198](https://github.com/LayerNorm/overlay-web/pull/198) |
| 0b shadcn foundation | Merged with Phase 1: dependencies, `components.json`, canonical primitives and `cn()` | [#200](https://github.com/LayerNorm/overlay-web/pull/200) |
| 1 dialog + alert-dialog | Shared `DialogFrame`/`ConfirmDialog` shims merged. Phase 1b remains: audit and migrate the remaining bespoke dialog consumers and retire hooks only when unused. | [#200](https://github.com/LayerNorm/overlay-web/pull/200); remaining scope below |
| 2 dropdown-menu + popover | Merged at `7578b6914`; authenticated current-head preview QA and all nine required merge-queue checks passed, including combined menu/select regressions | [#209](https://github.com/LayerNorm/overlay-web/pull/209), [final QA](https://github.com/LayerNorm/overlay-web/pull/209#issuecomment-6161698065) |
| 3 tooltip | Merged: Radix Tooltip behind the existing `DelayedTooltip` API | [#202](https://github.com/LayerNorm/overlay-web/pull/202) |
| 4 select | Merged at `1beef931b`; authenticated current-head preview QA and all nine required merge-queue checks passed, including native-form compatibility, all 39 presets, keyboard focus and mobile | [#208](https://github.com/LayerNorm/overlay-web/pull/208), [final QA](https://github.com/LayerNorm/overlay-web/pull/208#issuecomment-6161640601) |
| 5 command (cmdk) | Merged at `6a5218fe9`; exact-head (`3da6a92d1`) hosted preview acceptance (keyboard, real destinations, loading/empty, mobile, 39 presets) and all nine merge-queue checks passed. Not promoted to production. | [#210](https://github.com/LayerNorm/overlay-web/pull/210), [integration acceptance](https://github.com/LayerNorm/overlay-web/pull/210#issuecomment-6167519059) |
| 6 core form primitives | Not started | Separate 6a, 6b and 6c PRs |
| 7 niche fills | Not started | After the relevant foundations |
| 8 ad-hoc markup sweep + guardrails | Not started | Per-feature PRs after primitive migrations |

Phases 2 and 4 passed preview QA before merging; this does not constitute
production promotion. Production remains a separately authorized release.
The baseline inventory below is historical, not the current dependency or
consumer count. GitHub PRs and their checks remain the integration record.

One scope note vs the original plan: phase 0b's semantic shadcn token
aliasing (`--card`/`--primary`/…) is deferred — the components consume
Overlay's own CSS vars directly, so they theme correctly in all three
modes without a second var layer. If we later adopt upstream shadcn
themes wholesale we can add the alias layer then.

Goal: replace the bespoke machinery inside `@overlay/ui` (hand-rolled focus
traps, portals, positioning, presence, tooltips, command palette) with
shadcn/ui on **Tailwind CSS v4** — while keeping Overlay's visual identity
pixel-identical. What ships looks the same; what changes is the machinery
underneath, plus a second phase that converges the ad-hoc markup layer onto
the same primitives.

Scope is the **web app only**. `overlay-desktop` (submodule, forked `overlay-ui`
copy) and mobile are explicitly deferred to a later project — no coupling.

## Baseline before migration (audit, 2026-10-13)

| Layer | Reality |
|---|---|
| Design system | `@overlay/ui` in `packages/overlay-ui` — 19 primitives + 3 overlays, all hand-rolled; **zero** headless deps (no Radix/cmdk/floating-ui/`clsx`/`tailwind-merge`/CVA) |
| Tailwind | `tailwindcss@^3.4.19`, thin `tailwind.config.js`, **0** uses of `@apply`, **0** uses of `theme()`, colors already mapped to CSS vars — an unusually easy v4 candidate |
| Adoption | 96 files import `@overlay/ui` (66 in `src/`, 30 in packages) — but **318** raw `<button>`, 48 `<input>`, 9 `<textarea>`, 8 `<dialog>` in `src/` alone, plus ~181 raw `<button>` in `overlay-chat-react`/`overlay-modules-react` |
| Dialogs | ~20 surfaces: 10 via `DialogFrame`, ~10 hand-rolled (`usePresence` + `fixed inset-0`), incl. two `ShareDialog.tsx` files |
| Floating surfaces | `FloatingMenu`/`MenuSurface` positions itself with manual `getBoundingClientRect` math — no portal, no collision handling, no typeahead |
| Command palette | `CommandPalette.tsx` is 251 hand-rolled lines (cmdk's exact problem) behind `GlobalSearchDialog` |
| Theming | `[data-theme]` light/dark **plus** `data-theme-preset` JS-injected presets (`AppSettingsProvider`) — three theme modes, not two |
| Latent bug | `tailwind.config.js` has no `darkMode` key → the **61** `dark:` classes respond to OS preference, not `data-theme`; only correct by coincidence |
| Overlay layers | Dialogs sit at `z-[9998]`–`z-[10080]`; Radix portals must adopt this scale |
| Boundaries | `check:module-boundaries` bans `from '@/…'` inside `packages/` → shadcn components **must** live in `packages/overlay-ui`, not `src/components/ui` |

## Why Tailwind v4 first

Latest is the right base here, and the repo is a good candidate for it:

- shadcn/ui's canonical setup is now v4-first — CSS-first `@theme` tokens,
  `@custom-variant`, oklch palette. Current docs, the CLI, and most agents'
  knowledge assume it. Doing the token mapping on v3 means writing it twice.
- The upgrade surface here is small: **0 `@apply`, 0 `theme()`, no plugins**,
  config is thin, colors already CSS-var based. `@tailwindcss/upgrade` handles
  the mechanical renames (`shadow-sm`→`shadow-xs`, `outline-none`→
  `outline-hidden`, `bg-gradient-to-*`→`bg-linear-to-*`, ring/blur changes).
- `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`
  fixes the 61 `dark:` classes more cleanly than a v3 config key — and the same
  mechanism gives us `preset:` variants for the third theme axis.
- It consolidates the **three overlapping token sources** (overlay-ui
  `styles.css`, `globals.css`, preset injection) into one `@theme` source of
  truth — the real long-term consistency win.
- Fallback: if the v4 PR's QA shows real breakage, phases still work on v3 —
  shadcn supports both. But the default is v4.

Known v4 behavior changes to audit during that PR: default border color
(`currentColor`), ring width, hover styles now gated on `(hover: hover)`,
`space-x-*` selector change, third-party CSS import ordering (`katex`, `tippy`,
`driver.js`, `reactflow` must layer after `@import "tailwindcss"`), and
Storybook build config.

## Architecture & separation of concerns

This is designed so any agent that knows shadcn can navigate instantly:

- **One design-system package.** All primitives live in
  `packages/overlay-ui/src/components/ui/` using the **canonical shadcn file
  layout** (`button.tsx`, `dialog.tsx`, `tooltip.tsx`, …). `components.json`
  at repo root retargets its `ui`/`utils` aliases there — not
  `src/components/ui` (the module-boundary check bans `@/…` imports from
  packages, and chat-react/modules-react legitimately need primitives too).
- **One import surface.** `@overlay/ui` stays the only entry point. Existing
  export names/props are preserved as thin shims over the new internals, so
  the 96 consumer files don't churn mid-migration and product code never
  touches Radix directly.
- **One token source.** `@theme` in a single CSS module owns the palette;
  `globals.css` consumes it; the preset injector emits the same variable
  names. `packages/overlay-ui/src/styles.css` gets folded into it.
- **Guardrails.** After the phase-8 sweep: update `AGENTS.md` ("UI primitives
  come from `@overlay/ui`; no raw `<button>`/`<input>`/`fixed inset-0` overlay
  markup in feature code") and add an ESLint `no-restricted-syntax` rule on
  raw elements so new code can't regress. `check:module-boundaries` and
  `check:bundle-budgets` already enforce package edges and JS cost.
- **Keep bespoke:** `OverlayMark`/Orb (brand rule), `UsageMeterBar`, the
  primary rail's chrome (the secondary panel moved to the shadcn Sidebar
  parts; see `interface-design.md`), and domain surfaces (`ComprehensiveModelPicker`, composer,
  xyflow canvas, TipTap editor). shadcn provides primitives, not product
  surfaces.

## Per-PR QA protocol (runs after every PR in every phase)

1. **Affected-pages list.** Derive routes from the diff (feature dir → route
   map; component changes list every route importing them). Record it in the
   PR body.
2. **Programmatic smoke:** `npm run build`, `tsc`, targeted ESLint on changed
   files, `check:module-boundaries`, `check:bundle-budgets`, Storybook build.
   Plus a scripted route sweep (Playwright/CDP) hitting every affected route —
   assert zero console errors and non-empty render.
3. **Interaction-based browser QA on every affected page**, logged in via the
   demo credentials stored in secrets — click through each changed surface:
   dialogs open/close/trap, menus at viewport edges, selects, palette ⌘K,
   forms, toggles. Cover **light, dark, and each preset** wherever theming is
   in scope.
4. **Evidence in the PR:** screenshots/short recording + a QA checklist in the
   body (commands run, routes hit, what looked normal). Dark-mode rule for
   review: dark gray surfaces + light text — never full-white cards or
   full-black CTAs.
5. **Keyboard pass:** focus trap, ESC, arrows on every interactive change.

## Phase 0a — Tailwind v4 upgrade (`chore/tailwind-v4`)

One PR, zero intended visual change.

1. `npx @tailwindcss/upgrade` (codemod: config → `@theme`, class renames).
2. `tailwindcss@4` + `@tailwindcss/postcss` in `postcss.config.mjs` (drop
   `autoprefixer` — v4 handles prefixes); keep a minimal `@config` reference
   only if needed during transition, otherwise delete `tailwind.config.js`.
3. Fold overlay-ui `styles.css` tokens + `globals.css` palette into a single
   `@theme` module; preset injector emits the same names.
4. `@custom-variant dark` → `[data-theme="dark"]` (fixes the 61 classes);
   `@custom-variant preset-*` for the preset axis.
5. Fix third-party CSS `@import` ordering; verify `@source` covers
   `packages/*/src` content scanning; verify Storybook + Next build.
6. Manually audit v4 behavior changes listed above.

**QA:** full protocol — this PR touches every styled surface, so the affected-
pages list is *the whole app*; the scripted route sweep matters most here.

## Phase 0b — shadcn foundation (`ui/shadcn-foundation`)

1. `npm i radix-ui clsx tailwind-merge class-variance-authority cmdk`.
2. `npx shadcn@latest init -d`; retarget `components.json` aliases into
   `packages/overlay-ui`.
3. Replace hand-rolled `cn()` with `clsx + tailwind-merge` (same export path).
4. Map Overlay tokens onto shadcn's semantic names **inside `@theme`** instead
   of adopting shadcn's palette:

   | shadcn var | ← Overlay var |
   |---|---|
   | `--card`, `--popover` | `surface-elevated` |
   | `--primary` (+ `-foreground`) | `foreground` inverted (existing inverted-button pattern) |
   | `--secondary`, `--accent`, `--muted` | surface tiers (`surface-subtle`/`surface-muted`) |
   | `--destructive` | `danger` |
   | `--border`, `--input`, `--ring` | existing border/focus tokens |

   Emit for light + dark **and** the preset system — the `data-theme-preset`
   injector must emit the new names, or presets silently half-theme.
5. Portal z-index scale: map Radix layers onto the existing `z-[9998]`–
   `z-[10080]` band — no second scale.

**QA:** protocol with affected-pages = any route rendering a primitive
(effectively app-wide, but mechanical — lean on the scripted sweep + spot
checks of the highest-traffic routes: chat, settings, workspaces).

## Phase 1 — dialog + alert-dialog (highest leverage)

~20 dialog implementations collapse to two primitives.

1. Add `dialog` + `alert-dialog` in `packages/overlay-ui`.
2. Reimplement `DialogFrame` internals on Radix — keep export name and props;
   its 10 callsites upgrade untouched.
3. `ConfirmDialog` → alert-dialog.
4. **Phase 1b (separate PR):** migrate the ~10 hand-rolled surfaces:
   `components/share/ShareDialog`, `features/share/ShareDialog`
   (deduplicate these two), `IntegrationsDialog`, `SignInFullScreenModal`,
   `OnboardingTour`, `NameWorkspaceDialog`, `LinkOpenInterceptor`,
   `AppSidebarChrome` bits.
5. Deprecate `usePresence`/`useDialogFocus`; delete once unused (still used
   by the phase-1b stragglers + `FloatingMenu`).

## Phase 2 — dropdown-menu + popover

Canonical `ui/dropdown-menu.tsx` and `ui/popover.tsx` own portals, dismissal,
focus and collision-aware positioning on the existing z-10090 scale.
`MenuSurface` retains its standalone visual API and shares the same surface
classes; it does not invent menu semantics for arbitrary children.
`FloatingMenu` retains external `anchorRef` support as a Popover and adds an
optional native `trigger`; action menus use `kind="menu"` with a trigger.
`MenuItem` retains button props/callbacks and becomes a Radix item only in that
action-menu context.

Consumer audit:

| Consumer | Semantics / decision |
|---|---|
| Direct-message/channel conversation options | DropdownMenu; arrows, Home/End, disabled-item skipping and typeahead |
| Sidebar account fallback (desktop/mobile) | Popover; usage/storage/apps disclosures and links remain native controls |
| Workspace/account switcher | Popover; workspace buttons expose pressed state; disclosures, retry and create-dialog handoff remain interactive |
| Chat/automation header model picker | Popover; generation/selection-mode controls and multi-selection remain native controls; model details use a nested row-anchored Popover |
| Exported ComprehensiveModelPicker (no current production callers) | Popover; local real-component fixture covers rows, badges, callbacks and model order |
| ScopeItemActions / ScopeBulkActions | Inline buttons today, not floating menus; unchanged |
| MenuSurface story | Standalone surface with native buttons; unchanged API |

Integration dependency: #209 includes #208 so the final preview verifies menus
and selects together. Model-details hover dismissal stays suspended while its
nested Radix reasoning select is open; pointer locking must not unmount it.

Affected routes: all authenticated app routes with sidebar workspace/account
chrome; collaboration chats/channels, chat and automation chat headers, and
agent model settings. No selects, command palette, remaining dialogs or
app-wide markup sweep are migrated here. The workspace create dialog receives
an explicit close-focus callback because its original menu item unmounts.

Run `node scripts/qa/menu-interactions.mjs` for real-wrapper and product-picker
Chromium interaction regressions. Its fixture covers action keyboard/mouse,
rich controls, legacy anchors, collisions, scrolling, nested dialogs, focus,
CSS-variable themes and touch. This is independent component evidence, not a
substitute for current-head authenticated PR-preview QA or all real presets.

## Phase 3 — tooltip

`DelayedTooltip` → Radix Tooltip, keeping the `content`/`delay` API as a thin
wrapper (~6 files / ~22 callsites). Smallest PR; instant consistency.

## Phase 4 — select

`Select`/`ListboxSelect` use canonical Radix Select primitives, preserving the
option-child and generic APIs. Audit found 24 production consumer files plus
one chat compatibility re-export and Storybook. Plain-string option rendering
and source/group order remain unchanged; comprehensive model pickers are outside
this phase (Phase 2 owns their floating machinery).

Affected surfaces: Settings (link preference, theme preset, default model,
archived category, MCP token workspace/expiry); Agents (new/editor model,
reasoning, computer size, provider account, Slack channel, environment); chat
model qualities (reasoning); Memories (member/type/importance); Extensions MCP
transport/auth/tool policy; Automations schedule/model/time zone and run replay;
workspace roles/invites and automatic top-up; ShareDialog target/group/permission;
authorization/catalog admin; `/oauth/authorize` workspace consent.

Selectable empty options in ShareDialog, run replay, catalog principals and
agent defaults/accounts cannot be Radix empty item values. A private ID adapter
preserves them without product changes; original values stay in callbacks/forms.
Unknown values retain their prompt text. Native `multiple`/`size > 1` is a narrow
compatibility fallback (no current consumer); native form bridge preserves
validation, autofill, reset and real change events. Tab closes/advances rather
than inheriting Radix's Tab trap. See Interface Design for the contract and
`scripts/qa/select-interactions.mjs` for local browser checks.

Local checks do not replace current-head isolated-preview consumer QA. Required
coverage includes persisted settings, agent dialogs/scroll containers, sharing
groups/empty targets, automation time zones/replay, mobile and theme presets.
Permission/fixture-limited admin, billing and OAuth flows must be reported honestly.

## Phase 5 — command (cmdk)

**Done (2026-10-14, [PR #210](https://github.com/LayerNorm/overlay-web/pull/210)):**
canonical cmdk primitives live in `packages/overlay-ui/src/components/ui/command.tsx`
and compose the merged Radix dialog; `CommandPalette` keeps its API and
`GlobalSearchDialog` is unchanged for consumers. Application-ranked rows bypass
cmdk filtering (`shouldFilter={false}`). Legacy dialog hooks keep their other
consumers. cmdk 1.1.1 was added to the manifest/lockfile. Known limits
carried from the PR: Storybook has an existing app-core export blocker and
local production prerender needs configured env. Production promotion is a
separate authorization. The scope and acceptance below are kept as the record.

1. Audit `packages/overlay-ui/src/components/overlays/CommandPalette.tsx`,
   its public types/exports, Storybook and
   `src/components/layout/GlobalSearchDialog.tsx` plus actual shortcut owners.
2. Add canonical cmdk primitives at
   `packages/overlay-ui/src/components/ui/command.tsx`; keep `@overlay/ui`
   imports and existing consumer contracts where feasible.
3. Replace the palette internals and adapt `GlobalSearchDialog` using the
   merged dialog primitives. Give dismissal, focus trapping/return, scroll
   locking and keyboard selection one owner each; retire only superseded
   palette-specific hooks.
4. Preserve search results/ranking, async behavior, grouping, recent items,
   breadcrumbs/drill-in where present, loading/empty states, disabled rows,
   callbacks and destinations. Avoid cmdk filtering or reordering results
   already filtered/ranked by the app. Preserve Cmd/Ctrl+K, arrows, Enter,
   Escape, Tab behavior and normal typing outside the palette.
5. Preserve Overlay dimensions, CSS variables/presets, portal stacking and
   responsive styling. Do not broaden into menus/selects, Phase 1b, forms,
   the markup sweep or search-backend redesign.

**Acceptance:** proportionate type/lint/boundary and interaction checks, then
current-head authenticated QA on `pr-<number>.preview.getoverlay.io`: shortcut
open/close and reopen, recent/search/clear/no-results/loading, grouped and
long lists, mouse/keyboard activation and real destinations, focus trap and
return, outside dismissal, mobile, light/dark and preset themes. Include exact
preview SHA, screenshots, commands and honest fixture/permission limitations
in the PR. A new app revision requires fresh affected preview QA. Update
applicable living docs, this progress section and root CHANGELOG in the same
PR. Integration owns merge and any separately authorized production release.

## Phase 6 — core form primitives (split to keep diffs reviewable)

Reimplement internals on shadcn, keeping `@overlay/ui` exports:

- PR 6a: `button` (+variants incl. icon), `input`, `textarea`, `label`
- PR 6b: `checkbox`, `switch`, `badge`, `separator`, `skeleton`
- PR 6c: `tabs`, `scroll-area`; consolidate `Toggle` onto `switch` semantics

## Phase 7 — niche fills

`sheet` (mobile panels), `card`, `avatar`, `sonner` (replaces hand-rendered
toasts/notices), `alert`. Add `progress` only if it can adopt `UsageMeterBar`'s
shape without changing it — otherwise keep it bespoke.

## Phase 8 — ad-hoc markup sweep (where most inconsistency actually lives)

Per feature dir, one PR each: `chat` → `settings` → `workspaces` → `agents` →
`account` → `integrations` → `knowledge` → `components/` chrome → `marketing`
(zero `@overlay/ui` imports today — the biggest bespoke island).

Replace raw `<button>`/`<input>`/`fixed inset-0` markup with the migrated
primitives (~500 raw buttons + ~60 raw inputs). Then land the guardrails:
`AGENTS.md` rule + ESLint `no-restricted-syntax` on raw elements.

## Risks / watch list

- **v4 upgrade diff size** (0a): mechanical but touches every styled file —
  that's why it lands alone with the full QA protocol, with the scripted route
  sweep doing the heavy lifting.
- **Preset coverage** (0b, item 4): easiest thing to get silently wrong —
  presets must emit the new var names.
- **Z-index collisions**: audit `z-[9998]`–`z-[10080]` users before phase 1.
- **Bundle budgets**: Radix adds JS incrementally; check `bundle-budgets`
  every PR rather than discovering it in phase 5.
- **Two `ShareDialog.tsx` files**: rename-or-merge decision in phase 1.
- **Storybook + Next dual build**: both must accept the v4 setup in 0a.

## Sequencing note

0a is the only "every file at once" change and goes first so everything after
it builds on the final stack. Phases 1–2 are deliberately next: they prove the
shim-and-tokens pattern against the highest-risk machinery while diffs stay
small. If a phase stalls on a detail (presets, z-index), ship it scoped rather
than widening the PR.
