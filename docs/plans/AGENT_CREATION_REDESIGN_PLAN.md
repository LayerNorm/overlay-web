# Agent creation redesign

Status: mockup stage. Nothing in `src/` changes until the design is approved. Mockup: `artifacts/agent-create-panel.html` (gitignored; open it in a browser).

## Goal

Creating an agent should take two fields and one button. Anything a person does not need to decide on day one is collapsed and has a good default.

## Today

`AgentEditorForm.tsx` (1,125 lines) shows agent type, harness, environment, instructions, model, every tool group with toggles, computer size, access, and channels on one page. Most of it is configuration, not a decision.

## New flow

A small dialog. The first question is **what** you are creating, then **where** it runs, never both at once:

- **Agent** is a `ListboxSelect` with two groups: *Overlay* (Overlay agent) and *Bring your own* (Claude Code, Codex, Hermes). A one-line hint sits under it. A dropdown scales as more agents are added.
- **Runs on** appears only for a bring-your-own agent: a two-option segmented control, *Overlay Cloud* or *Your machine*, with a hint line ("A sandbox we host. Nothing to set up." / "Your computer or server. It connects out to Overlay."). Same segmented style as Access, so there is one pattern for a short either/or.

Avatar and name are always shown, and the name is required. **Access** is always visible near the bottom (Only me by default).

### Overlay agent

1. **Avatar and name.** The creature and colour are picked for the person; clicking the avatar reshuffles it.
2. **What should it do?** One textarea. This is the agent's instructions. Required.
3. **Computer** (its own row, directly under the description, off by default). A computer is a provisioned resource, so it needs explicit enablement and is not part of the tool list. Turning it on reveals a size `ListboxSelect` in the same row; the machine is created on save.
4. **Access** (always visible, all agent types): Only me (default) or Everyone in this workspace.
5. **Advanced** (collapsed, Overlay agents only). The header summarises the current choices, for example "Auto · All tools". Inside:
   - **Model** uses the shared `ListboxSelect`, not a native select, ordered by `CHAT_MODEL_QUALITY_PRIORITY` with Auto first.
   - **Tools** has presets (Everything / Standard / Read only; Everything is the default), and every tool group is listed as a plain label with a toggle. Nothing sits behind a "customize" link; Computer is not in this list.
6. **Create agent**, disabled until name and instructions are filled in.

### Bring your own: Overlay Cloud

Agent, Runs on, name, Size (`ListboxSelect`), Access. Instructions are generated from the agent, as for connected agents today. Blocked until the Box/E2B rebuild lands; the "Overlay Cloud" option stays hidden until then.

### Bring your own: your machine

Agent, Runs on, name, then the one-line connect command with a copy button and a "Waiting for the machine to connect…" state, then Access. The button reads "Create and connect".

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
