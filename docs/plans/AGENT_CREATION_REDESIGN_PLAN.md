# Agent creation redesign

Status: mockup stage. Nothing in `src/` changes until the design is approved. Mockup: `artifacts/agent-create-panel.html` (gitignored; open it in a browser).

## Goal

Creating an agent should take two fields and one button. Anything a person does not need to decide on day one is collapsed and has a good default.

## Today

`AgentEditorForm.tsx` (1,125 lines) shows agent type, harness, environment, instructions, model, every tool group with toggles, computer size, access, and channels on one page. Most of it is configuration, not a decision.

## New flow

A small dialog, Overlay agents only (creating agents on Overlay Cloud is disabled until it is rebuilt on Box/E2B):

1. **Avatar and name.** One row. The creature and colour are picked for the person; clicking the avatar reshuffles it.
2. **What should it do?** One textarea. This is the agent's instructions. Required.
3. **Advanced** (collapsed). The header summarises the current choices, for example "Auto model · Standard tools · Only me", so nothing is hidden without a hint. Inside: model, tools, access.
4. **Create agent.** Disabled until name and instructions are filled in.

### What goes in Advanced

| Setting | Default | Notes |
| --- | --- | --- |
| Model | Auto | Same `getModelsByIntelligence` ordering as the chat picker. |
| Tools | Standard set: memory, knowledge, files, web search, notes. | Presets first ("Standard", "Read only", "Everything"); the per-group toggles sit one level further in. Computer and Browser stay off until asked for. |
| Access | Only me | "Everyone in this workspace" is one click away. |

Moved out of creation, still available after the agent exists: Reachable on (Slack), Memories, Danger zone, computer size and lifecycle. The edit page keeps these; creation does not.

## Mapping to existing code

- `buildWorkspaceAgentInput` already takes everything the dialog needs; the dialog just supplies defaults for what it hides (`enabledToolGroups`, `visibility`, `modelId`, avatar).
- Defaults live in one place (`DEFAULT_NEW_AGENT_TOOL_GROUPS`, new, in `src/shared/agents/tool-groups.ts`) so the dialog and the API agree.
- `isAgentEditorValid` stays the save gate.
- The dialog reuses `Creature`, `Toggle`, `ListboxSelect` and `OptionRow` from the existing chrome. No new dependencies.

## Later (not in this change)

- Other-agent support, rebuilt from the ground up for both subcategories: on Overlay Cloud (Box, E2B) and on your machine. It enters this dialog as a quiet second option under the form ("Connect an agent you already run"), not as a type picker up front.
- A first-message prompt after creation ("Say hello to Scout") instead of dropping the person on a settings page.

## Open questions

- Should name be optional, with the name generated from the instructions? Fewer fields, but a worse default for rooms and mentions.
- Should "Standard tools" include web search by default? It costs money per call.
