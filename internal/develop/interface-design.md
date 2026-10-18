---
title: "Interface Design"
description: "Product UI decisions every surface follows: toggles-only controls, one-control-per-row layouts, and editors without save bars."
---

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
choices. Each control saves for the next turn. Known permission modes use compact labels
Manual, Edits, Plan, Auto and Bypass; local Bypass requires the shared confirmation dialog.
An identity edit must not overwrite choices saved through these independent controls.
Older combined model/effort ids resolve to separate live controls only when both choices
are advertised. Show the effective effort, preserve it when changing models, and leave
unsupported choices visibly marked; never replace them with discovery defaults.

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

## Primitive style resets

When migrating a control while preserving its existing visual contract, import
`unstyledButton`, `unstyledInput`, or `unstyledTextarea` from
`@overlay/ui/control-reset`. Apply the helper at the existing control so local
classes and native semantics remain explicit.

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

The Work page (`src/features/work/`) follows the existing patterns and adds a few of its own:

- **One page, three views.** List, Board and Timeline show the same tasks. Scope (`?scope=`), view (`?view=`), filter
  (`?filter=`) and the open task (`?task=`) live in the URL, so a link opens where it was copied and Back closes a task.
  A task link opens in the scope the task lives in.
- **Edit in place, save at once.** There are no save bars. Every change appears immediately, is confirmed by the
  server's answer, and rolls back with a plain message in an inline alert if the server refuses.
- **The task panel is a docked right panel** (`AppScreenSidePanel`), not a modal. Escape closes it unless a picker or a
  text field has it first.
- **Pickers are small floating menus** (`FloatingMenu`) with a section label, the options, and a check on the current
  one. Status, owner, reviewer, priority and parent all use the same `Picker` in `WorkPickers.tsx`.
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

## Avatars are edited in place

The agent avatar is a button: hover shows a pencil, click opens
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

The default shell is one shadcn sidebar (`src/components/layout/sidebar/UnifiedSidebar.tsx`): the brand, search and
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

Reduced motion disables the lockup pulse and workspace spinner; entrance elements
settle immediately, with the workspace status text remaining visible.
Pulse instances share their first document-timeline start time, applied before
paint, so replacing a loading boundary preserves opacity and never restarts the
800 ms pulse delay. Keep this clock shared by animated and settled instances.

App startup renders a single loading screen wherever the shell is still resolving: `AppBootLoader` (`src/components/layout/AppBootLoader.tsx`) behind `InitialAppLoading`/`AppShellLoadingFallback`, the `/` entry fallback, and the workspace-hydration gate (`WorkspaceAppBoundary`, which renders it `settled` so the handoff shows no second splash). The mark fades in, the word reveals from behind it, then the whole lockup breathes with the same opacity-only pulse as the chat stream marker (`appBrandLoaderPulse` in `globals.css`), with the "Opening workspace…" line beneath on the same screen. The orb rests on the wordmark's text baseline (`margin-top: -1px` on `.app-brand-loader-logo`); landing lockups do the same via `align-items: baseline` on `.lp .lockup`.

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

The landing FAQ uses native details/summary disclosures after the scroll story.
Its visible answers and FAQ structured data share one source; describe available
capabilities only. Public marketing pages define their own canonical paths so
they do not inherit the root homepage canonical.


## Streamed agent replies

Markdown table cells wrap long identifiers and hashes without changing their text.
Keep horizontal scrolling for genuinely wide tables with many columns; a single
unbroken value must not force an otherwise narrow table beyond the chat pane.

Render streamed text as complete formatted chunks. Markdown defaults to paragraph
blocks plus a shimmed in-flight tail, with no per-character pacing or character
spans. Room/agent transcripts suppress inline markers and keep one loading-dots
row at the bottom throughout the run, including while tools are working.

Keep the message action rail visible whenever it offers Stop. An active reply's
Stop control must not require hovering the message; completed messages retain
the usual hover/focus behavior.

Cancelled and failed/recoverable remote replies keep their earlier narrative visible. Only tool details fold; stopping must not make the written answer appear to disappear behind the work summary.
Cancelled remote replies show a small status label even when no text was produced
and the viewer cannot control the run. History serialization retains status and other metadata alongside legacy text fallback, so reload preserves this label and any partial answer.

A native terminal detail shares its command's call key. Both live tool groups and the completed Worked summary count that action once, even across separate timeline groups, while retaining both the command and terminal output, with distinct React row keys. Single-action labels stay singular for failed and cancelled actions too. Mixed groups show the total unique calls and the number actually running, even when an earlier action failed or was interrupted. Completed calls never inflate the running count.

While a turn continues, an attached terminal detail follows its command's resolved state even if the retained attachment still says running. Match by call key regardless of part order; unrelated running commands and standalone terminal details remain live.
The liveness status uses only the first command line, capped at 96 Unicode code points. Full command bodies remain in collapsed tool details so a long script cannot crowd out the answer, deadline or recovery state.
