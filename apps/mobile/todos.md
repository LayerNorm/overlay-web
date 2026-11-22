# Parity todos — open product/engineering decisions

Unresolved judgments from the web↔mobile parity build. None block the current
phase; each lists the current mobile behavior and what owner input would change.

## Remaining work

### Work parity

Mobile Work has List, Board and a weekly Timeline. Board cards can be placed
before another card or at the end of a status column. Dates can be edited
directly from Timeline, including for unscheduled tasks. Work Organization
lists the workspace or personal chief and the visible agents in that scope.
Timeline shows dependency arrows and supports date changes from its editor. Direct drag and resize remain open. Verify changes
against the same tasks on web during simulator acceptance.

### Web-only at launch (decided 2026-11-10, build on mobile later)

Launch scope: sign in to existing workspaces only, Convex-native data, no
purchasing in the app. These web surfaces are intentionally missing from the
mobile launch and stay reachable on getoverlay.io.

- [ ] **In-app purchases** (Apple IAP / Google Play Billing) funding the same
  workspace credits, plus mobile sign-up and paid-first onboarding. Add only
  if mobile becomes an acquisition channel.
- [ ] **Computer takeover**: mobile shows live status, can start and stop a computer, and opens a view-only stream. Taking and releasing control still needs mobile coverage and isolated live QA.
- [ ] **Extensions host and cards**: the mobile Tools screen supports personal and workspace app connections, Skills, and MCP management. Live OAuth and any remaining web-only extension host surfaces still need acceptance.
- [ ] **Admin and governance**: workspace governance metrics, policies editor,
  audit export, roles.
- [ ] **Slack import** and Slack surface bindings setup.
- [ ] **Webhooks** management.
- [ ] **MCP server setup and OAuth** (adding, testing and authorizing MCP
  servers). Mobile uses already connected servers only.
- [ ] **Agent machine enrollment beyond copy-a-command**: environment roots,
  credentials, full environment settings.
- [ ] **Billing management**: checkout, top-ups, auto top-up, portal. Mobile
  billing is read-only.


### Phase 0 retirement notes

Projects and Knowledge Bases are obsolete and removed. Historical items below
about their screens, sharing, mentions, or project scoping are no longer planned.
Phase 1 restores collaboration notifications, reactions, pins, presence, saved
messages, follows, message editing/deletion, workspace search, mentions, personal
chats and the workspace directory through native Convex. Do not restore the retired
HTTP endpoints. Notification preferences stay hidden until a member-facing native
function exists. See PHASE1_HTTP_INVENTORY.md for Phase 2 screen-data work and QA.

### Deferred web-side changes (plan §9 — owner approval required)

These need `overlay-landing` edits and were explicitly held out of every
mobile phase. Mobile groundwork for each is already committed.

- [ ] **Push token registration endpoint** — `POST /api/v1/devices` (or
  equivalent) storing Expo push tokens + notification fan-out on
  mentions/DMs. Mobile persists the token locally under
  `overlay-push-token:<uid>` (`services/notificationsService.ts`); only the
  upload call is missing. Until this lands, banners are foreground-only.
- [ ] **Bootstrap gaps** — add `workspaces` list, active workspace id, unread
  notification counts, and channel/DM summaries to `/api/v1/bootstrap` to
  save cold-start calls (drawer currently polls `conversations?view=` +
  notifications separately).
- [ ] **`canUseKnowledge` flag leak** — bootstrap may return `true` when the
  feature is disabled (noted in an earlier session).
- [ ] **AASA expansion** — `.well-known/apple-app-site-association` currently
  covers only `/auth/native/callback`; add `/share/*`, `/invitations/*`,
  `/app/invitations/*` so universal links open the app. iOS
  `associatedDomains` entitlement is already in `app.json`. Also populate
  `assetlinks.json` (currently `[]`) so the new Android intent filters
  verify — until then https links gracefully fall back to the browser.
- [ ] **Invite email links** — point invitation emails at a path that
  universal-links into the app (`/invitations/<id>`).
