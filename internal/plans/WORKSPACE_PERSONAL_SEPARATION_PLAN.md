# Workspace and Personal separation

Status: P1 merged (PR 616), deployed to production web and Convex on 2026-11-24, and its one-time move ran in production (192 agent memories moved to their person; a rerun moved none). The model below was revised on 2026-11-24 (one mode switch, a Personal Chief that lives only in Personal); P2–P3 merged (PR 617), deployed to production web and Convex on 2026-11-24, and their three one-time moves ran in production (37 shared chief copies retired, 13 threads handed to a chief their owner can open, 45 personal-agent seats removed from channels, 33 chiefs renamed; reruns found nothing left). P4–P5 merged (PR 620) and deployed to production web and Convex on 2026-11-25 (no data migration). P6–P7 merged (PR 621) and deployed to production web and Convex on 2026-11-25; the file chunk backfill ran in production (1,665 file chunks marked private, none in Workspace yet; a rerun changed none). Every phase of this plan has shipped; what remains is listed under "Not decided" and in `todos.md`.

| Phase | State |
|---|---|
| P1 Memories follow the place | Merged, deployed, migrated. Preview-tested for 1:1, channel and the Settings move; automations covered by unit tests only |
| P2 One mode switch | Merged (PR 617) and deployed. Preview-tested as owner and member: mode switch, Workspace default, light/dark, phone width |
| P3 The Personal Chief | Merged (PR 617), deployed, migrated in production; reruns clean. Preview-tested: chief created on first Personal visit, kept out of channel mentions. Slack DM routing to the Personal Chief covered by Convex tests only. The `hasPersonalOverlayByServer` shim was deleted on 2026-11-24 |
| P4 One-way moves | Merged (PR 620) and deployed. Preview-tested: notes, agents (editor move, reverse refused), automations moving with their agent, member view, dark and phone. An open note's header now offers Move and Archive too (it lost the note's creator and scope before) |
| P5 Credentials move honestly | Merged (PR 620) and deployed. Preview-tested: MCP move strips the sign-in and turns the server off. "Connect for workspace" for connectors and reconnecting a moved OAuth MCP server are covered by Convex tests only (need a live third-party sign-in) |
| P6 Workspace runs use workspace reach | Merged (PR 621) and deployed. Covered by unit and Convex tests; a live automation run could not be tried on the preview (its fresh backend has no model catalog grants, which automation turns enforce) |
| P7 Workspace files searchable by everyone | Merged (PR 621), deployed, backfilled in production. Preview-tested with two members: workspace note found by the other member, personal note not, found after a move, gone for others after archive |

## The model

1. **Two modes, one switch.** Each person works in Workspace mode or Personal mode. The switch sits in the primary sidebar and changes every section at once; Workspace is the default and the choice is remembered. Sections no longer have their own Personal | Workspace toggle.
2. **Personal lives inside each workspace.** It is the person's private corner of that workspace: their personal agents, files, notes, skills and automations, and their Personal Chief. It leaves with them if they leave the workspace and reads that workspace's knowledge, never another's.
3. **Everything belongs to exactly one mode.** What you create belongs to the mode you are in. Workspace mode lists what every member can see; Personal mode lists only your personal things.
4. **Overlap is one-way.** Personal agents can read workspace knowledge. Workspace agents, rooms, automations and other surfaces (Slack, Discord) never read anyone's Personal.
5. **Overlay is the workspace's Chief of Staff.** Each person's own chief is called "{Name}'s Chief" (renamable) and exists only in Personal: it is not listed in Workspace mode, cannot be mentioned in shared rooms and never answers in Slack or Discord.
6. **Personal is optional.** It is created the first time someone switches to it. A member who only talks to Overlay in Slack never needs it.
7. **Personal → Workspace only by your own action.** "Move to workspace" on the item, one-way.
8. **The workspace pays.** Personal mode spends the workspace's budget; per-person tracking and caps come later (`todos.md`).

Settings stay grouped into Personal and Workspace sections regardless of mode.

