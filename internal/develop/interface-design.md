---
title: "Interface Design"
description: "Product UI decisions every surface follows: toggles-only controls, one-control-per-row layouts, and editors without save bars."
---

## Extension cards and dialogs

MCP and Skills use shared Card surfaces with explicit Manage actions and confirmation before deletion. Editors use shared Dialog, Select, Switch and AlertDialog primitives, compact content-width Configuration/Tools tabs and spacing instead of internal dividers. Preserve OAuth connection status, tool policy, scope and existing mutation callbacks. Docked left/right panel resize handles occupy the gutter outside the framed surface; floating panels retain inset handles.

## Chief identity and Organization

Workspace Agents pins the workspace chief first and the viewer's workspace-scoped
personal chief second; Personal pins the private personal chief first. Keep thread
expansion and per-agent new-thread controls; manual collapse survives rerenders.
Work → Organization sits directly below Timeline in both scoped desktop/mobile
lists, retains the selected subpage when switching scopes and closes the mobile drawer.

Organization details use one hero avatar. Only the personal-chief owner can edit
name, description, shape and color, with explicit save/error feedback. Peers and
workspace admins see read-only owner details. Workspace chiefs use the Overlay
mark; personal chiefs use customizable creatures even when an adopted legacy row
retains `isDefault`. Other legacy defaults still use the mark. Identity follows
explicit role/flags, never the agent name. See Bring Your Own Agents for isolation.

## Double-sidebar shell

An optional run questionnaire skipped without an answer sends an explicit `(skipped)` reply, including a single-question panel, so the waiting run can resume. Required empty answers remain blocked.

The web shell's **Double sidebar** setting uses `DoubleSidebar` from `@overlay/shell-react`: a fixed 60px primary rail and a 272px contextual panel, resizable between 220px and 360px. The active rail destination toggles only its panel without navigating, except Chats, which starts a fresh Personal draft and keeps the panel open. Another destination opens its panel and uses the existing scope-aware navigation handler. Files, Extensions, and Automations stay in More when their existing gates allow them.

`src/app/double-sidebar.css` scopes the rounded content frame, default light/dark chrome, compact chat presentation, and curved agent-thread guides to this layout at desktop widths. Custom theme presets retain semantic colors. The mobile drawer, onboarding, and compact native desktop panel retain their existing layouts; macOS keeps a dedicated drag region above the shell.

The contextual sidebar and right detail panels use the same 1px border and 12px radius as the main surface, with an 8px gap between docked surfaces. `AppScreenShell` exposes separate main and right-panel slots so details do not share one enclosing content border. Side-panel headers in this shell are 48px with the same top edge as the main header and the contextual sidebar title row. Only the outer screen gets the frame; embedded editor shells are not framed again. Floating panels and mobile overlays keep their positioning and dismissal behavior. Established conversations retain the shared `max-w-4xl` transcript/composer width, including agent-room transcripts. New chats and new automations use the same bottom-docked `max-w-4xl` composer: the greeting (and any automation intro) is centred in the free space with suggestions just above the composer, so nothing moves when the first message is sent (`internal/plans/mockups/composer-at-bottom.html`). The approved follow-up is `internal/plans/mockups/double-sidebar-bordered-mockup.html`.

While onboarding hides navigation, the desktop double-sidebar shell uses equal 8px left and right gutters, including its loading and error states. `OnboardingShell` exposes its existing locked state through `data-onboarding-locked`; unlocking restores the rail's normal zero left padding. Mobile spacing and macOS top drag-region clearance are unchanged.

Chats primary navigation opens the existing unsaved Personal chat surface, not the most recent conversation in the current scope. Onboarding payment controls stay mounted across task-save revisions and pending actions so checkout consent is preserved. Only the intentional checkout redirect suppresses unload guards, after task preparation succeeds. Completion stores the completed response, deactivates setup and navigates to the canonical Personal Work URL with the task query already included; personal scope lives in the path, not a redundant query parameter. `OnboardingWorkHandoff` lays out route content behind an opaque retained onboarding surface, rather than using `display: none`. Only the loaded selected-task peek (or a settled unavailable state), not its entry in the Work list, can finish the handoff. It waits for the panel's presence, opacity and layout to settle, then retains onboarding through that paint before revealing Work. If navigation loses the task query, it restores the intended URL first. It does not launch a navigation tour, and later navigation cannot reactivate the retained session.

The guided onboarding conversation shares live room read markers with Chats. Room query arguments and the optimistic notification-read mutation retain their identities across live updates, so acknowledging a read cannot restart its own effect or repeatedly reload the sidebar conversation directory.

`useSecondarySidebar` still means rail-and-panel. New settings default to `true`. The owner requested a one-time reset of existing accounts to double sidebar; the internal `migrations/doubleSidebar:enableExistingAccounts` mutation supports bounded pages and dry runs, changing only this preference. Run it once during rollout, never as a scheduled reconciliation. Later explicit `false` choices still select `UnifiedSidebar`. This is an account-wide setting that applies across all workspaces; there is no separate workspace sidebar preference. The frontend contract and Convex new-row defaults must agree. Deploy backend default changes only through the normal isolated preview/canonical-main release process, never to shared development from a feature branch.

Workspace mockups must strictly reuse this production shell, not approximate it with a custom single sidebar or move agent threads into tabs above the conversation. The canonical interactive reference is `internal/plans/mockups/agent-thread-activity.html`; its source imports the real `DoubleSidebar` and production shell CSS. See `internal/plans/mockups/README.md` for the required structure and the scope of older non-workspace previews. This rule governs mockups, not removal of the existing optional `UnifiedSidebar` setting.

Regression checks: `npm --prefix packages/overlay-shell-react test`, focused sidebar/navigation/thread tests, `npm run check:raw-controls`, and `npm run check:module-boundaries`. Browser QA should compare light/dark and collapsed/expanded states with `internal/plans/mockups/agent-thread-activity.html` and `internal/plans/mockups/double-sidebar-bordered-mockup.html`, then check scope switching, Settings, More, agent thread actions, and mobile navigation on the isolated PR preview.

