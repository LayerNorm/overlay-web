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

## Phase 2 — Chat depth

### 8. Generated-UI parts render as native summary cards, not interactive widgets
- **Web:** `data-*` parts (draft.text, draft.email, generated views) render as
  interactive generated UI inside the transcript.
- **Mobile:** `GeneratedUiCard` renders the same parts as a native card —
  title + draft body preview + actions. There is no WebView/interactive
  runtime for generated views yet.
- **Why:** keeps the transcript native and fast; a sandboxed WebView host is
  a bigger project.
- **Owner input could change:** if generated views must be fully interactive,
  that needs a WebView/iframe host channel — sizable; flag it and I'll scope.

### 9. Run lifecycle polls REST every 2s while active
- **Web:** Convex subscription drives `currentRun` live (adaptive REST
  fallback underneath).
- **Mobile:** polls `currentRun` REST — 2s while queued/running/
  waiting_for_approval or a send is in flight, 15s idle. Approval card shows
  requested tool names and submits via `submitRunApproval`.
- **Owner input could change:** realtime subscription (Phase 3 candidate)
  would make approvals/status instant and cut poll traffic.

### 10. Mention search is search-only, not full-list browsing
- **Web:** `useMentionData` fetches full lists (files, knowledge bases,
  connectors, automations, skills, MCP, chats) for the mention menu, plus the
  `/mention-search` endpoint for typed queries.
- **Mobile:** only `/mention-search` — so `knowledge`, `connector`, `person`,
  and `agent` mention types are reachable only if that endpoint returns them
  (today it returns files/notes/chats/automations/skills/MCP servers).
- **Blocks:** knowledge-base mentions specifically — the act body already
  sends `knowledgeBaseIds` when a `knowledge` mention exists.
- **Owner input could change:** add a browse-all fetch (parallel
  files/knowledge/connectors calls) behind the `@` button.

### 11. Temporary chats are per-session, header-toggleable
- **Web:** temp mode lives in composer options; temp chats never persist.
- **Mobile:** `eye`/`eye-off` header toggle + "Temp" pill badge. Sending in
  temp mode skips conversation meta sync, history, run polling, and memory
  (`memoryEnabled: false` forced) — matching `defaultChatToolRequestIds`
  semantics. The toggle persists for the session, not across launches.
- **Owner input could change:** persist the toggle, or move it into the
  composer options sheet only.

### 12. Share links open the server-rendered page in an in-app browser
- `/share/c/[token]` is a real route (works with `overlay://share/c/<token>`
  deep links now; universal links need the AASA file — Phase 10 list). There
  is no public read API for shared transcripts, so the token opens
  `{base}/share/c/<token>` via `expo-web-browser`, then returns to chat.
- **Owner input could change:** a public read endpoint would let the route
  render natively — web-side change, Phase 10 list.

### 13. Archive scope is always `self`
- The API supports `self | everyone`; mobile personal chats always archive
  `self` (web does the same for personal). DM/channel archive-for-everyone
  arrives with Phase 3 multiplayer.

### 14. Ask-mode + multi-model variants remain single-model act
- Web supports `ask` mode (fast Q&A) and multi-model parallel responses with
  per-response tabs. Mobile keeps single-model `act` — the `mode`/`requestMode`
  fields are wired through, but variant tabs/multi-model fan-out aren't
  exposed. Flag if you want it in scope.

### 15. Draft chats now get a real server row on first send (fixed)
- **Found during Phase 2:** mobile sent the client-side draft id (`chat-…`)
  as `conversationId`; the server's `addMessage` throws
  `CONVERSATION_NOT_FOUND` for unknown ids, so act turns streamed but never
  persisted server-side.
- **Fix (matches web's `PENDING_FIRST_CHAT_ID` flow):** first send fires
  `POST /conversations` with the draft id as `clientId` and the act body
  carries `conversationClientId` (`ensureActConversationId` is idempotent on
  workspace+clientId), then the chat adopts the returned server `_id`.
- **Side effect:** the first send in a brand-new chat now waits on the
  create round-trip before streaming starts (~100–300ms). Subsequent sends
  are unchanged.

### 16. Reply threading is model-context-only for personal chats
- Verified against the server: `persistUserMessage` in the act path does not
  store `replyToTurnId` — web behaves identically (reply threading persists
  only for DM/channel messages via the addMessage route). Mobile shows the
  reply chip locally and sends `replyContextForModel` — full parity.

## Cross-phase

- **Blink animation on creature avatars** is not ported (web animates via CSS
  class). Lists stay static on mobile; could add a Reanimated blink later.
- **`overlay_cloud` environments + managed leases** — see item 2.
- **Tool-group mirror** — `lib/agentToolGroups.ts` mirrors web
  `src/shared/agents/tool-groups.ts` (incl. inline `COMPUTER_TOOL_IDS`). If web
  adds a group, mobile needs the same edit. A shared package extraction would
  be the clean fix (web-side change — deferred to Phase 10 list).