## What exists today

One scope engine (`src/shared/workspaces/resource-scope.ts`, `convex/lib/resourceScope.ts`) gives files, skills, MCP servers, connectors, automations and work items a `scope` of `personal` or `workspace`, with a move endpoint (`POST /api/v1/scope`). Each section's contextual panel has its own Personal | Workspace toggle (`ScopeToggle` in `@overlay/shell-react`), remembered as the panel scope. The shared-room rule (`src/shared/agents/room-access.ts`) withholds the asker's personal memory, files and skills in rooms others can read.

| Resource | Today | Gap |
|---|---|---|
| Mode | A toggle in each section's panel | Should be one switch in the primary sidebar, Workspace by default |
| Personal chief | `personal_chief`, named "Overlay", pinned beside the workspace Overlay | Two agents called Overlay; it should live only in Personal under its own name |
| Agents | "Personal" means agents you created, even workspace-visible ones | Should follow visibility: creator-only agents are Personal |
| Files, notes, outputs | Scope engine | File search chunks are keyed to the uploader, so workspace files aren't searchable by other members |
| Chats | `conversationType` decides access; `scope` is a sidebar label | Should be the mode the chat was started in |
| Skills, automations | Scope engine | Workspace automations run with the creator's personal reach; moving an automation doesn't re-check its agent |
| Connectors, MCP servers | Scope engine | Moving the row doesn't move the account; MCP moves share the creator's token |
| Provider keys and subscriptions | Own `scope`; keys personal only | No shared-room check on whose key a shared turn spends |
| Computers | `ownerType: user \| agent` | Workspace owner can see a personal chief's computer |
| Artifacts | Scope engine; forced Workspace in shared rooms | Fine |

## Phases

**P1 — Memories follow the place, not the agent.** Done. A memory saved in a personal context is private to the person; one saved in a workspace context is workspace knowledge. Creator-only agents' memories are recalled only by their creator. Settings → Memories has "Move to workspace".

As built: `memoryOwnerForPlace` decides for tool saves (by shared room) and reply extraction (by the same room lineage, in Convex). Automations, workspace ones included, remember privately for their owner because they still read the owner's private memories; P6 makes workspace automations workspace contexts. Human messages in a shared room still become the person's private memories. Moves go through `knowledge/memories:moveToWorkspace` only.

**P2 — One mode switch.** Move the Personal | Workspace choice from every section's panel into the primary sidebar, Workspace by default and remembered per person and workspace. Every section lists only the current mode's items, and what you create belongs to that mode. Chats belong to the mode they were started in; DMs and channels appear only in Workspace mode. Agents in Personal mode are creator-only agents, not "agents you created".

**P3 — The Personal Chief.** Rename `personal_chief` to "{Name}'s Chief" (renamable), list it only in Personal mode, and keep it out of workspace mentions, rooms and outside surfaces. "Overlay" is the workspace chief only. Personal and its chief are created the first time someone switches to Personal; existing personal chiefs are renamed, not recreated. Its computer is visible only to its person.

**P4 — One-way moves.** The scope engine allows Personal → Workspace only. Agents' `visibility` joins the same rule. Moving an automation re-checks that its agent and connectors are workspace-visible and offers to move a creator-only agent along.

**P5 — Credentials move honestly.** Moving a connector or MCP server to Workspace asks the person to connect it as a workspace account (held by the workspace), never silently sharing their own token. Until then it stays Personal.

As built (P4): `checkMoveResource` refuses `to: 'personal'` (`one_way`) for every resource, so `POST /api/v1/scope`, every `setScope` and Work's `update` scope change refuse it; the UI offers only Move to Workspace, on personal items, always through `MoveToWorkspaceDialog`. Agent `visibility` is one-way in `WorkspaceAgentService` and `collaboration/agents:updateByServer` (`WORKSPACE_AGENT_VISIBILITY_ONE_WAY`); only the creator moves a creator-only agent to the workspace, and it then joins every public channel (`convex/lib/agentVisibility.ts`, shared with create). Moving an automation re-checks its agent in a `beforeMove` hook of `scopeMutations`; `withAgent: true` moves the creator's private agent in the same mutation (`automation_agent_personal` / `_not_yours` / `_chief` otherwise). Automations have no connector fields, so connectors are not re-checked; the dialog says runs use workspace accounts and budget, which P6 makes true. Work's move-to-Personal link cleanup was deleted.

