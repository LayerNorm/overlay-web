# Agent creation redesign

Status: shipped for Overlay agents (`NewAgentDialog`, `AgentAvatarPicker`, `InfoTip`). "Other agent" is visible but disabled until other-agent support is rebuilt. Mockup: `artifacts/agent-create-panel.html` (local, gitignored).

## Goal

Creating an agent should take two fields and one button. Anything a person does not need to decide on day one is collapsed and has a good default.

## Today

`AgentEditorForm.tsx` (1,125 lines) shows agent type, harness, environment, instructions, model, every tool group with toggles, computer size, access, and channels on one page. Most of it is configuration, not a decision.

## New flow

One small dialog, one column, top to bottom:

1. **Avatar**, centred at the top. Hovering shows a pencil; clicking opens a popover with the eight creature shapes (`WORKSPACE_AGENT_CREATURE_SHAPES`) and a colour row. The shape grid previews each body in the current colour.
2. **Name** (required).
3. **Description**. Overlay agents use it as their instructions (required for them).
4. **Type**: segmented *Overlay agent | Other agent*. Overlay agent is the default.
5. If **Overlay agent**:
   1. **Computer**: a bordered row with a toggle, off by default. A computer is a provisioned resource, so it needs explicit enablement and is not in the tool list. On reveals a size `ListboxSelect`.
   2. **Access**: segmented *Only me | Everyone in this workspace*.
   3. **Advanced** (collapsed; header reads e.g. "Auto · All tools"): **Model** (`ListboxSelect`, `CHAT_MODEL_QUALITY_PRIORITY`, Auto first) and **Tools** (presets Everything / Standard / Read only, then every tool group as a label and a toggle).
6. If **Other agent**:
   1. **Agent**: `ListboxSelect` of Claude Code, Codex, Hermes.
   2. **Runs on**: segmented *Overlay Cloud | Your machine*.
   3. **Computer config**: Overlay Cloud shows the sandbox size `ListboxSelect`; Your machine shows the one-line connect command with a copy button and "Waiting for the machine…".
   4. **Access**.
7. Footer: Cancel, then **Create agent** ("Create and connect" for Your machine), disabled until the required fields are filled.

### Copy

No hint lines in the dialog. Labels are one or two words. Anything that needs explaining gets a small Lucide `Info` icon after the label that shows the text on hover or keyboard focus (Description, Type, Runs on, Computer, Connect, Access).

### Defaults

| Setting | Default | Notes |
| --- | --- | --- |
| Model | Auto | |
| Tools | Everything | Every tool group is on, except Computer, which is its own explicit row. Web search is on because it no longer costs per call. |
| Computer | Off | Explicit opt-in. |
| Access | Only me | |

Moved out of creation, still available after the agent exists: Reachable on (Slack), Memories, Danger zone, computer lifecycle.

## Mapping to existing code

- `buildWorkspaceAgentInput` already takes everything the dialog needs; the dialog just supplies defaults for what it hides (`enabledToolGroups`, `visibility`, `modelId`, avatar).
- Tool presets live in `AGENT_TOOL_PRESETS` / `agentToolPresetFor` in `src/shared/agents/tool-groups.ts`; Everything is `DEFAULT_AGENT_TOOL_GROUP_IDS`.
- The dialog's save gate is `isNewAgentDraftValid`; the full editor keeps `isAgentEditorValid`.
- The create-first flow ("Untitled agent" created on click, archived on cancel) is removed.
- The dialog reuses `Creature`, `Toggle` and `ListboxSelect` from the existing chrome, and the app's tooltip primitive for the info icons. No new dependencies.
- The avatar popover writes `avatarShape` and `avatarColor`, which the API already stores. `AVATAR_COLORS` grows from 6 to 11 (white, brown, red, orange, amber, green, teal, blue, purple, pink, grey); the eye colour already adapts to light bodies.

## Later (not in this change)

- Other-agent support, rebuilt from the ground up for both subcategories (Overlay Cloud on Box/E2B, and on your machine). Until then the Overlay Cloud row is not shown.
- A first-message prompt after creation ("Say hello to Scout") instead of dropping the person on a settings page.

## Decisions

- Name stays required (rooms and mentions depend on it).
- Web search is in the default tool set.
- Tools are listed, not hidden behind a link.
- All dropdowns use `ListboxSelect`.
- Descriptive copy lives behind info icons, not in the layout.
- The avatar is edited in place (shape and colour); image generation and upload are not part of creation.
