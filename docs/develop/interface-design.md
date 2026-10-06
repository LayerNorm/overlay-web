---
title: "Interface Design"
description: "Product UI decisions every surface follows: toggles-only controls, one-control-per-row layouts, and editors without save bars."
---

# Overlay interface design

Product UI decisions that every surface follows. When a new control is needed,
check here first — the answer is usually "use the existing pattern".

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

## The secondary panel: Personal, Workspace

Chats, Files, Extensions, Automations, and Agents share one panel anatomy (see
`docs/plans/UNIFIED_SCOPES_PLAN.md`): page title, then the scope rows, then
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


## Expandable rows are not indented

What an expansion reveals (a scope's sub-rows, an agent's threads, a section's pages) lines up with the row that opened
it: same left edge, no extra left padding or margin. A chevron on the parent and a smaller type size are what mark the
children as nested. Hierarchies that are real trees (the files folder tree) are the exception, because depth is the
content there. `InlineNavChildren` enforces this and its test fails on any `pl-*` or `ml-*` in the nested rows; new
expandable components follow the same rule.

## Agent settings load together

The agent settings (`AgentEditorPage`) have several independent loaders (the agent, its connection and environments, its computer, reachability surfaces, the Cloud agent's machine and config, memories). They must not pop in one by one. Each part reports `useEditorLoad(loading)` (`EditorLoadGate.tsx`); the gate keeps the form mounted but hidden under one skeleton until none is loading, then reveals it and stays revealed (10 s timeout so a stuck part cannot trap the form). Hooks expose a derived `initialLoading` (keyed by agent id, so the first render already knows) rather than an effect-set flag. Parts that only needed the agent (`CloudAgentAccess`, `CloudAgentModel`) take it from the page instead of fetching it again. New async parts of the form must call `useEditorLoad`.

## Avatar colors

The avatar picker offers the preset swatches plus a rainbow swatch that opens `AvatarColorPicker` (saturation/brightness square, hue strip, hex field; no opacity; helpers in `features/agents/lib/color-utils.ts`). Colors are stored as six-digit lowercase hex; the server accepts any such value.