# Overlay interface design

Product UI decisions that every surface follows. When a new control is needed,
check here first — the answer is usually "use the existing pattern".

Connected-agent output uses formatted chunks and one bottom loading indicator. Streaming
Markdown may close an actual unfinished emphasis span, but identifiers and inline-code
filenames keep their literal underscores; completion must not remove synthetic visible text.
Preview-only timing diagnostics use a Lucide download control through the shared Button primitive
and style reset in the existing message toolbar,
with recording/stopped/error in its accessible label. They require both the branch build opt-in
and conversation query, and remain absent from Production.

## App screen breadcrumbs

Account and workspace Profile use the shared identity image editor with Avatar,
Dialog, Button and Input primitives. Photo changes support square crop, zoom and
positioning; workspace icons also offer bundled presets and initials. Keep the
scope visible in headings, provide explicit save/error states and restore inherited
account defaults by clearing workspace overrides rather than copying current values.
Human avatars fall back to initials when images are missing or fail to load;
agents retain their creature avatars.

`AppScreenHeader` and custom module headers use the shared `AppBreadcrumbs` component,
composed from the shadcn Radix Breadcrumb primitives in `@overlay/ui/primitives`.
`AppBreadcrumbContext` supplies the active Personal/Workspace scope and page; callers add
subpages or selected records through `breadcrumbs` and the final title. Preserve scope in
breadcrumb destinations and expose only the final item as the current page. Current-page
labels have no disabled-link semantics, so embedded note-title inputs remain accessible
and editable.
Resolve scope with `usePanelScope` and destinations with `useWorkspaceHref` so
handle routes, legacy links and solo workspaces retain the same scope as navigation.
Settings is unscoped: its header starts with Settings and links to `/app/settings`
without a Personal/Workspace prefix or scope query. The legacy Archived and Memories
surfaces use the same Settings root because they redirect into Settings.

## Tailwind CSS v4 configuration

`postcss.config.mjs` loads `@tailwindcss/postcss`. The app imports `tailwindcss`
in `src/app/globals.css`; `@theme` defines utility tokens there. The same file
uses `@source` to scan app code and the UI, chat, and module React packages.
When adding a package that renders utilities, add its source path there.

`dark:` follows `[data-theme='dark']` through `@custom-variant`, so it follows
the in-app theme setting. The base semantic palette lives in
`packages/overlay-ui/src/styles.css`; `globals.css` adds app-specific variables.
The base border rule preserves the earlier gray default. Use an explicit
border color for new controls.

Tailwind utility names apply to class names. Literal CSS, including injected
note-editor styles, uses standard properties such as `flex-shrink: 0`.

## Agent connection controls

Connecting agent messages use the existing hover-toolbar Stop icon to cancel. Do not
add inline timeout explanations, Cancel buttons, or preemptive Retry buttons. Recoverable
failures expose a Retry icon in the same toolbar; retries in progress hide it. Preserve
failure output and the explicit safety confirmation for runs that need inspection.

## Resizable panels

Use `PanelResizeHandle` from `@overlay/ui` for adjustable sidebar and side-panel
widths. It exposes a vertical separator with pointer resizing, arrow-key steps,
and Home/End bounds; the owning shell supplies and stores the width.

The agent conversation sidebar uses the app sidebar surface and one scroll
container below its fixed hero and tabs. Its editable fields autosave after an
800ms debounce and flush on blur; saves serialize so newer edits cannot be
overwritten by an older response.

Details and Computer tabs share the editor's computer state. Start, Stop, Wake,
provisioning and deletion update both views; the preview only owns its connection
ticket, not a second cached machine record.

## Shared modal dialogs

`DialogFrame` and `ConfirmDialog` keep their existing controlled APIs on top of
shadcn/Radix primitives. Their consumers open them from ordinary buttons without
a Radix Trigger. Canonical modal `DialogContent` remembers the focused opener
and restores it on close unless a consumer overrides focus restoration. Radix owns focus trapping and scroll locking while open. Content captures the
previous focused element before a descendant’s React `autoFocus` can replace it,
so closing returns focus to the external opener even for autofocus inputs.
Portaled content owns its viewport gutter; padding on `DialogOverlay` does not
constrain its sibling content. Preserve mobile margins in the content width. Custom backdrop and
content stacking levels must match so the backdrop cannot cover dialog controls.

`ConfirmDialog` delegates dismissal to its callbacks. Confirming must not invoke
Cancel or close an asynchronous operation early; native Radix Action/Cancel
closure is prevented. While `busy`, confirmation, cancellation and Escape are
blocked. Run `node scripts/qa/dialog-interactions.mjs` to verify the real wrappers
in isolated Chromium. Use the Playwright browser or set
`OVERLAY_QA_BROWSER_EXECUTABLE` to an installed compatible Chrome executable.
Non-deletion confirmations pass a task-specific `busyLabel` (for example, “Saving…”).

Connected-agent settings use the bound environment's advertised model, effort and permission
choices. Each control saves for the next turn. Permissions use readable runtime labels,
including Manual, Accept edits, Plan, Auto, Do not ask, and Bypass permissions when advertised.
An identity edit must not overwrite choices saved through these independent controls.
Older combined model/effort ids resolve to separate live controls only when both choices
are advertised. Show the effective effort, preserve it when changing models, and leave
saved but unavailable values visible instead of silently replacing them. Runtime catalogs are
authoritative: discovery defaults do not imply settings applied to an active run. Keep loading
and discovery errors explicit, and offer permission defaults only when the host advertises them.
Full-access permission modes require explicit confirmation on both cloud and local agents.

Native Overlay agent Permissions use the editor's ordinary dirty and Save flow. Ask is the default.
Choosing Auto requires confirmation and cancellation leaves Ask selected.

Connected-agent drive status sits below the answer without modifying provider Markdown. Saving
and unsaved states use a quiet status line. Saved file/folder counts expand to at most 32 authorized
Files links, with a link to Files for larger results. Folders navigate by folder id; files open by
file id using the current workspace route. Successful turn completion waits for the final save.
Markdown deliverable viewers resolve sibling and descendant file links under the current file's
parent using authenticated metadata in the same scope. Unknown or ambiguous targets remain
unavailable rather than navigating to a guessed app path. The source Markdown stays unchanged.

