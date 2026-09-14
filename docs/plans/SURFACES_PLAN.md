# Surfaces: deploy Overlay agents to external chat platforms

Status: in progress — Phase 0 landed (deps, Slack app manifest +
`docs/develop/surfaces-slack-app.md`, env vars). Decisions marked
**[decided]** are settled; the rest are implementation defaults open to
revision.

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
  externalTeamId                   -- Slack team_id
  externalTeamName                 -- for UI
  installedByUserId
  status: 'active' | 'degraded'    -- degraded on tokens_revoked/uninstall
  createdAt
  unique (platform, externalTeamId, workspaceId)

surfaceBindings                    -- agent ↔ channel
  id
  connectionId
  agentId
  channelId
  channelName                      -- denormalized for lists
  createdByUserId
  status: 'active' | 'removed'
  createdAt
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

## Phase 0 — Slack app + dependencies **[landed]**

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

## Phase 1 — connect flow (OAuth)

- `GET /api/v1/surfaces/slack/connect?agentId=` — session-gated. Verifies the
  caller may bind that agent (creator for personal agents, any member for
  workspace agents). Stashes `{agentId, workspaceId, returnTo}` in a signed
  state cookie. Redirects to Slack OAuth.
- `GET /api/v1/surfaces/slack/callback` — exchanges `code`, registers the
  install into the ChatSDK state adapter (token resolution path), upserts
  `surfaceConnections`, redirects back to the editor.
- `GET /api/v1/surfaces/{connectionId}/channels` — server proxies Slack
  `conversations.list` for the channel picker.
- `POST /api/v1/surfaces/bindings` `{connectionId, channelId}` → create.
  `DELETE /api/v1/surfaces/bindings/{id}` → `status:'removed'`
  (non-destructive; history stays).
- Binding auth: personal agent → creator only; workspace agent → any member.
  **[decided]**

## Phase 2 — webhook → turn → reply

- `src/app/api/v1/webhooks/slack/route.ts`:
  `export const POST = bot.webhooks.slack`. Adapter acks inside Slack's 3s
  window; turns run async after ack.
- `bot` lives in `src/server/surfaces/` (new domain folder per convention):
  `chat.ts` (singleton `Chat` instance), `binding-resolver.ts`,
  `surface-conversations.ts`, `surface-turn-runner.ts`.
- Trigger rules v1: `onNewMention` in channels → `thread.subscribe()` so
  follow-ups in that thread don't need re-mention; `onNewMessage` in
  subscribed threads + DMs always triggers. Guard `bot_id`/own echo.
- Resolver: `(team_id, channel_id) → connection → binding → agent → creator`.
  No binding → one-time "I'm not connected here — set me up at getoverlay.io"
  reply, then silent.
- `ensureSurfaceConversation(connection, channel, thread_ts)` → find-or-create
  conversation carrying the external ref fields. Slack thread = Overlay
  conversation; the agent's reply anchors a thread on the user's message.
- `surface-turn-runner` mirrors `automation-turn-runner`: same
  `prepareAutomationAgentTurn` / `finalizeAutomationAgentTurn` steps,
  `programmaticSubjectId: 'surface:slack:<bindingId>'`, acting user = agent
  creator. Inbound persisted with `importedAuthor*` fields so the Overlay
  transcript shows the real Slack sender.
- Outbound via `bot.getAdapter('slack').webClient.chat.postMessage` with
  per-message `username: agent.name` and `icon_url` — the native-client
  escape hatch is how one bot speaks as many agents. Creature-avatar PNG
  endpoint (`/api/v1/agents/{id}/avatar.png`) is the nice-to-have that makes
  `icon_url` real; defer if it drags.
- v1 posts an immediate "working…" placeholder, then the final reply.
  Post-and-edit streaming (`streamingUpdateIntervalMs`) is a v1.5 toggle.

## Phase 3 — agent editor UI

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

## Phase 4 — surface conversations in the app

- Platform conversations appear in the existing chats list, tagged with the
  platform icon + `#channelName`. **Read-only** — transcript renders, no
  composer. Replying happens on the platform.
- The expandable agent→threads sidebar (agents as contacts, threads beneath)
  is the known end-state; `externalThreadRef` data makes it a pure reskin
  later. Not v1.

## Phase 5 — hardening

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
