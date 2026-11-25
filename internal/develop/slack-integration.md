# Slack integration

Overlay in Slack is a first-class integration, like the GitHub App. One Overlay Slack app is installed per Slack workspace, and only the Workspace Overlay (`workspace_chief`) answers there. The plan is `internal/plans/SLACK_WORKSPACE_OVERLAY_PLAN.md`; this page describes what is built.

## Status

| Piece | State |
|---|---|
| Install (OAuth), Sign in with Slack linking, uninstall | Built, unit tested; not yet tested against a real Slack app |
| Mentions and DMs from linked members become Workspace Overlay turns | Built, unit tested |
| Reply renderer (markdown, citations, math, HTML, splitting) | Built, golden tests |
| Delivery workflow posting the reply to Slack | Built; not yet run on a Preview |
| Room rule: Slack channel threads are shared rooms | Built |
| Settings › Connected apps list, GitHub, Slack and MCP pages | Built |
| Slack mark on threads, channel and Open in Slack in the header | Built |
| Phase 2: a web reply in a Slack-started thread is posted to Slack as "<name> replied in Overlay" by the Overlay bot, and the answer follows it | Built, unit tested; asker only |
| Phase 2: approvals as a Slack card (Approve, Deny, Open in Overlay); only the asker can answer, through the same path as the web | Built, unit tested |
| Phase 2: in a channel, an "Ask privately" button (once per thread, for members who may have a personal chief; not guests) moves the question to a DM thread with their own personal chief, "{Name}’s Chief", creating it if they have none yet | Built, unit tested |
| Phase 3: Who can ask (All linked members, Everyone except blocked, Only allowed people) with a per-member list for owners and admins (`slackPeopleAccess`) | Built, unit tested |
| Phase 3: a question from someone who still has to link is kept for an hour and runs once they link (`overlay:pending:<team>:<user>` in Slack state) | Built, unit tested |
| Phase 3: Guests toggle (workspace guests), Slack Connect toggle; people from another organization get a one-line reason instead of silence | Built, unit tested |
| Phase 3: Channel access only for people without an Overlay account | Not built: needs a decision on who pays for those answers (todos.md) |
| Web visibility for other linked channel members, Slack participants without accounts | Not built: each asker has their own thread, visible to them |

Hosted QA needs a test Slack app on a PR Preview (see QA below).

## How a request flows

1. Slack posts to `POST /api/v1/integrations/slack/events`. The Chat SDK's Slack adapter verifies the signature, dedupes retries and acknowledges in time; handlers run after the response.
2. `registerSlackHandlers` (`src/server/integrations/slack/slack-inbound.ts`) handles `onNewMention` and `onDirectMessage`. Bots and the app itself are ignored. The question is built from the event's raw text by `slackPromptText`: `<url|label>` becomes a markdown link, mentioned people become `@Name` (looked up through the adapter's cached `getUser`), and only the bot's own mention (`botUserId` of the installation) is removed.
3. `admitSlackMessage` resolves the asker with `integrations/slack:resolveRequesterByServer`. A link counts only while its owner is an active member of the Overlay workspace bound to that Slack team. Unlinked people get a private **Connect to Overlay** prompt. Guests and Slack Connect channels are refused unless the workspace allows them (guests stay off in Phase 1).
4. `resolveThreadByServer` finds or creates the asker's own Workspace Overlay thread for that Slack thread (table `slackThreads`, keyed by team, channel, thread and person) and stamps the conversation's `origin`.
5. The question is saved as the asker's message and the turn starts through `startWorkspaceAgentTurns`, exactly like a web message, so the turn runs with the asker's access. If it can't start after admission (governance or budget refusal, no Workspace Overlay, no agent participant), the asker gets a private "Overlay couldn't start on this. Open Overlay to see why." with a link to the thread, or to the workspace when no thread exists. A question saved until linking that is then refused gets the same private reasons as a new message, in its original thread.
6. `slackReplyWorkflow` (`src/server/workflows/slack-reply.ts`) waits for the run to settle. Before every post it checks the asker is still linked and a member, and posts nothing if not. It renders all of the turn's assistant text with `renderSlackReply` (mentions neutralized, so an agent can't ping `@channel`, `@here`, `@everyone`, groups or people) and posts it with the installation's bot token, one workflow step per Slack message so a retry never re-posts earlier messages. A run that waits for an answer or approval gets one "Open in Overlay" note.

