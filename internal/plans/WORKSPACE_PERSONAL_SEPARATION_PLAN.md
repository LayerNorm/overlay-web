# Workspace and Personal separation

Status: P1 implemented on `codex/memory-follows-place` (not merged or deployed; the production backfill has not run). P2–P7 proposed.

| Phase | State |
|---|---|
| P1 Memories follow the place | Implemented, tested locally; awaiting preview QA, merge, deploy and the one-time `moveAgentMemoriesToTheirPlaceByServer` run |
| P2–P7 | Not started |

## The model

1. **Everything belongs to exactly one place.** Each resource is Workspace (every member can read it) or Personal (only its owner can). Nothing is half of each.
2. **Workspace is the default.** Things made in the normal app or in a shared place are Workspace. Personal is a deliberate choice, always labeled.
3. **Overlap is one-way.** A personal context (your private chat, your Slack DM with Overlay) reads Workspace plus your Personal. A workspace context (shared chat, Slack channel, workspace automation) reads Workspace only, whoever asks.
4. **Personal → Workspace only by your own action.** "Move to workspace" on the item. No agent asks mid-answer, no standing permissions. Workspace → Personal is not offered: once others may rely on something, one person shouldn't be able to take it away.

## What exists today

One scope engine (`src/shared/workspaces/resource-scope.ts`, `convex/lib/resourceScope.ts`) already gives files, skills, MCP servers, connectors, automations and work items a `scope` of `personal` or `workspace`, with a move endpoint (`POST /api/v1/scope`). The shared-room rule (`src/shared/agents/room-access.ts`) withholds the asker's personal memory, files and skills in rooms others can read. The gaps are defaults, direction and the resources outside the engine.

| Resource | Today | Gap |
|---|---|---|
| Memories | Own `visibility` field; people's are private, agents' shared | A workspace agent in a 1:1 chat reads private context and saves into shared agent memory; creator-only agents' memories are recalled workspace-wide |
| Files, notes, outputs | Scope engine, default Personal | Default; file search chunks are keyed to the uploader, so workspace files aren't searchable by other members |
| Chats | `conversationType` decides access; `scope` is only a sidebar label | Two meanings of "scope" in one field |
| Agents | `visibility: creator \| workspace`, default Workspace | Separate field from the engine; can be flipped both ways |
| Skills, automations | Scope engine, default Personal | Default; workspace automations run with the creator's personal reach; moving an automation doesn't re-check its agent |
| Connectors | Scope engine, default Personal | Moving the row doesn't move the account: credentials stay the person's |
| MCP servers | Scope engine, default Personal | Moving shares the creator's stored token with everyone |
| Provider keys and subscriptions | Own `scope`; keys personal only | No shared-room check on whose key a shared turn spends |
| Computers | `ownerType: user \| agent` | Workspace owner can see a personal Overlay's computer |
| Artifacts | Scope engine; forced Workspace in shared rooms | Fine |

## Phases

**P1 — Memories follow the place, not the agent.** A memory saved in a personal context is private to the person; one saved in a workspace context is workspace knowledge, whichever agent saves it. This replaces "agents' memories are shared" (`agent-memory.ts`) and closes the workspace-agent-in-a-1:1 leak. Creator-only agents' memories are recalled only by their creator. Settings → Memories gets "Move to workspace".

As built: `memoryOwnerForPlace` decides for tool saves (by shared room), reply extraction (by the room's audience, in Convex) and automations (by automation scope). Human messages in a shared room still become the person's private memories. Moves go through `knowledge/memories:moveToWorkspace` only; `update` can no longer change visibility. Untested so far: a hosted preview run of a 1:1 save, a channel save and the Settings move.

**P2 — Workspace by default.** New files, notes, skills and automations created in the normal app default to Workspace; Personal is a visible choice in the create flow and a label on the item. Chats keep their type, and the sidebar label stops using `scope` (rename to what it is).

**P3 — One-way moves.** The scope engine allows Personal → Workspace only. Agents' `visibility` joins the same rule. Moving an automation re-checks that its agent and connectors are workspace-visible.

**P4 — Credentials move honestly.** Moving a connector or MCP server to Workspace asks the person to reconnect it as a workspace account (held by the workspace entity), never silently sharing their own token. Until reconnected it stays Personal.

**P5 — Workspace runs use workspace reach.** Workspace automations and turns in shared rooms use workspace connectors and the workspace's provider budget, not the creator's or asker's personal keys and accounts.

**P6 — Workspace knowledge is searchable by everyone.** Workspace files are indexed once for the workspace, so any member's chats can search them. This is what makes "personal reads workspace" real.

**P7 — Decide the personal Overlay.** With P1–P6 in place, check whether a separate personal agent still earns its keep, or whether one Overlay per workspace plus personal chats is simpler.

## Order and risk

P1 first, it is the remaining privacy leak. P3 and P4 next: small, and they close sharing mistakes. P2 changes defaults people see, so it ships with the Personal label in the UI. P5 and P6 are larger and can follow. Each phase updates its living docs and this plan's status; existing rows are migrated, not given fallbacks.

## Not decided

- Whether guests see anything Workspace-scoped (today they don't).