Provider Markdown links resolve relative or Cloud Drive paths only when they exactly match
one saved entry. Render the canonical Files URL without rewriting provider text; preserve
ordinary external links, and leave unknown, ambiguous or traversing paths unresolved.
Only canonical `kind: note` records open in the Notes editor. Text/Markdown uploads
retain their file identity and open in the file viewer; MIME type and extension do
not turn them into notes. The file detail adapter requests `fullText: true` so the
viewer and any edit start from the complete object-store content, not its searchable prefix.

Lifecycle-v2 agent messages show the canonical task deadline below live progress, including
while queued, recovering or needing attention. Use an absolute UTC time, independent of the
viewer's control permissions; terminal messages hide the active deadline. Request cards retain
their separate approval expiry, including owner-required MCP tool cards. Cloud approval cards show that machine time continues to be billed while waiting. Displaying a deadline does not attest that a process has stopped.

## Command palette

`CommandPalette` keeps its controlled `@overlay/ui` API over canonical cmdk
primitives in `components/ui/command.tsx`. The merged Radix dialog owns portal,
outside/Escape dismissal, focus containment and scroll lock; the existing
return-focus hook restores controlled openers. The sidebar shortcut registry
remains the sole Cmd/Ctrl+K owner, including composer and contenteditable inputs.

cmdk owns active-descendant selection, pointer activation, disabled-row skipping
and list scrolling. `shouldFilter={false}` preserves application-ranked results
and category order; `vimBindings={false}` leaves Ctrl+K to the shortcut owner.
The input keeps focus while navigating results. Tab stays within the modal;
the breadcrumb is its only other Tab stop. Enter on the breadcrumb goes back
without also activating a result. Escape goes back once in a category, then
closes at the root. Rows keep stable IDs, callbacks, icons and descriptions.
`GlobalSearchDialog` still owns async queries, cancellation and real destinations.
Legacy presence/focus hooks remain for other bespoke dialogs until Phase 1b.

The palette uses the same Overlay tokens, 576px maximum width, 12vh top offset,
70vh maximum height, 16px mobile gutter and the shared z-10070 dialog layer.
Descriptions cap at 45% of their row so long agent instructions cannot hide
the result title or overflow the mobile palette.
Run `node scripts/qa/command-interactions.mjs` for real palette/search-wrapper
regressions with deterministic search fixtures, macOS/Windows shortcuts,
long/grouped lists, CSS presets and mobile sizing. Current-head authenticated
preview QA remains required; fixture routes are not live-navigation evidence.

## Delayed tooltips

`DelayedTooltip` preserves its layout wrapper and attaches Radix's trigger to
its child. Container and Fragment children describe the actual focused control
while open; existing `aria-describedby` tokens are preserved and the tooltip's
ID is removed on blur, close or unmount. Wrappers add no Tab stop. Radix owns
positioning, the portal and Escape dismissal. Fine-pointer hover opens after
450 ms; touch/coarse input suppresses tooltips, including capability changes
while mounted. Run `node scripts/qa/tooltip-interactions.mjs` for rendered
association, cleanup, pointer and media-query checks in installed Chrome.

## Menus and rich popovers

Import dropdown/popover primitives from `@overlay/ui` (or its `primitives`
entry point), never Radix in domain packages. Actions with one selection use
DropdownMenu; arbitrary controls, disclosures and model multi-selection use
Popover with normal Tab navigation. Do not label a rich panel as a menu or
listbox. Selected picker buttons expose `aria-pressed`.

`FloatingMenu` keeps the external `anchorRef` API as a Popover. Prefer its
optional `trigger` for native expanded state, keyboard opening and focus return;
action menus opt into `kind="menu"` and supply a trigger. `MenuItem` preserves
button props and callbacks, using Radix item semantics only inside that action
menu. Standalone `MenuSurface` remains visual, with no implied role.

Both primitives portal at z-10090, consume Overlay CSS vars directly, use a 6px
anchor gap and 8px collision padding, and constrain height to the available
viewport. Rich picker content refs belong on the portalled content, not the
trigger wrapper; remove document-level outside/Escape listeners when Radix owns
the layer. The mobile account fallback also delegates dismissal to Radix;
its old wrapper-ref click listener cannot recognize portalled disclosures.
Model details are a nested Popover, anchored to the hovered row. Their virtual
anchor exposes that row as its scroll context and uses Radix continuous updates
to track the parent pop-in animation; Escape closes the whole model picker.
Their existing reasoning select stays inline in that panel so its clicks remain
inside the owning layer; it now uses the Phase 4 Radix select adapter. Keep the
hover card mounted while that select is open: Radix pointer locking emits a
synthetic mouse leave to Window, which must not dismiss the owning card.

For a menu-to-dialog handoff, the menu row may unmount. Pass an explicit
`DialogFrame.onCloseAutoFocus` callback pointing to the surviving trigger, as
WorkspaceSwitcher does for CreateWorkspaceDialog. Run
`node scripts/qa/menu-interactions.mjs` for the shared and product-picker
interaction checks; authenticated current-head preview QA remains required.

## Shared selects

`Select` (option-child API) and generic `ListboxSelect<T>` use the canonical
`packages/overlay-ui/src/components/ui/select.tsx` Radix primitives. Keep imports
from `@overlay/ui`; `SelectRoot` exposes the canonical root without colliding
with the compatibility `Select`. Trigger dimensions, option rows, Overlay CSS
variables and portalled `z-10090` remain unchanged. `portal=false` stays inline
at `z-50`, with Radix collision handling in both modes.

## Design tokens and button variants

`@overlay/ui/styles.css` defines the palette once and aliases the shadcn token names to it (`--primary`, `--secondary`, `--muted-foreground`, `--destructive`, `--card`, `--popover`, `--input`, `--ring`, `--radius`), so theme presets carry through and shadcn components drop in unchanged. `globals.css` maps them to Tailwind colors (`bg-primary`, `text-muted-foreground`, ...). Pick a `Button` variant instead of restyling one:

