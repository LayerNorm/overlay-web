# Surfaces: deploy Overlay agents to external chat platforms

Status: in progress — Phase 0 ✅ landed (deps, Slack app manifest +
`docs/develop/surfaces-slack-app.md`, env vars); Phase 1 ✅ landed (data model +
OAuth connect flow + bindings API); Phase 2 ✅ landed (webhook → durable turn →
Slack reply); Phase 5 partially landed (SDK dedupe + sender guards + unit
tests; degraded-connection handling still missing). Staging E2E verification
in progress — two blocking bugs fixed on staging (`overlay_session`
SameSite=strict → lax so OAuth callbacks carry the session; `getSlackAdapter`
now calls `chat.initialize()` so `setInstallation` works outside webhook
context). Decisions marked **[decided]** are settled;
the rest are implementation defaults open to revision.

## Context

The product promise is "create, deploy and manage agents — connect them to any
surface." Today agents are reachable only inside Overlay. "Surfaces" makes an
agent reachable on external chat platforms, starting with Slack. Discord,
Teams, Telegram, iMessage follow behind the same machinery.

Carrier of record for v1: [Chat SDK](https://chat-sdk.dev) (`chat` +
`@chat-adapter/*`, Vercel's open-source bot SDK). It absorbs webhook
verification, payload normalization, thread subscriptions, dedupe, locks, and
post-and-edit streaming across platforms. We write binding + turn logic once;
platforms register as adapters. Reference docs ship in
`node_modules/chat/docs/` and `node_modules/chat/resources/guides/` once
installed — follow those over the website during implementation.

Out of scope for v1: approvals on external surfaces, allowlists, per-binding
personas, writing back to platforms from the Overlay composer, file uploads to
platforms, iMessage, BYO agents on surfaces, streaming edits, expandable
agent→threads sidebar.

## Mental model **[decided]**

- A surface is a *transport*, not a deployment. The agent never leaves
  Overlay — Slack is a window into the same brain. Memory, files, Composio,
  computers, MCPs all resolve inside the turn runner exactly as they do for an
  in-app DM.
- The platform's own membership is the ACL. Anyone in a bound Slack channel
  can talk to the agent; the agent always acts with its creator's authority.
  One consent line at bind time, no Overlay-side permission matrix.
- Persist, don't port. Only messages that pass through the agent are stored —
  a Slack thread maps to one Overlay conversation. No history import.
- Replies go to the platform as text. Generated files/artifacts stay in
  Overlay, referenced by name. Approval-gated tools auto-deny (unattended
  runner behavior, unchanged).

## Architecture

```
Slack workspace ──Events API──▶ POST /api/v1/webhooks/slack (ChatSDK adapter)
                                    │ signature verify, dedupe, normalize
                                    ▼
                         SurfaceBindingResolver
                         (team_id+channel → connection → binding → agent)
                                    │
                                    ▼
                    ensureSurfaceConversation (thread_ts ↔ conversation)
                                    │
                                    ▼
             surface turn runner ── reuses prepareAutomationAgentTurn
             (context: memory, files, Composio, computers — full tools;
              approvals auto-deny; service auth; billing subject
              "surface:slack:<bindingId>")
                                    │
                                    ▼
                    slack webClient chat.postMessage — agent name + avatar
```

`Chat` is the platform-abstraction layer — we do NOT wrap it in another
adapter interface. Adding Teams/Discord later = registering another adapter
plus a connection row, no new abstraction. **[decided]**

## Data model

Two new app-data entities (repository contract + Postgres migration + Convex
table + parity-matrix entry — the standard dual-backend drill):

```
surfaceConnections                 -- one row per platform install
  id
  workspaceId
  platform: 'slack'                -- 'teams' | 'discord' | ... later
  externalTeamId                   -- Slack team_id (enterprise_id for org installs)
  externalTeamName                 -- for UI
  externalEnterpriseId             -- Grid org id when applicable
  botUserId                        -- Slack bot user id for the install
  installedByUserId
  status: 'active' | 'degraded' | 'uninstalled'
  createdAt, updatedAt
  unique (platform, externalTeamId) -- global: one Slack workspace routes to at
                                    -- most one Overlay workspace **[decided]**

surfaceBindings                    -- agent ↔ channel
  id
  connectionId
  agentId
  channelId
  channelName                      -- denormalized for lists
  createdByUserId
  status: 'active' | 'removed'
  createdAt, updatedAt
  unique (connectionId, channelId) -- v1: one agent per channel
```

`conversations` gains optional fields (additive, no backfill):

```
  externalPlatform: 'slack' | ...
  externalChannelId
  externalThreadId                 -- Slack thread_ts (root ts for unthreaded)
  surfaceBindingId
  index by (surfaceBindingId, externalThreadId)
```

Messages need nothing: `conversationMessages.importedAuthorName/Email/Status`
already models external senders (built for Slack import), and the transcript
renderer already handles them. `conversationType: 'channel'` + `channelSlug`
fit as-is.

## Phase 0 — Slack app + dependencies ✅ **[landed]**

- `chat`, `@chat-adapter/slack`, `@chat-adapter/state-pg`,
  `@chat-adapter/state-memory` at 4.40.0.
- Slack app manifest + setup steps: `docs/develop/surfaces-slack-app.md`.
  Uses `agent_view` (Slack's native agent surface — Working indicator, stop
  button, session titles; new apps can't use the deprecated assistant_view),
  `chat:write.customize` for per-agent identity, `users:read.email` to feed
  `importedAuthorEmail`, `channels:join` so the bot self-joins, and
  `app_uninstalled`/`tokens_revoked` for degradation tracking.
- Env: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`,
  `SLACK_ENCRYPTION_KEY` (encrypts stored bot tokens in the state store),
  optional `SLACK_REDIRECT_URI`.
- OAuth callback is `slackAdapter.handleOAuthCallback(request)` — the adapter
  performs the code exchange and writes the installation into the state store
  itself; our callback route adds only the `surfaceConnections` upsert.
- Slack requires a public webhook URL: point the dev app at staging or a
  tunnel during development; production gets the real domain.

### ChatSDK state adapter — the one open decision **[check first]**

The SDK needs a state store (thread subscriptions, locks, dedupe marks) AND
uses it for multi-workspace OAuth token resolution by `team_id`.

- If prod has a live `OVERLAY_DATABASE_URL`: use `@chat-adapter/state-pg`
  (`{ url }` passed explicitly) against the existing app-data Postgres.
  Zero new infra.
- If prod is Convex-only: write a thin `OverlayStateAdapter` over the app-data
  repository layer (~5 methods: subscription get/set, lock acquire/release,
  dedupe mark). Keeps backend neutrality; do it as the parity follow-up even
  if Postgres is available.

**[decided]** Token resolution follows the SDK's mechanism: in
multi-workspace OAuth mode the adapter omits `botToken` and resolves per-team
tokens from the state adapter. `surfaceConnections` stores metadata (team
name, status, installer) — NOT a parallel token path. No Vercel Connect:
it would bind a core surface to Vercel's marketplace auth, which cuts against
the self-host/AGPL story. We own the OAuth flow.

## Phase 1 — connect flow (OAuth) ✅ **[landed]**

- `GET /api/v1/surfaces/slack/connect?agentId=` — session-gated redirect route
  (not BFF JSON). Verifies the caller may bind that agent (creator for personal
  agents, any non-guest member for workspace agents), then 302s to Slack OAuth.
  The `{agentId, workspaceId, userId, returnTo}` intent travels as the
  HMAC-signed OAuth `state` param itself — no cookie, no server-side record;
  the only effect it authorizes is idempotent metadata upsert.
- `GET /api/v1/surfaces/slack/callback` — verifies the signed state, requires
  the completing session to match the connecting user, re-checks bind
  permission, delegates the code exchange to
  `slackAdapter.handleOAuthCallback` (writes the installation into the state
  adapter itself), upserts `surfaceConnections`, redirects back to `returnTo`.
- `GET /api/v1/surfaces/connections/{connectionId}/channels` — proxies Slack
  `conversations.list` under the installation's bot token via
  `adapter.withBotToken`.
- `GET /api/v1/surfaces/connections` — workspace connection list (metadata).
- `GET /api/v1/surfaces/bindings?agentId=` — binding list for the editor.
- `POST /api/v1/surfaces/bindings` `{agentId, connectionId, channelId}` →
  create. `DELETE /api/v1/surfaces/bindings/{id}` → `status:'removed'`
  (non-destructive; history stays). Re-binding a removed channel reactivates
  its row onto the new agent.
- Binding auth: personal agent → creator only; workspace agent → any non-guest
  member. **[decided]**
- Repository: `surfaces` in `AppDataRepositories` with both backends —
  `migrations/app-data/0076_surfaces.sql`, `convex/surfaces/surfaces.ts`,
  `src/server/surfaces/{SurfaceRepository,PostgresSurfaceRepository,ConvexSurfaceRepository,SurfaceService}.ts`,
  Chat singleton in `src/server/surfaces/chat.ts` (state-pg on
  `OVERLAY_DATABASE_URL`, memory otherwise). Parity-matrix + route-support +
  contract-test entries wired.

## Phase 2 — webhook → turn → reply ✅ *(landed)*

- `src/app/api/v1/webhooks/slack/route.ts`: delegates to
  `chat.webhooks.slack(request, { waitUntil })` — the adapter verifies the
  signature, dedupes retries, and acks inside Slack's 3s window while
  handlers run under `after`. 503 when `SLACK_*` env is unset.
- `src/server/surfaces/` modules: `chat.ts` (Phase 1 singleton),
  `slack-inbound.ts` (handlers + routing), `slack-reply.ts` (post/edit under
  the installation token via `getInstallation` + `withBotToken` — works
  outside webhook request context, which is what durable steps need),
  `surface-conversations.ts` (thread → conversation mapping),
  `surface-authors.ts` (sender email → member/invited/not_invited).
- Trigger rules v1: `onNewMention` in channels → `thread.subscribe()` so
  follow-ups in that thread don't need re-mention; `onSubscribedMessage`
  covers follow-ups. Guard `author.isMe`/`isBot`/`isSystem`. DM bindings are
  not creatable yet (the channel picker lists channels, not IMs).
- Resolver: `SurfaceService.resolveInboundBinding` — `(team_id, channel_id)
  → active connection → active binding → non-archived agent → creator's
  human principal + userId`. Every miss returns null → silent no-op, except
  a mention in an unbound channel which gets a one-line "connect me" reply.
- `ensureSurfaceConversation`: atomic find-or-create on
  `(surfaceBindingId, externalThreadId)` — Postgres backs it with a partial
  unique index (`deleted_at IS NULL`), Convex with a mutation + dedicated
  index. Conversation carries `externalPlatform/externalChannelId/
  externalThreadId/surfaceBindingId` + `conversationType:'channel'`.
- Turn pipeline: `surface` provenance on `AutomationAgentTurnInput` reuses
  the existing prepare → model/tool → finalize loop verbatim
  (`runDurableAgentTurn`, extracted from `automation-agent-turn.ts` and
  shared by both workflows). Surface turns: skip automation metering and
  prompt framing, use `buildSurfaceSystemPrompt` (agent instructions +
  platform context), bill to `surface:<platform>:<bindingId>`, narrow the
  tool surface to the bound agent's `allowedToolIds` grant
  (`resolveAgentGrant` + `applyAgentCapabilityFilter` — same narrowing the
  workspace-agent invocation path uses), and own the agent's memory
  (`agentMemoryOwnerId`). Inbound persists with `importedAuthor*` fields;
  Postgres `conversation_messages` gained those columns for parity.
- Workflow: `src/server/workflows/surface-agent-turn.ts` —
  `ensureSurfaceConversation` step → `runDurableAgentTurn` → Slack reply
  step (edits the "working" placeholder via `chat.update`). Turn failure
  persists a failure message and posts a concise error to the thread.
- Outbound: `chat.postMessage` with `username: agent.name`
  (`chat:write.customize`). `icon_url` (creature avatar endpoint) deferred.
- v1 posts an immediate "working…" placeholder, then edits it into the
  final reply — which is also the retry-safe reply path: a retried delivery
  converges on the same conversation + turn id, and the placeholder edit is
  idempotent by ts.

## Phase 3 — agent editor UI ✅ *(landed)*

New "Reachable on" section in `OverlayAgentFields` after the Computer section —
same bound-resource-card idiom as `AgentComputerSection`:

```
  Reachable on
  ──────────────────────────────────────────────
  Overlay                          always on
  Slack     Acme Co — #fundraising          [Remove]
                       #sales-prospects     [Remove]
                       + Add channel
  Teams     coming soon                    (disabled)
  Discord   coming soon                    (disabled)
```

- Connect → full-page OAuth redirect (not a modal; returnTo restores editor).
- Binding rows commit immediately (like computer deletion), not on save.
- Consent line under each binding: "Anyone in #fundraising can talk to
  Scout. It acts with your access."
- Muted line at section bottom: "Threads from connected surfaces appear in
  Chats." — teaches where to look at the moment of first bind.
- Degraded connection (revoked token) → amber status on the row.
- Personal agents: connect controls hidden for non-creators.

Implementation notes:

- `AgentSurfacesSection` in `src/features/agents/components/AgentEditorForm.tsx`
  renders after `AgentBehaviorFields` (which ends with the Computer section)
  and before `AccessSelector`; state lives in `use-agent-surfaces.ts` and the
  page stays presentational.
- `GET /api/v1/surfaces/bindings` now returns `canBind` — a soft
  `SurfaceService.canBindAgent` (non-throwing `requireBindableAgent`) so the
  UI can hide controls without guessing client-side identity. Guests and
  non-creators of `visibility: 'creator'` agents get `canBind: false`.
- `SurfacesClient` added to `@overlay/api-client`
  (`packages/overlay-api-client/src/surfaces/client.ts`, registered as
  `client.surfaces`): `listConnections`, `listChannels`, `listBindings`,
  `createBinding`, `removeBinding`.
- Unsaved agents render the section with a "Create the agent to connect it to
  a surface." hint — no fetches fire until the agent exists. BYO agents hide
  the section entirely (BYO surfaces are deferred).
- Slack is the only real platform row; Teams/Discord render as disabled
  "coming soon" rows. A second Slack workspace can be connected via "Connect
  another Slack workspace" once one exists.

## Phase 4 — surface conversations in the app ✅

- Platform conversations appear in the existing chats list (Channels view),
  tagged with the platform icon + `#channelName` in the title (`Slack ·
  #channel`). **Read-only** — transcript renders, composer and thread reply
  box are replaced by a "Mirrored from Slack" notice. Replying happens on the
  platform.
- `ensureSurfaceConversation` now writes `conversationParticipants` (creator
  as moderator, bound agent as member) + a `workspaceResourceScopes` row on
  both backends, idempotently — pre-Phase-4 conversations are backfilled on
  the next inbound message. `externalPlatform`/`externalChannelId`/
  `externalThreadId`/`surfaceBindingId` are mapped through every accessible
  conversation list/get.
- `POST /api/v1/conversations/message` returns 403 for surface conversations;
  `addMessage` on both backends throws `SURFACE_CONVERSATION_READ_ONLY` as a
  backstop (the turn runner persists via internal services, unaffected).
- The expandable agent→threads sidebar (agents as contacts, threads beneath)
  is the known end-state; `externalThreadRef` data makes it a pure reskin
  later. Not v1.

## Phase 5 — hardening *(partially landed)*

- `app_uninstalled` / `tokens_revoked` → connection `degraded` + editor amber.
- Slack retry storms: adapter acks first; dedupe TTL in state adapter; guard
  `bot_id` and own echoes.
- Bot must be invited to channels (`/invite @overlay`) — document in the
  connect UI; `conversations.list` picker can filter to joinable channels.
- Unit tests: binding resolver, thread↔conversation mapping, removed-binding
  no-op, revoked-token path. Manual e2e: test Slack workspace → staging.

## Explicitly deferred

Teams/Discord adapters, approval cards on Slack (ChatSDK + Workflow guide
covers the pattern when requested), allowlists / DM-only bindings, per-binding
instructions or tool scoping, composer write-back to platforms, file uploads,
iMessage, BYO agents on surfaces, streaming edits, expandable threads sidebar,
agent-avatar render endpoint (optional).

## QA checklist (when built)

- [ ] `/api/v1/surfaces/slack/connect` → OAuth round-trip → connection row +
  editor shows workspace name
- [ ] Bind `#channel` → @mention agent → reply lands in Slack thread with the
  agent's name/avatar; conversation appears in Chats tagged "Slack · #channel"
  and is read-only
- [ ] Follow-up in the same Slack thread (no mention) → agent replies
- [ ] Second agent binds to same Slack workspace → no second OAuth prompt
- [ ] `importedAuthorName` shows the real Slack sender in the transcript
- [ ] Remove binding → agent stops responding; history preserved
- [ ] `convex:push:dev`/`npm run check:shared-isomorphic` + migration parity
  green; new routes added to `docs/develop/api-route-catalog.mdx`
