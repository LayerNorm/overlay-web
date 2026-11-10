# Surfaces: Slack app setup

Slack is the first external surface for Overlay agents. We run in **multi-workspace OAuth mode** — one
Slack app, installable into any customer's Slack workspace; per-team bot
tokens resolve through the Chat SDK state store, never a shared env token.

## Create the app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
   → **From a manifest** → paste the YAML below.
2. Set `request_url` / `redirect_urls` to the environment you're wiring:
   - production: `https://www.getoverlay.io`
   - test: the current isolated `https://pr-<number>.preview.getoverlay.io` URL
   - local dev: a tunnel URL (e.g. `cloudflared tunnel` / `ngrok`) — Slack
     requires a public HTTPS endpoint.
3. From the app's **Basic Information** page, copy Client ID, Client Secret,
   and Signing Secret into env (see below). Generate `SLACK_ENCRYPTION_KEY`
   with `openssl rand -hex 32`.

For development create a **separate dev Slack app** from the same manifest
pointed at your tunnel — do not point the production app at localhost.

## Manifest

### Sender sign-in

Enable **Sign in with Slack** for this app. Register the OIDC redirect URL
`https://<this-environment>/api/v1/surfaces/slack/identity/callback` in the app's
redirect URLs (separately from the installation callback). Use the isolated
Preview host and a separate development app for testing.

Sender linking is a separate OIDC flow requesting only `scope=openid`; do not
add it to the bot installation scopes or combine Sign in with Slack scopes with
ordinary Slack user-token scopes. Overlay uses the app's existing client ID and
client secret, verifies Slack's signed ID token, team, subject and nonce, and
does not use email matching. No user access token is retained. The manifest lists
the OIDC callback; enable the Sign in with Slack settings in the app dashboard.

An Overlay session and current workspace membership are required to link.
Requests expire after ten minutes and can be consumed only once. A Slack user
cannot be linked to two Overlay accounts in the same team; linking a different
Slack user revokes the account's previous team link. Unlink with a same-origin
`POST /api/v1/surfaces/slack/identity/unlink` containing `workspaceId` and `linkId`;
only that user or a workspace admin/owner may do so.

Linked current workspace members may reply in an existing thread in a
Chief-bound public Slack channel. Admission enrolls the sender as a member of
that mirrored conversation only; it grants no other conversation, file, memory
or workspace permissions. New threads enroll their verified initiating member.
Shared-room restrictions remain in force. Revoked links, lost workspace membership
or changing the linked identity stop admission and resumed execution. Resume
also requires current conversation participation and never enrolls or adopts
a replacement identity; historical runs without sender identity fail closed.
Unlinked/unauthorized inbound senders receive only an ephemeral linking prompt
and must resend after linking. Historical unlinked runs fail closed.

