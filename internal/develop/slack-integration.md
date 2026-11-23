# Slack integration

Overlay in Slack is a first-class integration, like the GitHub App. One Overlay Slack app is installed per Slack workspace, and only the Workspace Overlay (`workspace_chief`) answers there. The plan is `internal/plans/SLACK_WORKSPACE_OVERLAY_PLAN.md`; this page describes what is built.

## Status

| Phase 1 piece | State |
|---|---|
| Install (OAuth), Sign in with Slack linking, uninstall | Built, unit tested; not yet tested against a real Slack app |
| Mentions and DMs from linked members become Workspace Overlay turns | Built, unit tested |
| Reply renderer (markdown, citations, math, HTML, splitting) | Built, golden tests |
| Delivery workflow posting the reply to Slack | Built; not yet run on a Preview |
| Room rule: Slack channel threads are shared rooms | Built |
| Settings › Connected apps list, GitHub, Slack and MCP pages | Built |
| Slack mark on threads, channel and Open in Slack in the header | Built |
| Web visibility for other linked channel members, Slack participants without accounts | Not built: each asker has their own thread, visible to them |

Hosted QA needs a test Slack app on a PR Preview (see QA below).

## How a request flows

1. Slack posts to `POST /api/v1/integrations/slack/events`. The Chat SDK's Slack adapter verifies the signature, dedupes retries and acknowledges in time; handlers run after the response.
2. `registerSlackHandlers` (`src/server/integrations/slack/slack-inbound.ts`) handles `onNewMention` and `onDirectMessage`. Bots and the app itself are ignored.
3. `admitSlackMessage` resolves the asker with `integrations/slack:resolveRequesterByServer`. A link counts only while its owner is an active member of the Overlay workspace bound to that Slack team. Unlinked people get a private **Connect to Overlay** prompt. Guests and Slack Connect channels are refused unless the workspace allows them (guests stay off in Phase 1).
4. `resolveThreadByServer` finds or creates the asker's own Workspace Overlay thread for that Slack thread (table `slackThreads`, keyed by team, channel, thread and person) and stamps the conversation's `origin`.
5. The question is saved as the asker's message and the turn starts through `startWorkspaceAgentTurns`, exactly like a web message, so the turn runs with the asker's access.
6. `slackReplyWorkflow` (`src/server/workflows/slack-reply.ts`) waits for the run to settle. Before every post it checks the asker is still linked and a member, and posts nothing if not. It renders the reply with `renderSlackReply` and posts it with the installation's bot token. A run that waits for an answer or approval gets one "Open in Overlay" note.

Each person asking in a Slack thread gets their own Overlay thread, so nobody's turn runs with someone else's access.

## Access

- Slack channel threads count as shared rooms (`conversationAudienceIsShared` in `convex/harness/runs.ts`): the agent does not load the asker's personal memories, files or skills there. DMs behave like a private web thread.
- Installing needs an owner or admin. One Slack team binds to one Overlay workspace and vice versa.
- Disconnecting deletes the bot token; uninstalling in Slack (`app_uninstalled`) does the same.

## Chat SDK rules

- No source file may contain a literal import specifier resolving to the `chat` package (`src/server/workflows/workflow-imports.test.ts`). `slack-bot.ts` loads it with a comment inside the dynamic import, and the delivery workflow loads `slack-bot.ts` the same way.
- SDK state (installations, locks, dedupe keys) lives in Convex (`slackChatState`, `ConvexSlackState`), never in memory. Bot tokens are encrypted by the adapter with `SLACK_ENCRYPTION_KEY`.

## Routes

| Route | Purpose |
|---|---|
| `GET /api/v1/integrations/slack/install` | Redirects to Slack's install page with sealed state |
| `GET /api/v1/integrations/slack/oauth` | Install callback; stores the token and binds the team |
| `GET /api/v1/integrations/slack/link` | Starts Sign in with Slack |
| `GET /api/v1/integrations/slack/link/callback` | Saves the member's link |
| `POST /api/v1/integrations/slack/events` | Slack Events API |

## Configuration

Environment variables, on the web app only: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` and `SLACK_ENCRYPTION_KEY` (base64 of 32 random bytes: `openssl rand -base64 32`). Without all four, the routes redirect back with `slackError=not_configured` and the events endpoint answers 503.

Slack app settings:

- **OAuth redirect URLs:** `<app>/api/v1/integrations/slack/oauth` and `<app>/api/v1/integrations/slack/link/callback`.
- **Bot scopes:** `app_mentions:read, channels:history, channels:read, chat:write, groups:history, groups:read, im:history, im:read, im:write, users:read` (`SLACK_BOT_SCOPES`). No `chat:write.customize`.
- **Sign in with Slack:** OpenID scopes `openid, profile`.
- **Event subscriptions:** request URL `<app>/api/v1/integrations/slack/events`; bot events `app_mention, message.im, app_uninstalled`.
- **App Home:** Messages tab on.

## QA

On a PR Preview with a test Slack app: install, link, mention in a public and a private channel, DM, an unlinked user, formatting of a long reply with a table, code and citations, uninstalling, and unlinking while a run is in progress (the reply must not post).
