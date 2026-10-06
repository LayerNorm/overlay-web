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

## The secondary panel: Personal, Workspace, Archived

Chats, Files, Extensions, Automations, and Agents share one panel anatomy (see
`docs/plans/UNIFIED_SCOPES_PLAN.md`): page title, then the scope rows, then
New + search, then the list. New is never above the scope rows.

- **Scope rows** are Personal (mine within this workspace), Workspace (shared
  with its members), and Archived (what was archived from either, tagged
  Personal or Workspace). Built by `buildScopedPanelNav`
  (`src/components/layout/sidebar/scopedPanelNav.ts`); the selected scope opens
  its page's sub-rows beneath it (Files: All/Notes/Files/Outputs; Chats →
  Workspace: Direct Messages/Channels/Activity; Extensions: Connectors/Skills/
  MCPs/Apps). Archived has no sub-rows; its list is flat and tagged.
- **One scope across pages.** The URL carries `?scope=` (Personal is the
  default and stays out of the URL); the last choice is remembered
  (`overlay:panel-scope` in local storage) so the next page opens on it. Read it
  with `usePanelScope()`; never keep a second copy. Chats derive their scope from
  the subview route instead (DMs, channels, activity are Workspace).
- **New follows the scope.** `scopePanelAction` hides New in Archived and, in
  Workspace, when the person may not create there (the workspace's admin
  settings; owners and admins always may). In Workspace it reads "… in
  workspace". Create flows send `scope: 'workspace'` only for Workspace
  (`newItemScope`); Personal is what an absent scope means.
- **Archived rows** (`ArchivedScopeList`) show a Personal/Workspace tag and a
  restore button on hover; restoring returns the item to where it came from.

## Expandable rows are not indented

What an expansion reveals (a scope's sub-rows, an agent's threads, a section's pages) lines up with the row that opened
it: same left edge, no extra left padding or margin. A chevron on the parent and a smaller type size are what mark the
children as nested. Hierarchies that are real trees (the files folder tree) are the exception, because depth is the
content there. `InlineNavChildren` enforces this and its test fails on any `pl-*` or `ml-*` in the nested rows; new
expandable components follow the same rule.
