# Parity todos — open product/engineering decisions

Unresolved judgments from the web↔mobile parity build. None block the current
phase; each lists the current mobile behavior and what owner input would change.

## Phase 1 — Agents

### 1. New-agent creation is form-first, not create-first
- **Web:** "New agent" immediately creates an "Untitled agent" with default
  grants, opens its DM, and posts the agent greeting (`createAgentAndOpenChat`).
- **Mobile:** `+` opens a create form; the agent is only created on Save. The
  greeting is posted when the user first opens a chat with the agent (the
  `directMessage.created` flag detects the first-ever DM).
- **Why:** form-first avoids polluting the roster with abandoned "Untitled"
  agents and matches mobile expectations.
- **Owner input could change:** if you want web-identical create-first (instant
  agent + greeting + open editor), it's a ~40-line change in
  `AgentsScreen`/`agentsService`.

### 2. Managed Overlay Cloud environments are not creatable on mobile
- **Web:** `agentEnvironments.createManaged` exists in the API client but no
  web UI calls it yet (checked `AgentEnvironmentSettings` + the editor).
- **Mobile:** also not exposed — "Connect a machine" covers BYO enrollment only.
- **Blocks:** nothing. Add when web surfaces it, or if you want mobile to lead.

### 3. Agent computer provisioning is supported but minimal
- **Mobile:** the `computer` tool group toggle is shown only when
  `capabilities.computers` is on (same as web). On save it provisions a
  `default`-size computer, and unchecking destroys it after a destructive
  confirmation — same semantics as web.
- **Not ported:** the computer size picker (mobile always provisions
  `default`), power/start/stop controls, and the desktop viewer ticket flow.
  Those belong to the Phase 7 Computers surface.
- **Owner input could change:** expose a size row (small/default/large) or
  defer computer provisioning to web entirely.

### 4. Agent chat uses the existing DM conversation route
- Chat-with-agent creates/opens a workspace DM with the agent principal and
  routes to `/chat/[id]` — same mechanism as web (`view=dms` is a web-route
  detail; mobile has no DM list yet).
- **Verify:** `ChatScreen` renders agent DM conversations correctly
  (participants, agent-authored messages). DMs/channels get their full surface
  in Phase 3; if agent DMs render oddly, that's the phase to fix it.

### 5. `isDefault` agent flag is not editable on mobile
- The create input supports `isDefault` but the web editor doesn't expose it
  either (it's server-managed for the built-in master agent). Mobile matches.

### 6. Workspace scope when multi-tenant is off
- Agent calls pass `activeWorkspaceId ?? ''`; an empty/missing header makes the
  server resolve the user's *stored* active workspace (`resolveActiveWorkspace`
  in the BFF). Since mobile's workspace switcher writes the stored pref via
  `workspaces/active`, scope stays correct even before the workspace list
  resolves or on single-tenant deployments.

### 7. Enrollment command is shown as selectable text + copy button
- The enrollment `command`/`code` renders in a copyable panel (also
  `selectable` so users can grab it manually) — same exposure as web's
  clipboard button. Nothing sensitive: the code is short-lived and the command
  is designed to be pasted into a shell.

## Cross-phase

- **Blink animation on creature avatars** is not ported (web animates via CSS
  class). Lists stay static on mobile; could add a Reanimated blink later.
- **`overlay_cloud` environments + managed leases** — see item 2.
- **Tool-group mirror** — `lib/agentToolGroups.ts` mirrors web
  `src/shared/agents/tool-groups.ts` (incl. inline `COMPUTER_TOOL_IDS`). If web
  adds a group, mobile needs the same edit. A shared package extraction would
  be the clean fix (web-side change — deferred to Phase 10 list).