```yaml
display_information:
  name: Overlay
  description: Your AI workforce, reachable in Slack. Overlay agents work where your team already talks.
  background_color: "#fafafa"

features:
  agent_view:
    agent_description: Overlay agents with memory, files, tools and their own computers — managed from getoverlay.io.
  bot_user:
    display_name: Overlay
    always_online: true

oauth_config:
  redirect_urls:
    - https://www.getoverlay.io/api/v1/surfaces/slack/callback
    - https://www.getoverlay.io/api/v1/surfaces/slack/identity/callback
  scopes:
    user:
      - openid                  # separate Sign in with Slack flow only
    bot:
      # inbound awareness
      - app_mentions:read
      - channels:history
      - groups:history
      - im:history
      - mpim:history
      - reactions:read
      - users:read
      - users:read.email        # exposes message.author.email → importedAuthorEmail
      # outbound
      - chat:write
      - reactions:write
      - im:write                # open DM threads with users
      # agent experience (agent_view)
      - assistant:write
      # channel discovery for the editor's channel picker + self-invite
      - channels:read
      - groups:read
      - channels:join

settings:
  event_subscriptions:
    request_url: https://www.getoverlay.io/api/v1/webhooks/slack
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
      - message.mpim
      - member_joined_channel
      - app_home_opened
      - app_context_changed
      - agent_session_stopped
      - agent_session_title_changed
      - app_uninstalled
      - tokens_revoked
  interactivity:
    is_enabled: true            # feedback buttons now; approval cards later
    request_url: https://www.getoverlay.io/api/v1/webhooks/slack
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

### Notes on choices

- Slack installation and channel management are workspace-admin/owner operations.
  Channel bindings target the server-resolved workspace Chief; specialist bindings
  remain stored for migration but do not route messages. Only public, non-shared
  channels are eligible; DMs, private channels and Slack Connect are disabled.
  The bindings API is workspace-scoped (omit `agentId` on GET/POST).
  Disconnect with `DELETE /api/v1/surfaces/connections?connectionId=…`.

- **`agent_view`** — Slack's native agent surface: per-message threads, Working
  indicator, native stop button, session titles. New Slack apps can only use
  `agent_view` (legacy `assistant_view` deprecated Aug 2026). Enabled on the
  adapter via `createSlackAdapter({ agentView: true })`.
- **Bot identity** — all replies use the installed Overlay bot's name and icon;
  no per-agent `username`, `icon_url` or `icon_emoji` overrides are sent.
  `chat:write.customize` is no longer requested. Existing installs do not need
  to reauthorize for this scope reduction; previously granted tokens may retain
  it, but Overlay no longer uses it.
- **`app_uninstalled` / `tokens_revoked`** — handled by the webhook route
  directly (the Chat SDK doesn't dispatch them). `app_uninstalled` marks the
  connection `uninstalled`; a `tokens_revoked` carrying bot tokens marks it
  `degraded` (user OAuth revocations don't affect the bot token). Either way
  inbound routing no-ops until the workspace reconnects.
- **`channels:join`** — reserved for a future self-join on bind. Today the
  bot can only answer in channels it has joined: invite it with
  `/invite @Overlay` (the channel picker marks unjoined channels
  "invite needed" and shows this hint).
- **`interactivity`** — enabled now so native feedback buttons work and
  approval cards are an additive change later.

## Several agents in one channel

One Slack install has one bot user (`@Overlay`), and any number of agents can
be bound to the same channel. Each reply is posted under the answering agent's
name. Inbound routing (`src/shared/surfaces/surface-routing.ts`):

1. `@Overlay <agent name> …`: the agent named right after the mention (longest
   bound name wins; the name is stripped from the prompt).
2. A follow-up in a thread goes to the agent that owns the thread (stored in the
   Chat SDK thread state) unless another agent is named.
3. A channel with a single agent answers every mention, as before.
4. Otherwise the bot replies with the list of agents to choose from.

## Env vars

| Var | Purpose |
| --- | --- |
| `SLACK_CLIENT_ID` | OAuth client id (multi-workspace installs) |
| `SLACK_CLIENT_SECRET` | OAuth secret |
| `SLACK_SIGNING_SECRET` | webhook signature verification |
| `SLACK_ENCRYPTION_KEY` | AES-256-GCM key encrypting stored bot tokens at rest (`openssl rand -hex 32`) |
| `SLACK_REDIRECT_URI` | optional override; default `<origin>/api/v1/surfaces/slack/callback` |

Chat SDK state: `ConvexChatStateAdapter` (`src/server/surfaces/convex-chat-state.ts`
over `convex/surfaces/chatState.ts` and the `surfaceChatState` table) stores
installations and encrypted bot tokens, thread subscriptions, locks, and dedupe
keys, so every serverless instance shares them. A 15-minute cron prunes expired
rows. `@chat-adapter/state-memory` is used only when no Convex URL is configured
(unit tests, offline runs); it cannot carry an install from the OAuth callback
to a later webhook, so Slack does not work there.
