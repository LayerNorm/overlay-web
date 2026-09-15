# Surfaces: Slack app setup

Slack is the first external surface for Overlay agents (see
`docs/plans/SURFACES_PLAN.md`). We run in **multi-workspace OAuth mode** — one
Slack app, installable into any customer's Slack workspace; per-team bot
tokens resolve through the Chat SDK state store, never a shared env token.

## Create the app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
   → **From a manifest** → paste the YAML below.
2. Set `request_url` / `redirect_urls` to the environment you're wiring:
   - production: `https://www.getoverlay.io`
   - staging: `https://staging.getoverlay.io`
   - local dev: a tunnel URL (e.g. `cloudflared tunnel` / `ngrok`) — Slack
     requires a public HTTPS endpoint.
3. From the app's **Basic Information** page, copy Client ID, Client Secret,
   and Signing Secret into env (see below). Generate `SLACK_ENCRYPTION_KEY`
   with `openssl rand -hex 32`.

For development create a **separate dev Slack app** from the same manifest
pointed at your tunnel — do not point the production app at localhost.

## Manifest

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
  scopes:
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
      - chat:write.customize    # post as the agent's own name/avatar (Scout, not "Overlay App")
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

- **`agent_view`** — Slack's native agent surface: per-message threads, Working
  indicator, native stop button, session titles. New Slack apps can only use
  `agent_view` (legacy `assistant_view` deprecated Aug 2026). Enabled on the
  adapter via `createSlackAdapter({ agentView: true })`.
- **`chat:write.customize`** — required for per-agent `username`/`icon_url` on
  `chat.postMessage`; this is how different Overlay agents appear as
  themselves in one workspace.
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

## Env vars

| Var | Purpose |
| --- | --- |
| `SLACK_CLIENT_ID` | OAuth client id (multi-workspace installs) |
| `SLACK_CLIENT_SECRET` | OAuth secret |
| `SLACK_SIGNING_SECRET` | webhook signature verification |
| `SLACK_ENCRYPTION_KEY` | AES-256-GCM key encrypting stored bot tokens at rest (`openssl rand -hex 32`) |
| `SLACK_REDIRECT_URI` | optional override; default `<origin>/api/v1/surfaces/slack/callback` |

Chat SDK state: `@chat-adapter/state-pg` takes `{ url }` — pass
`OVERLAY_DATABASE_URL` when the Postgres backend is present. On Convex-only
deployments, `OverlayStateAdapter` (repository-backed, see plan) is the
follow-up; `@chat-adapter/state-memory` is for local dev/tests only.