- `primary` (solid): at most one per page, the page's main create action.
- `secondary` (bordered gray) or `outline` (bordered, transparent): other header actions.
- `ghost`: icon buttons, row actions, menus. Use `size="icon-sm"` / `"icon-xs"` for square icon buttons.
- `link`: inline text actions.
- `danger`: destructive confirmations only.

`className` on a `Button` sets size and layout, not color, border or background. `npm run check:raw-controls` enforces this: it fails on an `unstyledButton()` string that rebuilds a variant's look and on color classes passed to a non-ghost variant. Real exceptions (checkboxes, segmented toggles, selectable cards) carry a `// overlay:button-style: <reason>` comment above the class line. Shadows: none on in-page surfaces, `shadow-md` for menus, popovers and tooltips, `shadow-lg` for dialogs and sheets. Motion: 150ms for hover and color, 200ms for menus and panels.

## Prose (Typeset)

Rendered Markdown and rich text use shadcn Typeset from `@overlay/ui/typeset.css`, our own copy of the upstream file. Add the `typeset` class to the element that wraps rendered prose (chat messages via `MarkdownMessage`, notes via the editor's `app-note-editor` root) and tune it with the `--typeset-*` variables rather than per-element overrides. Typeset skips `[data-slot]` components and anything under `.not-typeset`, so buttons, chips and cards inside prose keep their own styles. It is not for app chrome.

## Primitive style resets

When migrating a control while preserving its existing visual contract, import
`unstyledButton`, `unstyledInput`, or `unstyledTextarea` from
`@overlay/ui/control-reset`. Apply the helper at the existing control so local
classes and native semantics remain explicit.

Shared `Input` and `Textarea` controls use the shadcn focus-visible border and
ring treatment; `Input` uses `rounded-md`. Preserve the keyboard focus ring by
using `focus-visible:ring-0` only when a control intentionally has no ring.
Search and message editors use `@overlay/ui` primitives, with message edit
actions below the full-width textarea. `useAutosizeTextarea` remeasures on value
and width changes and after fonts load; use it for work titles and agent
instructions.

Agent Details uses collapsed `Collapsible` rows for Model, Instructions, Tools
and Advanced. Keep labels at their intrinsic width and truncate only the flexible
summary, so long instructions cannot crowd out the section name. Keep summaries
concise and visible only while collapsed. Mentions
is a plain heading inside Advanced, not a nested disclosure.
Native Permissions lives inside Advanced, with the effective Ask/Auto choice in
the collapsed summary. Keep its existing confirmation and save behavior, and
preserve Computer takeover/handback controls when regrouping the fields.

Radix forbids empty item values; the adapter uses private index IDs and translates
back to original public values. Empty options remain selectable (sharing, replay,
agent defaults/accounts); an unmatched controlled value retains its display text
(the Slack channel prompt). Groups preserve source order; disabled options/groups
stay visible and cannot be selected. No domain model-picker ordering changes.

`Select` keeps a visually hidden native select for original FormData values,
required validation, autofill, real `ChangeEvent<HTMLSelectElement>` callbacks and
uncontrolled form reset. Labels/IDs and control events belong on the visible
trigger. Multiple selection or `size > 1` remains narrowly native because Radix
Select supports neither; no current product consumer requests these modes.
`ListboxSelect` retains its named hidden input, omitting it when disabled.
Radix's private form events do not bubble through this adapter.

Radix supplies arrows, typeahead, selection, scroll buttons, Escape/outside
dismissal and focus return. The adapter closes on Tab/Shift+Tab and advances
through visible controls, wrapping at the boundaries of an enclosing dialog
and skipping disabled controls (including busy footer actions). Only actual modal
dialogs advertise `aria-modal=true`; non-modal popovers traverse the document
instead of looping on their own select. Run
`node scripts/qa/select-interactions.mjs` for real-browser adapter/form/keyboard/
collision/dialog/mobile tests and all 39 preset variable checks. Set
`SELECT_QA_CHROMIUM` only when using an existing Chromium executable.

## Work: tasks, board, and timeline

Work has a bottom-pinned prompt composer in Personal and Workspace scope. It is the same `PromptInput` box as chat and agent threads: one outlined card centered at `max-w-4xl`, a 44px text area, and one footer row with context +, Assignee, Schedule, Depends on, the settings gear and submit. The page header has no New task button; the composer (and the C shortcut) is how a task starts. Enter creates a task from the first line (200 characters maximum); Shift+Enter adds description lines. Assignee and Depends on use searchable Popover/Command pickers; Schedule has Start/Due date inputs and presets. Inline settings offer Backlog/Todo and Low/Medium/High (Medium by default). Successful creation clears all fields and refocuses. Context reuses Work's file/note/chat/link search; dictation appears only in Desktop when supported. There is no expand control or Repeat setting yet.

An agent assignment starts immediately unless a dependency is not done. Blocked assignments retain a pending execution; completing the final blocker through either a field edit or a board move schedules a deployment-secret callback under the original assigner's identity. The callback rechecks visibility and budget, and the Convex claim rechecks dependency status atomically with the assignment generation/status, so concurrent releases cannot dispatch twice. Transient callback failures retry six times with capped exponential backoff; terminal failures are logged. Removing dependencies also reevaluates pending assignments.

The Work page (`src/features/work/`) follows the existing patterns and adds a few of its own:

- **One page, three views.** List, Board and Timeline show the same tasks. Scope (`?scope=`), view (`?view=`), filter
  (`?filter=`) and the open task (`?task=`) live in the URL, so a link opens where it was copied and Back closes a task.
  A task link opens in the scope the task lives in.
- **Edit in place, save at once.** There are no save bars. Every change appears immediately, is confirmed by the
  server's answer, and rolls back with a plain message in an inline alert if the server refuses.
- **The task panel is a docked right panel** (`AppScreenSidePanel`), not a modal. Escape closes it unless a picker or a
  text field has it first. The task title is the panel header, edited in place; its move/archive and close buttons are
  32px like every other header button. A Thread row under Owner links to the agent thread doing the task, with its live
  state (Working, Finished, Stopped). Only the member who assigned the task owns that thread, so others see no link.
- **Scope is settled before anything acts on it.** The remembered Personal/Workspace choice is shared by every caller in
  the tab. Until it is read (only the hydration render of a URL without a scope), the content boundary waits instead of
  redirecting and Work queries stay skipped, so a Personal guess never flashes, redirects or opens the wrong list.
- **Loading never waits silently.** Work's live queries wait for Convex auth. `ConvexAuthProvider` retries a failed
  token request with backoff (1s doubling to 30s), because Convex asks a fetcher once and otherwise stays signed
  out. A signed-out session shows a sign-in empty state, not skeletons.
- **Pickers are small floating menus** (`FloatingMenu`) with a section label, the options, and a check on the current
  one. Status, owner, reviewer, priority and parent all use the same `Picker` in `WorkPickers.tsx`.
- Owner pickers include usable agents on Personal tasks and hide creator-only agents on Workspace tasks. Agent owners use their creature appearance.
- **The done-when checklist is the one place a box is ticked.** Each condition is a `button role="checkbox"`, not an
  `<input type="checkbox">`: it is part of a task's content (a list the person writes), not an on/off setting, so the
  Toggle rule does not apply to it. Boolean settings on a task (Blocked) are Toggles.
- Status is shown as a glyph first (dashed, empty, half, lens, filled with a check), colour second.

## Toggles are the only on/off control

Nowhere in the web app do we render checkboxes (`<input type="checkbox">`).
Every boolean is a `Toggle` from `@overlay/ui/primitives` (or `SettingsToggle`
inside `@overlay/modules-react` settings surfaces):

- Agent tool grants are settings-style toggle rows (title + description, toggle right).
- Multi-select lists (scopes, events, models, members, import rows) are toggle rows.
- Legal acceptance (sign-up, checkout, billing) is a toggle next to the terms text.
- Dynamic agent elicitation booleans render as toggles.

Rationale: one control means one learned behavior. Checkboxes varied per
surface (accent color, size, alignment); the toggle is identical everywhere,
larger tap target, and its on/off state reads at a glance in both themes.

## One control per row

Selection surfaces stack full-width rows — never side-by-side card grids.
Agent type, harness, environment, and access pickers are stacked radio rows
(`OptionRow` in the agent editor); tool grants are stacked toggle rows.

Swatch grids (avatar shapes, colors, theme presets) are the exception: they
are value pickers like theme presets, not cards.

Short either/or choices (agent type, access, tool presets) use the shared
`SegmentedControl` with `layout="stretch"`. An option that is not available yet
stays visible but `disabled`, with a description such as "Coming soon".

## Explanations live behind info icons

Creation dialogs carry no hint lines. Labels are one or two words; anything
that needs explaining gets an `InfoTip` (Lucide `Info`, `DelayedTooltip`) after
the label, via `FieldLabel` in `src/features/agents/components/InfoTip.tsx`.

## Agent identity

Every surface that identifies an agent uses its creature
(`AgentCreature`: `avatarShape` body, `avatarColor` fill and eyes), except the
default Overlay agent. Pass the agent record's `isDefault` to `AgentCreature`:
it renders the foreground O-with-eyes `OverlayMark motion="blink"` in the same
avatar box. Do not infer default identity from a name or gray color.
Non-default creatures retain legacy color normalization.


## Avatars are edited in place

The default Overlay agent has a fixed, read-only brand mark; do not expose shape/color
controls or dirty its form for customization that cannot be displayed.

A custom agent avatar is a button: hover shows a pencil, click opens
`AgentAvatarPicker` with every creature shape (previewed in the current color)
and the `AVATAR_COLORS` swatches. The new-agent dialog centres it above the
name; the editor's identity section anchors the popover to its left edge.

## Editors save explicitly — no autosave, no save bar

The agent editor reverted from instant-save after review: edits persist only
on an explicit **Save changes** (edit mode) or **Create agent** (the
new-agent dialog, `NewAgentDialog`),
with **Cancel** discarding back to the loaded agent and closing. No sticky
glassmorphic footer bars anywhere — buttons sit in-flow at the end of the
form. Rationale: agent identity edits are consequential (instructions, tools,
access) and users want to review the whole form before anything persists.

**Save keeps the editor open; Cancel closes it.** Saving is a confirmation
point, not a dismissal: the side panel shows a brief "Saved" state and the
form stays mounted so further edits continue in place. Cancel discards and
closes. New-mode Create also closes (the agent now exists to converse with).

## Editors dock to the side or float as a dialog

The agent editor opens in the shared side panel by default and can be toggled
between the docked side panel and a centered dialog from a single icon in its
title row (`PanelRight` to dock, `AppWindow` to float). The two presentations
share the same body, border, and chrome; only the frame differs, so switching
never remounts form state.

## The single sidebar (default)

The default shell is one shadcn sidebar (`packages/overlay-shell-react/src/sidebar/UnifiedSidebar.tsx`): the brand, search and
collapse controls, the Personal/Workspace toggle (hidden for a solo workspace), the main pages with Files and
Extensions under an Explore menu that opens on hover (click, Enter and touch also open it), then the current page's own
rows and items, then the account. It reuses `useAppSidebarState`, so routes, scope persistence, badges and pending states
match the classic layout. Subviews that are different views of one page (Work's List/Board/Timeline, Files categories,
Extensions' Skills/MCPs/Connectors/Apps) are published through `pageSubviewStore` and rendered as header tabs by
`PageSubviewTabs`; chat destinations (DMs, Channels, Activity) stay in the sidebar. There are no divider lines between
sidebar, header and body: `AppScreenHeader` defaults to `border={false}`. The classic primary rail plus secondary panel
below is the Settings > Customization "Rail and panel" option (`useSecondarySidebar`).

## The secondary panel: Personal, Workspace

Chats, Files, Extensions, Automations, and Agents share one panel anatomy:
page title, then the scope rows, then
New + search, then the list. New is never above the scope rows.

- **Scope rows** are Personal (mine within this workspace) and Workspace
  (shared with its members). There is no Archived row: everything archived
  lives in Settings → Archived (see below). Built by `buildScopedPanelNav`
  (`src/components/layout/sidebar/scopedPanelNav.ts`); the selected scope opens
  its page's sub-rows beneath it (Files: All/Notes/Files/Outputs; Chats →
  Workspace: Direct Messages/Channels/Activity; Extensions: Connectors/Skills/
  MCPs/Apps).
- **One scope across pages.** The URL carries `?scope=` (Personal is the
  default and stays out of the URL); the last choice is remembered
  (`overlay:panel-scope` in local storage) so the next page opens on it. Read it
  with `usePanelScope()`; never keep a second copy. Chats derive their scope from
  the subview route instead (DMs, channels, activity are Workspace).
- **New follows the scope.** `scopePanelAction` hides New, in
  Workspace, when the person may not create there (the workspace's admin
  settings; owners and admins always may). In Workspace it reads "… in
  workspace". Create flows send `scope: 'workspace'` only for Workspace
  (`newItemScope`); Personal is what an absent scope means.
- **Archived is one page, Settings → Archived** (`ArchivedSettings`), not a row
  in each sidebar. A dropdown (All, Chats, Files & notes, Agents, Extensions,
  Automations) and a search filter one list; each row carries a Personal/
  Workspace tag (hidden in a solo workspace), a Restore button, and a Delete
  forever button; rows can be multi-selected (checkbox, shift-click for a
  range) for bulk Restore and Delete forever, always behind a confirmation.
  Restore returns an item to where it came from; the server decides who may
  restore or delete (creator, or owner/admin for workspace items); a partial
  failure is reported, not hidden. Archiving anything shows a toast with Undo
  and "View archived" (`announceArchived`, `ArchiveToastHost`). Old
  `?scope=archived` links redirect to the page; `/app/archived` remains only as
  the reader for one archived chat (`?id=`).
- **Agent threads are not agents.** Archiving a thread (per person, from the
  agent's thread list) puts only that thread in Settings → Archived; the agent
  stays live and in its list, and opening it goes to its next active thread (a
  fresh one if none is left). Deleting an archived thread deletes only that
  thread; the agent is untouched. Archived agents are separate rows
  (archive/restore/delete forever of the agent itself; deleting an agent also
  deletes its threads). Bulk delete removes threads before their agent.
- **A workspace of one person has no scope rows.** The interface follows the
  number of *people* in the workspace (`humanMemberCount`; agents do not count,
  and every workspace holds the default Overlay agent), not a setting.
  `isSoloWorkspace` / `useIsSoloWorkspace()` decide: the page's own rows stand
  alone (`buildScopedPanelNav({ solo })`), the Workspace
  scope turns into Personal (`soloPanelScope`, `usePanelScope()`), lists ask for
  everything active (`usePanelListView()`: no `view`, so a shared item such as
  the default agent still shows), Chats shows Chats and Channels only (no
  person-to-person DMs, no Activity), Move to Workspace/Personal and the
  Personal/Workspace tag are hidden, and Agents lists every live agent. An
  unknown count counts as not solo. New items stay `personal` (never send
  `scope: 'workspace'` from a solo workspace): hiding the tabs must not expose
  anything to the next person invited. The full interface returns when a second
  person joins; the owner sees it on the next workspace refresh.


## Secondary sidebar: shadcn Sidebar parts

The secondary panel is built on the shadcn Sidebar parts in `@overlay/ui/primitives` (`packages/overlay-ui/src/components/ui/sidebar.tsx`):
`Sidebar` (the in-flow container; the shell owns its width, collapse animation and phone drawer), `SidebarHeader`,
`SidebarMenu` > `SidebarMenuItem` > `SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuBadge`, `SidebarMenuSkeleton`
and `SidebarMenuSub`. New lists in the panel use these rather than ad-hoc row classes. Only `Sidebar`, `SidebarRail` and
`SidebarTrigger` read `SidebarProvider`; the menu parts work anywhere, so the same markup renders in the phone drawer.
The panel's collapsed state is the shell's one `sidebarCollapsed` flag (it hides this panel and shrinks the primary rail
to icons); the thin handle on the panel's edge (`SidebarRail`) sets it.

### Which expansions are indented

A real tree is indented under a guide line: an agent's threads, automations and "New thread" use `SidebarMenuSub` (a
vertical line at the left of the group, children inset from it), as do the files folder tree and any other list where
depth is the content. Row actions (New thread, Archive, Delete) are `SidebarMenuAction`s that appear when that row is
hovered or focused, scoped to the row's own `group/menu-sub-item`, never the agent that contains it.
Agent header actions use a separate `group/agent-row` so hovering a child cannot reveal its parent action. On touch layouts these actions stay visible; reserve their width in agent/thread rows so long titles cannot render underneath them. Menu/group actions default to `type="button"` unless composed with `asChild`.

Quick thread creation refreshes the bundle after the mutation; only the latest bundle request may publish state, so a slower pre-creation response cannot remove the new row.

What a navigation row reveals (a scope's Personal/Workspace sub-rows, a section's pages) nests the same way:
`InlineNavChildren` renders expanded `children` inside `SidebarMenuSub`, so every grouped set of rows — scope
sub-pages, folder children, threads — shares the one guide-line treatment, and the chevron plus the smaller type size
still mark the row that opened it.

## Agent settings load together

The agent settings (`AgentEditorPage`) have several independent loaders (the agent, its connection and environments, its computer, reachability surfaces, the Cloud agent's machine and config, memories). They must not pop in one by one. Each part reports `useEditorLoad(loading)` (`EditorLoadGate.tsx`); the gate keeps the form mounted but hidden under one skeleton until none is loading, then reveals it and stays revealed (10 s timeout so a stuck part cannot trap the form). Hooks expose a derived `initialLoading` (keyed by agent id, so the first render already knows) rather than an effect-set flag. Parts that only needed the agent (`CloudAgentAccess`, `CloudAgentModel`) take it from the page instead of fetching it again. New async parts of the form must call `useEditorLoad`.

## One boot loader

The loader uses `OverlayMark motion="look"`, never an opacity or size pulse.
Reduced motion disables eye motion and the workspace spinner; entrance elements
settle immediately, with the workspace status text remaining visible.
The brand entrance (mark fade + word reveal) is claimed once per boot through
`createBootEntranceClaim` in `src/components/layout/boot-loader-state.ts`:
the first loader to mount plays it and records it played, so every later gate
renders the settled screen and the word never re-reveals. The loader is also
always the first paint: `WorkspaceHydrationBoundary` only treats 'idle' as
decided once the auth check has resolved (guests settle there; a session user
enables workspaces after first paint), so children stay gated until status is
'ready' and the app can never paint before the loader. The wordmark uses Libre
Baskerville Regular. The loader is boot-only:
once the app has rendered real content, `bootAppShown` is marked
module-wide, so `WorkspaceHydrationBoundary` remounts (workspace switches)
can never re-gate and `InitialAppLoading`/`AppShellLoadingFallback` swap to
the work-route skeleton. Post-boot navigation must never show the brand
screen again.

## Brand lockup

Tool, reasoning, worked-for, trace, confirmation and approval rows are logo-free. Active assistant responses show one 24px `OverlayMark motion="look"` below the complete output, and the mark disappears when the response settles. Only its eyes move. `ChatExchange` suppresses the generic inline Markdown marker, which remains available to other consumers.

`BrandLockup` (`src/components/brand/BrandLockup.tsx`, re-exported from `@overlay/ui`) is the canonical "Overlay" wordmark: the O-with-eyes `OverlayMark` followed by "verlay" in Libre Baskerville Regular. Size it with `font-size`. Shared styles in `packages/overlay-ui/src/styles.css` use a `0.86em` mark, a `0.043em` gap and a `0.045em` baseline translation. The word sits inside the overflow-hidden `.brand-lockup-mask` so the boot entrance can reveal it from behind the mark. Use the shared component for loader, auth, marketing and shell branding rather than composing a separate mark and full word.

App startup renders a single loading screen wherever the shell is still resolving: `AppBootLoader` (`src/components/layout/AppBootLoader.tsx`) behind `InitialAppLoading`/`AppShellLoadingFallback`, the `/` entry fallback, and the workspace-hydration gate (`WorkspaceAppBoundary`, which renders it `settled` so the handoff shows no second splash). It renders `BrandLockup` at `24px`; the mark fades in, the word reveals from behind it, the eyes look around without pulsing the lockup, with the "Opening workspace..." line beneath on the same screen. The reveal plays once per boot; later mounts render the settled screen.

## Avatar colors

The avatar picker offers the preset swatches plus a rainbow swatch that opens `AvatarColorPicker` (saturation/brightness square, hue strip, hex field; no opacity; helpers in `features/agents/lib/color-utils.ts`). Colors are stored as six-digit lowercase hex; the server accepts any such value.

## Shared tabs

The TabsList/TabButton compatibility API derives the Radix root selection from
the caller’s active prop, including external selection changes. Arrow/Home/End
keys move focus and skip disabled tabs; Enter/Space activate through the existing
click callback. Keep manual activation and one owner for selected styling.
Run `node scripts/qa/tabs-interactions.mjs` for real-browser regressions; it accepts
`OVERLAY_QA_BROWSER_EXECUTABLE` like the dialog harness.

## Marketing FAQ and page metadata

Every public marketing page renders inside `StaticMarketingShell` (landing nav, hairline-framed column, footer) and opens with `MarketingPageHead`; page blocks come from `landing.css` (`.sec`, `.h1`, `.lead`, `.btn`), so new pages match the home page without their own theme.
The landing FAQ uses the shadcn `Accordion` (`@overlay/ui/primitives`, single open item, collapsible) near the end of the static home page.
Its visible answers and FAQ structured data share one source; describe available
capabilities only. Public marketing pages define their own canonical paths so
they do not inherit the root homepage canonical.


## Chat titles and new-agent startup

Title events update the header, sidebar and list cache together. Optimistic list
updates must preserve a known title when an incoming value is a placeholder.
Agent threads generate a title from their first human message and preserve custom
names. Title generation uses Auto's free routes with one shared 12-second provider
deadline across server attempts; caller cancellation aborts generation too.

After agent creation, carry its instructions to the new conversation as one pending
user message. Consume it only when the human and expected solo agent are loaded;
expire it after 60 seconds. Use the static greeting only for empty instructions.
Agent-created automations also appear in Automations with the owning creature
avatar. Sidebar rows without a conversation open the automation itself.

## Chat AI primitives (`@overlay/ui/ai`)

Chat surfaces build on shadcn AI Elements primitives copied into `packages/overlay-ui/src/components/ui` and exported from `@overlay/ui/ai` (kept out of the main barrel so Shiki only loads where chat renders): `Message`, `Bubble`, `Trace`, `CodeBlock` (+ `useHighlightedCode`, Shiki JS engine, GitHub light/dark themes that presets never tint), `MessageScroller` (`@shadcn/react`), `Item`, `InputGroup`, `Attachment`, `HoverCard`, `Collapsible`, `Spinner`. Upstream semantic classes are rewritten to Overlay variables (`bg-(--surface-subtle)`, `text-(--muted)`, `text-(--danger)`); `--muted` is a text color here, so never add a `--color-muted` theme alias. Trace rows are text-only; `TraceMark`, `ToolLineLogo` and `ToolLogoColumn` remain empty compatibility exports. Running titles may shimmer (CSS in `styles.css`, off under reduced motion). The one active-response mark is 24px and sits after all assistant output.

Visual rules for these and every new component:

1. **Flat surfaces.** No resting borders or rings on cards, code blocks, chips, buttons, approval items, popovers or sidebars. Surfaces differ by fill only (page, sidebar, subtle, elevated). The shared composer is the exception: a subtle 1px `--border` outline separates its elevated fill from the page in both themes. Floating layers keep a soft shadow. Focus rings stay for keyboard focus; destructive states tint the fill.
2. **Solid headers, no blur.** Page and sidebar headers use the same fill as the surface below them, with no divider and no backdrop blur.
3. **One model selector.** Model menus render `ModelSelector` from `@overlay/chat-react`: Text / Image / Video at the top, a filled search field, then a provider rail (Favorites star, then one `ProviderLogo` per provider) beside the list grouped by provider. Rows read logo, name, favorite star, selected check, capability chips. Search collapses to one flat list. Free-tier Auto stays pinned on top. Favorites are per browser (`overlay:favorite-models`) and survive blocked storage in memory.
   Personal Chat has no separate Chat/Work selector; the backend selects its durable execution engine from reported capability.
4. **One Prompt Input.** Every chat composer is built from `PromptInput` parts in `@overlay/chat-react` (`PromptInputBody`, `PromptInputFooter`, `PromptInputTools`, `PromptInputButton`, `PromptInputSubmit`). Footer order: +, @, optional /, tool chips, model controls, submit (ArrowUp, spinner while submitted, stop while streaming). In web chat the model button lives in the composer, not the header.

## Streamed agent replies

Agent reply placeholders hand their local row identity to the first matching new
server reply (same agent and thread). Preserve that identity through later snapshots
and use it for both transcript and thread-panel keys; nested message components
must not add a second key that remounts the reply. Unanswered placeholders expire.
The agent details sidebar has its own Close button, wired to the same saved open
state as the thread header toggle; closing either way must allow reopening there.

Markdown table cells wrap long identifiers and hashes without changing their text.
Keep horizontal scrolling for genuinely wide tables with many columns; a single
unbroken value must not force an otherwise narrow table beyond the chat pane.

Render streamed text as complete formatted chunks. Markdown defaults to paragraph
blocks plus a shimmed in-flight tail, with no per-character pacing or character
spans. Room/agent transcripts suppress inline markers and keep one 24px
`OverlayMark motion="look"` at the bottom throughout the run, including while
tools are working.

Keep the message action rail visible whenever it offers Stop. An active reply's
Stop control must not require hovering the message; completed messages retain
the usual hover/focus behavior.

Cancelled replies use the plain notice “This response was interrupted. Should I continue?”; historical standalone interruption markers normalize to the same sentence. If persisted content already contains the notice, local interrupted state must not duplicate it in the transcript, reply text or copied text. Failed/recoverable remote replies keep their earlier narrative visible. Only tool details fold; stopping must not make the written answer appear to disappear behind the work summary.
Cancelled remote replies show a small status label even when no text was produced
and the viewer cannot control the run. History serialization retains status and other metadata alongside legacy text fallback, so reload preserves this label and any partial answer.

A native terminal detail shares its command's call key. Both live tool groups and the completed Worked summary count that action once, even across separate timeline groups, while retaining both the command and terminal output, with distinct React row keys. Single-action labels stay singular for failed and cancelled actions too. Mixed groups show the total unique calls and the number actually running, even when an earlier action failed or was interrupted. Completed calls never inflate the running count.

While a turn continues, an attached terminal detail follows its command's resolved state even if the retained attachment still says running. Match by call key regardless of part order; unrelated running commands and standalone terminal details remain live.
The liveness status uses only the first command line, capped at 96 Unicode code points. Full command bodies remain in collapsed tool details so a long script cannot crowd out the answer, deadline or recovery state.

## Provider models and connection cards

Agent creation and editing share the chat model picker, with workspace entitlements
restricting runnable models. Unresolved access stays on the free choices; the paid
new-agent default is GLM 5.3 Flash. Chat may show locked premium choices for upgrade
discovery while retaining its send-time access checks.

Markdown Connect cards use the integration logo and current connection state. Only
replace their original URL with an OAuth button when integrations are enabled and
the service name resolves to a supported connector. Otherwise keep the link usable.
Refresh connection state on window focus after an OAuth tab returns. Inline provider
marks use monochrome foreground paths; discard filled export backgrounds.

## Native desktop surfaces

Desktop controls are capability-gated through the shared desktop bridge. Use the
existing settings rows and UI primitives. Reserve traffic-light space only when
the bridge marks the document; header buttons and links remain non-draggable.
Chat/notes `surface=panel` uses the compact desktop layout with the same providers
and permission boundaries. See [Desktop web shell](desktop-web-shell.md).

Agent questions use `QuestionnairePanel`, and agent plans use `RunPlan` on the
`Trace` primitives. A plan shows at the end of a response in normal flow, not pinned
to the screen. Once the response has ended with every step finished or skipped, it
moves into the "Worked for" dropdown above the work timeline; an unfinished plan
stays visible. Don't use `Questionnaire.Input` in
an item that also has choices: `@shadcn/react` 0.3.1 hits React's update limit and
crashes in the browser, though not in server-rendered tests. `QuestionnairePanel`
works around this with a hidden choice beside a normal input.

Agent Computer cards stack their desktop/control actions above secondary power and
delete controls so narrow editor panels remain usable. Pass the current operator ID
through every card entry point so taking control identifies the viewer correctly. User document chips derive from persisted attachment
metadata or the indexed-document marker even when structured text parts take priority
for the displayed message body.

## Subscription provider marks

Subscription rows use the shared `ProviderLogo` SVG renderer. Resolve `meta-llama`
to the canonical Meta mark and render the bundled Devin mark in its original
425-unit viewBox with `currentColor`, so both themes retain the real logo. New
connections offer six providers with one Kimi choice using `kimi.com`; reconnect
shows only the connection's exact saved provider.

## Composer submission timing

Native-agent and room composers, including thread replies, clear text and submitted
attachments when the optimistic user bubble is inserted, before the save request
finishes. Admission rejection leaves the draft intact. A failed save restores the
submitted draft only if the same conversation/thread scope still has the untouched
empty draft. An editor value-sync that refreshes an empty mentions list is not
a user edit; typing, adding attachments or leaving/reopening the scope protects
the newer draft. Late acknowledgements never clear edits made after submission.