- [ ] **Mobile billing decision** — decide whether `initializeBilling`/
  top-up/portal get a mobile-safe response mode or stay web-only
  deliberately (App Store 3.1.1 read-only stance documented in Phase 7).
- [ ] **Account deletion** — `POST /api/account/delete` hard-requires an
  interactive browser session (`authType === 'session'`); needs a
  mobile-safe path or stays a web link forever.

### Mobile open items (no web dependency)

- [ ] **Native rebuild** — `expo-notifications` entitlement, Android
  notification channel, and `associatedDomains` require `expo prebuild` /
  an EAS build before they exist in a binary. Dev-client smoke tests
  covered the JS layer only.
- [ ] **Room offline cache** — `/dm`, `/channel`, `/thread` screens fail
  empty offline; the snapshot cache covers personal `/chat` only (different
  message model — needs a room-scoped cache or a shared transcript model).
- [ ] **iPad split-view for pushed routes** — pushed detail screens
  (`/dm/[id]`, `/chat/[id]`, `/thread/[id]`) remain full-screen on iPad;
  a true two-column navigator is a larger refactor. Tab screens get the
  permanent sidebar today.
- [ ] **Background push delivery** — needs the §9 endpoint plus APNs/FCM
  credentials in Expo/EAS project config.
- [ ] **Scroll-to-message permalinks** — thread/message links land on the
  room, not the exact message (documented since Phase 3).
- [ ] **Automation SSE lifecycle** — an abandoned `AutomationRunSheet`
  stream leaves one server-side poll alive until the run terminates (XHR
  has no abort path on RN).
- [ ] **Scheduled-run approvals** — `approvalToken` can't be reconstructed
  by a non-triggering client; same constraint as web.
- [ ] **KB connector/drive sources** — add-source covers file/paste/URL;
  connected-resource picker unwired (no web UI calls `knowledge-transfer`
  either — API-only).
- [ ] **Optional Phase 9** — admin console inventoried but parked per plan.
- [ ] **Cross-surface QA matrix** (plan §10) — same-account create-on-web/
  verify-on-mobile pass, flag-matrix run against a deployment with
  features toggled off, and light+dark screenshot review of every screen.

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

## Phase 5 — Knowledge bases (OBSOLETE) & files depth

### 33. KB sharing uses the dedicated grants model, not unified /shares
- `KnowledgeBaseScreen` mounts `KbShareSheet` (user/group/role principals,
  viewer|editor roles via `/knowledge-bases/[id]/grants` +
  `/knowledge-bases/share-directory`). The unified `ShareSheet`
  (`resourceType: 'knowledge_base'`) was wrong for KBs — web's workspace
  ShareDialog and the KB grants surface are different APIs. Files/projects
  keep the unified ShareSheet (same ShareDialog web renders).
- KB share icon is always visible (authz surface, not workspace-gated);
  single-tenant deployments get an empty directory, matching web.

### 34. OBSOLETE: KnowledgeBaseScreen — `knowledge_base` → `/knowledge-base/[id]`
- Sources tab: include/exclude checkbox + long-press toggle, tap → source
  detail sheet (extraction preview via `diagnostics?sourceId=`, re-fetch
  for external kinds, retry for failed, remove). "Add source" offers file
  upload (RN FormData to `sources/upload`), pasted text, and URL — web's
  connector/drive sources (Google Drive, Dropbox, Notion, Confluence) are
  omitted: they need a connected-resource picker that doesn't exist on
  mobile yet.
- Search tab: `knowledgeBases.search` chunks with score + snippet + citation
  footer; tapping a chunk jumps to its source detail.
- Diagnostics tab: per-source freshness badge, status, chunk/embedded/char
  counts, embedding identities; "Reindex stale" / "Reindex all" (confirm).
- Edit sheet: title/description save + destructive delete. Base metadata
  resolves via `list()` (no single-get endpoint on the client).
- `ensurePersonal` backs the "Personal knowledge base" row in the bases tab.
- KnowledgeScreen gains a `bases` tab (drawer "Bases" row under Knowledge);
  `more` menu hides on it since it has no header actions.
