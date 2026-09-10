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

## Editors save explicitly — no autosave, no save bar

The agent editor reverted from instant-save after review: edits persist only
on an explicit **Save changes** (edit mode) or **Create agent** (new mode),
with **Cancel** discarding back to the loaded agent and closing. No sticky
glassmorphic footer bars anywhere — buttons sit in-flow at the end of the
form. Rationale: agent identity edits are consequential (instructions, tools,
access) and users want to review the whole form before anything persists.