As built (P5): connectors refuse every move (`connector_reconnect_for_workspace`); in Personal a connected connector offers Connect for workspace (the existing `scope: 'workspace'` account flow). Moving an MCP server strips its credentials in the move's own mutation (`workspaceMoveCredentialPatch`: tokens, `authConfig`, `encryptedAuthConfig`; keeps the OAuth client registration; bumps `oauthTokenVersion`; OAuth servers become `pending`; servers that had credentials are turned off). Connecting a `pending` server turns it back on. Workspace MCP servers shared before P5 were left as they are.

**P6 — Workspace runs use workspace reach.** Workspace automations and turns in shared rooms use workspace connectors and the workspace's provider keys, not the creator's or asker's personal ones. Workspace automations stop reading the owner's private memories, and then save what they learn as workspace knowledge.

As built (P6): a workspace automation's thread is a workspace context in the one place the server decides shared rooms
(`conversationAudienceIsShared` → `workspaceAutomationForThread`), so agent-thread automations, their per-step checks, asked
agents and memory extraction all follow it. Agentless (chat-thread) automations read the automation's scope on every step
(`resolveAutomationSourceGrant` → `workspaceReach`) and at admission (`resolveSharedRoom` in the act route). Such a run gets
the shared-room tooling (workspace connectors and MCP servers, workspace-scoped lists and search, no `list_chats`/
`read_chat`/`search_in_files`), loads only workspace memories, skills and retrieval, never the memory profile, and may use
only workspace provider connections (`assertUserCanUseByokModel` `workspaceOnly`; the same check now applies to shared rooms).
What it learns is workspace knowledge: its agent's (`memoryOwnerForPlace`) or, without an agent, the workspace chief's; its
own messages (the instructions) are never extracted as the creator's memory.
Workspace MCP servers shared before P5 still run with their creator's credentials.

**P7 — Workspace knowledge is searchable by everyone.** Workspace files are indexed once for the workspace, so any member's chats, and their Personal Chief, can search them. This is what makes "Personal reads Workspace" real.

As built (P7): a live file in Workspace is indexed once for the workspace, under `workspaceFilesOwnerId` with visibility
`workspace` (`fileChunkOwner`); any other file under its uploader with visibility `owner`, and a file chunk without one is
private. Indexing reads the file's owner inside the write (`replaceKnowledgeSource`); moves, archives and restores re-stamp
the file and its folder's contents one page per run until done (`restampFileChunks`, scheduled from the files
`afterApply`), moving chunk and embedding owners together; deleting a file purges its chunks wherever they are indexed.
`hybridSearch` adds one search of the workspace's files for members who aren't guests (`canSearchWorkspaceFiles`), so a
teammate's private chunks can't crowd them out and they stay searchable after their uploader leaves. Workspace-only
searches (shared rooms, workspace automations) include them, and room agents' automatic retrieval runs over them instead of
being skipped. `search_in_files` reads files in Workspace as well as the caller's own (it stays withheld in shared rooms).
Not covered: a workspace file that is a byte-identical copy of its uploader's personal file has no chunks of its own
(duplicates are indexed once per person), so it stays findable only by its uploader.

## Order and risk

P2 and P3 first: they are what people see, and P3 removes the two-Overlays confusion. P4 and P5 next: small, and they close sharing mistakes. P6 and P7 are larger and can follow. Each phase updates its living docs and this plan's status; existing rows are migrated, not given fallbacks.

## Not decided

- Whether guests see anything Workspace-scoped (today they don't), and whether they get a Personal mode.