- Global search `knowledge_base` results now route to the KB workspace
  instead of the knowledge tab.

### 35. Files depth
- File detail `…` sheet: Rename (PATCH name), Move to… (folder picker,
  PATCH parentId, Root = null), Share (unified ShareSheet + managed public
  link via `files.share`), Delete. Storage-backed/binary files get an
  inline image preview (`downloadUrl`) or an "Open file" button via
  `expo-web-browser` instead of a dead editor.
- FilesTree search now unions client-side name matching with debounced
  server `files/search-text` (content matches) — same endpoint web's
  KnowledgeView uses.
- File-row share icon now opens the same managed-link ShareSheet.
- `KnowledgeFile` doesn't surface `shareVisibility`/`shareToken` on the
  mobile contract, so the public-link row initializes as "off" and shows
  the URL only after enabling (server returns it on PATCH). Verify against
  the real list payload — if the server does send share state, thread it
  through to pre-fill.

### 36. Outputs + projects depth (Projects OBSOLETE)
- Output detail: share icon → ShareSheet with `resource: null` — public
  link only (`outputs` PATCH), grant sections hidden for null resources.
- Project detail `…` actions sheet replaces the icon cluster: Share,
  Edit, Duplicate (auto-names "<name> copy" — web prompts for a name;
  mobile keeps it one-tap), Export (JSON → `expo-sharing`), Knowledge
  bases (attach/detach picker over `listKnowledgeBases` +
  `projects/knowledge-bases`), Delete.
- `projects/knowledge-transfer` (promote/copy/save-answer) is NOT wired —
  no web UI calls it either (API-only surface); revisit if web ships UI.

### 37. Automations depth (Phase 6)
- AutomationsScreen now orchestrates three sheets: detail (status, schedule,
  timezone, next/last run, description, actions, recent-runs list), editor,
  and run detail.
- AutomationEditorSheet: all four schedule kinds via the shared
  `buildAutomationSchedule` + `localFieldsFromSchedule` helpers (web parity),
  weekday chips for weekly, day-of-month for monthly, 24h time field, and a
  searchable `supportedTimeZoneOptions` picker that swaps the sheet's content.
- AutomationRunSheet: `/automations/[workflowRunId]/stream` polled every 3s
  plus the `/events` SSE feed over `appXhrStreamSse` (event rows with
  step-name suffix trimming, attempt counts, error text). Cancel
  (`PATCH action:'cancel-run'`) / Retry (`'retry-run'`) / Open chat actions.
- Approval: `POST /automations/[id]/run` returns `approvalToken` only to the
  triggering client — tokens are stashed by run id and the run sheet shows
  approve/deny via `/automations/[id]/approve`. Scheduled-run approvals
  triggered elsewhere can't be reconstructed client-side (same as web).
- `start-scheduler`/`cancel-scheduler` routes exist but are deprecated
  server-side (cron scheduler now); pause/resume stays on PATCH enabled.

### 38. Extensions depth (Phase 6)
- Composio connect: `connectIntegration` redirectUrl opens via
  `WebBrowser.openAuthSessionAsync`; the hosted flow ends on a web page so
  the session resolves on dismiss — mobile then polls `listIntegrationItems`
  a few times so the connected row lands even if the provider link settles
  late. Integration rows open a detail sheet (provider, auth-state warning,
  connect/disconnect).
- MCP editor: authType picker (none/bearer/header/oauth) + credential
  fields; `authConfig` is write-only (never returned) so existing secrets
  stay untouched when fields are left blank. Test passes auth fields and
  surfaces the server's 401 `requiresAuth` hint.
- McpDetailSheet: oauthStatus/issuer/connected-at, toolCatalogCount +
  toolCatalogError, Connect/Re-authorize/Disconnect OAuth.
- MCP OAuth uses `surface: 'desktop'` so the server finishes on
  `overlay://auth/mcp-callback` after its consent page — captured by
  `openAuthSessionAsync`; a cold-start deep link also routes to
  `/(tabs)/tools` in `_layout`.
