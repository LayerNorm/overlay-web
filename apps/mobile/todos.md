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

### 4. Agent chat uses the DM room surface
- Chat-with-agent creates/opens a workspace DM with the agent principal and
  routes to `/dm/[id]` (updated in Phase 3 from `/chat/[id]` — agent DMs are
  real multiplayer rooms). `/chat/[id]` self-redirects for dm/channel
  conversations that arrive via share links or stale recents.

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

## Phase 3 — Multiplayer chat

### 17. Rooms poll REST every 8s; no realtime subscription
- **Web:** Convex live queries stream room messages/presence/reactions.
- **Mobile:** 8s poll on focus for transcript+participants+presence+reactions+
  pins+saved (single `Promise.all`), 25s presence heartbeat, 2.5s-throttled
  typing updates. After a send completes we reload immediately so the user's
  own message + the agent's first turn show without waiting a full interval.
- **Owner input could change:** Convex React Native subscription is the
  documented stretch — it would make room updates instant; flag if you want
  it scoped now.

### 18. Room sends go through `conversations.addMessage`, not the act stream
- Agent replies in shared rooms are server-owned: `addMessage` persists the
  human turn (with `clientNonce` for optimistic reconciliation), the server
  runs the agent, and the reply lands on the next poll/load. Mobile does not
  hold a stream open in rooms — same data flow as web.
- Room composer hides per-request tools/memory/mode/generation (the
  addMessage contract carries none of them) and mentions insert as
  `@DisplayName ` text, resolved to `mentionedPrincipalIds` on send — the
  same mechanism web uses.

### 19. Pinned/saved sheets list only already-loaded messages
- The pins/saved panels filter the in-memory transcript. A pin on a message
  older than the loaded window won't appear until you page up to it (the pin
  endpoint returns ids, not content; a per-message `?messageId=` fetch per
  pin is possible but was left out to keep the sheets simple).
- **Owner input could change:** hydrate each pinned/saved id via
  `loadRoomMessages({messageId})` — small change.

### 20. Room mentions are participant-scoped
- In rooms, `@` searches room participants (people + agents) rather than the
  global `/mention-search` index — matching web room behavior, where
  mentions exist to notify principals. File/knowledge mentions remain
  available in personal chats.

### 21. Agent DMs route through `/dm/[id]`
- Phase 1's "chat with agent" pushed `/chat/[id]`; it now pushes `/dm/[id]`
  since agent DMs are real multiplayer DMs. `/chat/[id]` also self-redirects
  when a loaded conversation turns out to be a dm/channel (share links,
  search results, stale recents).

### 22. Notification deep-links land on the room, not the message
- Activity taps resolve conversation type then route to `/dm`, `/channel`,
  `/thread` (thread notifications use `threadRootMessageId`), or `/chat`.
  Scroll-to-message inside a room isn't implemented (needs `?messageId=`
  fetch + list anchor) — noted for a later polish pass.

### 23. Principal search loads once per sheet open
- `NewDirectMessageSheet`/`NewChannelSheet` fetch workspace people + agents
  via `workspaces.management('people' | 'chats-agents')` on open and filter
  locally (no server search endpoint). Fine at workspace scale.

## Cross-phase

- **Blink animation on creature avatars** is not ported (web animates via CSS
  class). Lists stay static on mobile; could add a Reanimated blink later.
- **`overlay_cloud` environments + managed leases** — see item 2.
- **Tool-group mirror** — `lib/agentToolGroups.ts` mirrors web
  `src/shared/agents/tool-groups.ts` (incl. inline `COMPUTER_TOOL_IDS`). If web
  adds a group, mobile needs the same edit. A shared package extraction would
  be the clean fix (web-side change — deferred to Phase 10 list).

## Phase 4 — Workspaces, management & sharing

### 24. Roles view skipped
- Web `WorkspaceSettingsPanel` has a `roles` management view that renders an
  empty/deferred state. Mobile omits the Roles tab entirely rather than
  shipping a dead tab.

### 25. Tabs consolidated into one scrollable chip row
- Web shows People/Agents/Guests/Sharing/Billing/Import (teams filtered out
  server-side in some configs). Mobile keeps all eight surfaces — People,
  Agents, Teams, Guests, Sharing, Billing, Import, Shared — as a horizontal
  chip row instead of the web's full-width tab bar.

### 26. Billing is read-only on mobile
- App Store rules keep checkout/top-up/portal on web; mobile renders the
  wallet summary (credits meter, plan card, rollout stage) plus a hint that
  payments happen on the web app. `initializeBilling`/`checkout`/`topUp`/
  `portal` client methods are intentionally not exposed in the UI.

### 27. Audit export → NDJSON file + native share sheet
- `GET /workspaces/{id}/audit-export` streams NDJSON; mobile writes it to
  cache as `workspace-audit-<ts>.ndjson` and hands off to `expo-sharing`
  (new dependency added this phase). No date-range picker yet — exports the
  server default window; `from`/`limit` params exist in the service.

### 28. ShareSheet consolidates the web ShareDialog
- One bottom sheet covers: public-link row (copy), existing grants with
  role-cycle + impact-confirmed revoke, directory picker (people/agents/
  teams/rooms) with viewer/operator/editor role choice, impact confirmation
  for team/room grants (`confirmRoomExpansion`), and a guest-invite row.
- Role change uses an Alert picker cycling viewer→operator→editor rather
  than a dropdown — matches native idiom.
- Entry points wired: file rows in FilesTree (share icon), project detail
  header (share icon). Knowledge bases have no management screen on mobile
  yet, so `knowledge_base` sharing is reachable only via the workspace
  "Shared" tab; conversations already have public-link share (Phase 2) —
  per-grant conversation sharing can reuse ShareSheet if needed later.
- All share UI is gated on `workspacesEnabled && isFeatureEnabled('resourceSharing')`.

### 29. SlackImportPanel mirrors the web BFF surface only
- Jobs list, channel multi-select (search, up to 4 paged channel fetches),
  start, cancel, 5s polling while a job is queued/running. Unconnected state
  shows a "connect Slack via Extensions" hint instead of web's OAuth button.

### 30. Shared-with-me tab
- `sharing.sharedWithMe` results route by kind: conversation→`/chat/[id]`
  (self-redirects to dm/channel), file→files tab, knowledge_base→knowledge,
  project→projects, automation→automations, agent→agent editor.

### 31. Create workspace auto-activates
- `WorkspaceContext.createWorkspace` creates, refreshes the list, activates
  the new workspace, and force-refreshes session entitlements — matching the
  web "create then land inside it" flow. Switcher sheet gains "Manage
  workspace" + "New workspace" rows; Settings gains a Workspace section.

### 32. Invitation route
- `/invitations/[id]` mirrors web `AcceptWorkspaceInvitation`: single
  accept button, 401 → sign-in prompt, success → workspace activated →
  `/(tabs)/chat`. `overlay://invitations/<id>` and pasted web invite paths
  deep-link there via `handleDeepLink`.
