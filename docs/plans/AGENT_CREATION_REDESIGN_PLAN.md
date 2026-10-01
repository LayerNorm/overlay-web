# Agent creation redesign

Status: mockup stage. Nothing in `src/` changes until the design is approved. Mockup: `artifacts/agent-create-panel.html` (gitignored; open it in a browser).

## Goal

Creating an agent should take two fields and one button. Anything a person does not need to decide on day one is collapsed and has a good default.

## Today

`AgentEditorForm.tsx` (1,125 lines) shows agent type, harness, environment, instructions, model, every tool group with toggles, computer size, access, and channels on one page. Most of it is configuration, not a decision.

## New flow

A small dialog. The first control is the agent type, as three stacked option rows (the app's `OptionRow`, never a side-by-side grid):

- **Overlay agent**
- Other agents, under a small group label:
  - **On Overlay Cloud** (Claude Code, Codex, Hermes in a sandbox we host)
  - **On your machine** (the same agents on your computer or server, connected out to Overlay)

Everything below the type changes with it. Avatar and name are always shown, and the name is required.

### Overlay agent

1. **Avatar and name.** The creature and colour are picked for the person; clicking the avatar reshuffles it.
2. **What should it do?** One textarea. This is the agent's instructions. Required.
3. **Advanced** (collapsed). The header summarises the current choices, for example "Auto · Standard tools · Only me". Inside:
   - **Model** uses the shared `ListboxSelect`, not a native select, ordered by `CHAT_MODEL_QUALITY_PRIORITY` with Auto first.
   - **Tools** has presets (Standard / Read only / Everything), and every tool group is listed with its toggle straight away. Nothing sits behind a "customize" link.
   - **Access**: Only me (default) or Everyone in this workspace.
4. **Create agent**, disabled until name and instructions are filled in.

The Computer row is stacked: description, then the toggle below it, then (when on) the size `ListboxSelect` and the "created when you save" note.

### Other agent: on Overlay Cloud

Agent (`ListboxSelect`: Claude Code, Codex, Hermes), Size, and Advanced (Access). Instructions are generated from the agent, as for connected agents today. Blocked until the Box/E2B rebuild lands; the dialog row stays hidden until then.

### Other agent: on your machine

Agent, then the one-line connect command with a copy button and a "Waiting for the machine to connect…" state, then Advanced (Access). The button reads "Create and connect".

### Defaults

| Setting | Default | Notes |
| --- | --- | --- |
| Model | Auto | |
| Tools | Standard: memory, knowledge, files, notes, web search | Computer and Browser stay off until asked for. Web search is on because it no longer costs per call (Exa-style search API). |
| Access | Only me | |

Moved out of creation, still available after the agent exists: Reachable on (Slack), Memories, Danger zone, computer lifecycle.

## Mapping to existing code

- `buildWorkspaceAgentInput` already takes everything the dialog needs; the dialog just supplies defaults for what it hides (`enabledToolGroups`, `visibility`, `modelId`, avatar).
- Defaults live in one place (`DEFAULT_NEW_AGENT_TOOL_GROUPS`, new, in `src/shared/agents/tool-groups.ts`) so the dialog and the API agree.
- `isAgentEditorValid` stays the save gate.
- The dialog reuses `Creature`, `Toggle`, `ListboxSelect` and `OptionRow` from the existing chrome. No new dependencies.

## Later (not in this change)

- Other-agent support, rebuilt from the ground up for both subcategories (Overlay Cloud on Box/E2B, and on your machine). Until then the Overlay Cloud row is not shown.
- A first-message prompt after creation ("Say hello to Scout") instead of dropping the person on a settings page.

## Decisions

- Name stays required (rooms and mentions depend on it).
- Web search is in the default tool set.
- Tools are listed, not hidden behind a link.
- All dropdowns use `ListboxSelect`.