- Skill editor: Write/Preview segmented toggle renders instructions through
  `EnrichedMarkdownText` (markdown parity with web's skill preview).
- No client-visible per-tool catalog endpoint exists — `toolCatalogCount`
  and test `toolCount` are the maximum surface (matches web).

### 39. Chat draft suggestions (Phase 6)
- MessageBubble promotes a lone `draft_skill_from_chat` /
  `draft_automation_from_chat` tool block to a DraftCard (badge, name,
  description, reason) via `getDraftFromToolBlock` — same non-streaming-only
  promotion as web.
- DraftReviewSheet: instructions, detected-integration chips, schedule +
  timezone for automations, missing-fields warning, confidence+reason.
- Skill save → `skills.create` (enabled, projectId when scoped). Automation
  save → sends "Create automation" back into chat via `sendPresetMessage`
  (setInputValue + deferred handleSend through handleSendRef) — the agent
  owns automation creation on web too.

### 40. Settings & account completion (Phase 7)
- Row/card primitives (SettingsSection, ToggleRow, ActionRow, InfoRow,
  UsageStat, SegmentedControl, formatCents) moved verbatim to
  `components/settings/primitives.tsx` so new sections share the chrome;
  `settings.tsx` imports them. The screen-local `styles` StyleSheet is
  untouched — ThemePresetPicker/ModelPickerSheet still use it.
- BYOK presets and DEFAULT_ENABLED_CHAT_MODEL_IDS are mirrored constants
  (overlay-llm-gateway and src/shared are not mobile deps). Drift risk:
  when presets or the curated model list change server-side, update
  services/providersService.ts and services/modelCatalogService.ts.
- Provider POST sends an `Idempotency-Key` header (server 428s without it).
  Keys are write-only — blank edit fields never clobber saved credentials.
  Stored-connection tests pass only `connectionId` so the saved key applies;
  a successful test PATCHes discoveredModelsJson/enabledModelIds/status.
- Models section edits membership only (enabledChatModelIds) — the web's
  explicit `modelOrder` drag ranking stays web-managed. Bootstrap
  `chatModels` lead in server curated order; gateway-only models append
  alphabetically. Toggling anything materializes the effective set (empty
  stored list = curated default).
- Webhook secret + rotation results are shown once via Alert with a Share
  fallback (no expo-clipboard dep; share sheet includes Copy).
- Computers need a workspace id — the section renders only when
  `activeWorkspaceId` resolves. Desktop open mints a stream ticket and
  opens it via `openBrowserAsync` (ticket URL is a bearer secret — never
  logged). Destroy is Alert-confirmed.
- Account deletion stays a web link: `POST /api/account/delete` hard-requires
  `authType === 'session'` (interactive browser session); mobile bearer auth
  gets 403, so in-app deletion cannot work without a web change (Phase 10).
- Plan & Usage gains read-only top-up history + "checkout stays on web"
  copy — no checkout/portal in-app (App Store rules).
- Onboarding gate in `app/index.tsx`: local per-user flag → server
  `hasSeenOnboarding` → `/onboarding` paged flow; `finishOnboarding` writes
  the local flag before the server complete (fail-open on both — the flow
  never blocks entry). auth-flow post-sign-in now routes through `/` so the
  gate decides. Settings → Advanced → "Replay onboarding" resets server +
  local flags then pushes `/onboarding`.
- No review/auto-extract memory prefs exist server-side — web's "memories"
  settings section is the MemoriesView list itself, so parity = the
  "Manage memories" link into the existing knowledge memories surface.
- Webhook deliveries redrive only on failed/dead_letter rows (server
  returns 404 otherwise).

## Phase 8 judgments (platform polish)

- Push is groundwork-only until §9.3 lands: `preparePushRegistration` captures
  the Expo push token (EAS projectId present) with a raw device-token
  fallback and persists it to `overlay-push-token:<uid>` — the deferred
  `POST /api/v1/devices` endpoint only needs the upload call. No token is
  logged. Permission is requested lazily post-auth.
- Foreground banners: `useNotificationWatcher` polls the unread feed every
  30s and fires local notifications (`scheduleNotificationAsync`,
  trigger:null) presented as real in-app banners via the module-level
  handler. The first poll seeds seen-ids (no banner storm on sign-in) and
  each cycle caps at 3 banners. The server's per-category 'banner'
  preference mode decides what fires — 'activity' items stay silent in the
  feed, matching web semantics; invitation/participant notifications have
  no pref key and always banner. Settings → "In-app notifications" is the
  master off switch (new `notificationBannersEnabled` mobile pref).
- 'message' notifications don't carry the conversation kind, so the watcher
  resolves dm-vs-channel lazily per conversationId (cached map) to pick
  dmMessages vs channelMessages pref mode — one extra fetch per new
  conversation, never per poll.
- Notification routing is shared: `lib/notificationRouting.ts` is used by
  both the Activity feed row and banner taps (thread deep-link →
  /thread/[id], channel → /channel, dm → /dm, else /chat).
- iPad: `useIsSidebarPermanent` = short edge ≥600pt && width ≥700pt —
  full-size iPad orientations get a permanent 320pt sidebar column;
  iPhone landscape and narrow Split View slices keep the modal drawer.
  `openDrawer` no-ops in permanent mode and TopBarIconButton suppresses
  icon='menu' globally. Pushed detail routes (/dm, /chat, /thread) stay
  full-screen on iPad — a true split-view navigator is a larger refactor.
- Offline read-through: `loadChat` falls back to an LRU snapshot cache
  (max 20 chats, ~900KB cap per snapshot, oversized transcripts skipped).
  Snapshots store the mapped Chat render model and rewrite on every
  successful hydrate/post-send reload; delete prunes. ChatScreen shows an
  "Offline — showing saved copy" pill and clears it when a reload hits
  the network. Rooms (/dm, /channel) are not snapshot-cached — different
  message model; they fail empty offline (documented gap).
- A11y: TopBarIconButton derives labels from a Feather-glyph map (callers
  may override); Composer's icon buttons, ListRow, ActionRow, ToggleRow,
  SearchField clear, and SegmentedControl gained roles/labels/states.
- Haptics: all calls now route through `lib/haptics.ts` helpers gated on
  the hapticsEnabled pref — previously ~half the call sites ignored it
  (RoomScreen, sheets, agents surfaces). ChatScreen's manual gates removed.
- Deep links verified via simctl openurl: dictate, invitations, share/c
  (opens the web share page in in-app browser), auth/mcp-callback — no
  crashes. Universal-link groundwork added: iOS associatedDomains +
  Android intent filters for /share/, /invitations/, /app/invitations/.
  The production AASA already exists but only covers
  /auth/native/callback — it must grow /share/ + /invitations/ paths (and
  assetlinks.json is empty) before https links activate; both are §9 web
  work. Filters degrade gracefully (links fall back to browser) meanwhile.
- expo-notifications plugin added to app.json (default channel, no sounds).
  A native rebuild (expo prebuild / EAS) is required before the entitlement
  and Android channel exist in a binary — dev-client smoke tests covered
  the JS layer only.

### Personal Chat transcript host integration

- Populated personal Chat now maps its full exchange history through
  `toNativeChatTranscriptView` and mounts `NativePersonalChatTranscript`;
  the native header, composer, pickers, generation controls, approvals,
  loading/empty/offline states, drawer, and navigation remain native.
- Data operations are scoped to the committed user/workspace/route epochs;
  UI callbacks and asynchronous writes validate their current operation.
  Draft Skill Save uses `createSkill`; automation Draft Save uses a scoped
  text-only preset path and preserves unrelated composer state.
- Unsupported transcript Delete/Branch/Regenerate/Continue/generated-UI
  writes remain unavailable. Protected/local binary-media previews and
  unsupported attachment download paths remain honest unavailable states.
- Full-app visual/native QA, unsupported transcript controls/media adapters,
  export/reachability checks, and release validation remain pending; no live
  QA or export was performed in this integration step.
