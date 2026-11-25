# Workspace and Personal

How Overlay keeps each person's Personal corner apart from what their workspace shares. Update this doc with any change
to modes, scopes, moves, the Personal Chief, workspace contexts, or who may search what.

## The rules

1. **Two modes, one switch.** Each person works in Workspace mode or Personal mode. The switch sits in the primary
   sidebar and changes every section at once; Workspace is the default and the choice is remembered per person and
   workspace.
2. **Personal lives inside each workspace.** It is the person's private corner of that workspace: their creator-only
   agents, files, notes, skills and automations, and their Personal Chief. It reads that workspace's knowledge, never
   another's.
3. **Everything belongs to exactly one mode.** What you create belongs to the mode you are in. Chats belong to the mode
   they were started in; DMs and channels appear only in Workspace mode.
4. **Overlap is one-way.** Personal can read Workspace. Workspace agents, shared rooms, workspace automations and outside
   surfaces (Slack) never read anyone's Personal.
5. **Overlay is the workspace's chief.** Each person's own chief is "{Name}'s Chief" (renamable, `personal_chief`). It
   exists only in Personal: not listed in Workspace mode, not mentionable in shared rooms or channels, never answers in
   Slack. Its computer is visible only to its person.
6. **Personal is optional.** It and its chief are created the first time someone switches to it.
7. **Moves are one-way and deliberate.** Personal → Workspace only, by the person's own "Move to workspace", after a
   confirmation. Nothing moves back.
8. **The workspace pays.** Personal mode spends the workspace's budget (per-person caps: `todos.md`).

Settings stay grouped into Personal and Workspace sections regardless of mode. Not decided: whether guests see anything
Workspace-scoped (today they don't), and whether they get a Personal mode.

## Where each rule is enforced

**Scopes and moves.** One scope engine (`src/shared/workspaces/resource-scope.ts`, `convex/lib/resourceScope.ts`,
`convex/lib/scopeMutations.ts`) gives files, notes, outputs, skills, MCP servers, connectors, automations and work items
a `scope`. `checkMoveResource` refuses `to: 'personal'` (`one_way`) everywhere, including `POST /api/v1/scope` and Work's
own update. The UI offers only Move to Workspace, always through `MoveToWorkspaceDialog`. Agent `visibility` follows the
same rule (`WORKSPACE_AGENT_VISIBILITY_ONE_WAY`; `convex/lib/agentVisibility.ts`), and a member may move only if the
workspace allows member moves or they are an owner or admin.

**Automations and their agent.** Moving an automation re-checks its agent in a `beforeMove` hook; `withAgent: true` moves
the creator's private agent in the same mutation (`automation_agent_personal` / `_not_yours` / `_chief` otherwise).

**Accounts never move.** Connectors refuse every move (`connector_reconnect_for_workspace`); in Personal a connected
connector offers Connect for workspace. Moving an MCP server strips its credentials in the move's mutation
(`workspaceMoveCredentialPatch`) and turns it off until it is connected for the workspace and switched on again. Workspace
MCP servers shared before that rule keep their creator's credentials.

**Workspace contexts.** A conversation is a workspace context when others can read it (a channel, a room with more than
one person, an outside surface) or it is a workspace automation's thread (`conversationAudienceIsShared`,
`workspaceAutomationForThread` in `convex/lib/roomAudience.ts`; read through `src/server/agents/shared-room.ts`,
fail-closed). Agentless automation runs re-read the automation's scope every step (`resolveAutomationSourceGrant`). A
workspace context gets workspace reach only — see "Rooms others can read, and workspace automations" in
`internal/develop/tool-catalog.md` for the exact tool, model and context rules.

**Memories follow the place.** `memoryOwnerForPlace` (`src/shared/agents/agent-memory.ts`): what an agent learns in a
workspace context is workspace knowledge kept by the agent (`agent-memory:<agentId>`); without an agent, an automation's
learning goes to the workspace chief (`workspaceChiefMemoryOwnerId`). Everything else, and anything a creator-only agent
or a Personal Chief learns, is the person's. A workspace automation's own messages are never extracted as its creator's
memory. Memories move only through `knowledge/memories:moveToWorkspace`.

**Who may search what.** A live file in Workspace is indexed once for the workspace (`workspaceFilesOwnerId`, visibility
`workspace`, `fileChunkOwner` in `src/shared/knowledge/chunk-visibility.ts`) and searched for every member who isn't a
guest (`canSearchWorkspaceFiles`); personal and archived files stay under their uploader, private. Moves, archives and
restores re-file chunks (`restampFileChunks`). A file chunk with no visibility is private (`chunkVisibleToSearch`). A
workspace file that is a byte-identical copy of its uploader's personal file has no chunks of its own (duplicates are
indexed once per person), so only its uploader finds it.

**Roles at sign-in.** Every sign-in gives the baseline member role (`createSignedInSession`); automation runs enforce its
capabilities.