Each person asking in a Slack thread gets their own Overlay thread, so nobody's turn runs with someone else's access.

## Access

- Slack channel threads count as shared rooms (`conversationAudienceIsShared` in `convex/harness/runs.ts`): the agent does not load the asker's personal memories, files or skills there. DMs behave like a private web thread.
- Memories follow the place (`memoryOwnerForPlace` in `src/shared/agents/agent-memory.ts`): what an agent learns in a Slack channel is workspace knowledge; what it learns in a DM is the person's private memory, which a channel answer never recalls. A personal chief's and a creator-only agent's memories are always private to their person.
- Personal chiefs never answer in a channel. `resolveThreadByServer` accepts `agentRole: 'personal_chief'` only for a DM origin (`SLACK_PERSONAL_CHIEF_DM_ONLY`) and resolves only the asker's own private chief, ensuring it with `includePersonal` (`SLACK_PERSONAL_CHIEF_MISSING` if that fails). `personalChiefByServer` tells the offer and the button whether the asker may have one and its name.
- Installing needs an owner or admin. One Slack team binds to one Overlay workspace and vice versa.
- Disconnecting deletes the bot token; uninstalling in Slack (`app_uninstalled`) or revoking the bot token (`tokens_revoked` with bot tokens; the SDK doesn't surface it, so the events route handles the verified body with `handleSlackTokensRevoked`) does the same.
- Org-wide Enterprise Grid installs are refused at the OAuth callback (`slackError=enterprise_install`); install into a single workspace.

## Chat SDK rules

- No source file may contain a literal import specifier resolving to the `chat` package (`src/server/workflows/workflow-imports.test.ts`). `slack-bot.ts` loads it with a comment inside the dynamic import, and the delivery workflow loads `slack-bot.ts` the same way.
- SDK state (installations, locks, dedupe keys) lives in Convex (`slackChatState`, `ConvexSlackState`), never in memory. Bot tokens are encrypted by the adapter with `SLACK_ENCRYPTION_KEY`. The hourly `integrations/slack:cleanupExpiredState` cron deletes expired rows in batches through `by_expiresAt`. Everything but installations expires: pending questions after an hour, once-per-thread markers (`private-offer:`, `private-started:`) after 30 days.
- `concurrency: 'concurrent'`: every message reaches its handler. The default `'drop'` throws `LockError` for a second message in a thread while the first is admitted, and the deduped event is lost; `'queue'` keeps only the latest queued message. Handlers are safe side by side because `resolveThreadByServer` is a Convex mutation that retries on conflict, so both messages land in the same Overlay thread as two turns, like two quick web messages.
- Buttons: Ask privately claims `private-started:<conversationId>` before opening the DM, so a second click starts nothing; its private message is replaced with the outcome through Slack's `response_url` (`editMessage` on the ephemeral id). The shared approval card stays, and its outcome is told privately.

## Decisions

- DMs: each top-level DM to the app starts its own Slack thread and Overlay thread; Overlay replies in that Slack thread, and follow-ups in it continue the same Overlay thread. Kept as is.

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
- **Sign in with Slack:** user scopes `openid, profile` (OAuth & Permissions › User Token Scopes).
- **Event subscriptions:** request URL `<app>/api/v1/integrations/slack/events`; bot events `app_mention, message.im, app_uninstalled, tokens_revoked`.
- **Interactivity & Shortcuts:** on, Request URL `<app>/api/v1/integrations/slack/events` (the same endpoint; buttons need it).
- **App Home:** Messages tab on, and "Allow users to send Slash commands and messages from the messages tab" checked, or people can't DM the app.

## QA

On a PR Preview with a test Slack app: install, link, mention in a public and a private channel, DM, an unlinked user, formatting of a long reply with a table, code and citations, uninstalling, and unlinking while a run is in progress (the reply must not post).
