# Overlay in Slack (Chat SDK)

**Status:** Phases 1 and 2 built; Slack QA pending ([progress](../develop/slack-integration.md)). Mockup: [slack-integration.html](mockups/slack-integration.html).

## Decisions

- Only the **Workspace Overlay** (`workspace_chief`) is in Slack. It delegates to other agents through the Harness.
- **Build from first principles on the Chat SDK** (`chat` + `@chat-adapter/slack`). Do not restore #582; its retired tables stay read-only.
- **Slack is a first-class integration, like the GitHub App:** its own app, `convex/integrations/slack*`, `src/server/integrations/slack/` and settings.
- **Connected apps** lists GitHub, Slack and MCP with their status. Each opens Settings › Connected apps › *App*, built from standard settings rows (icon, title, one line, control) without section headings.
- **Slack page:** workspace and your link; who can ask, people without an account, guests, Slack Connect, and actions in channels (*Ask first*, *Allow*, *Never*). Private results are always private, not a setting. No channel list.

## Formatting

One renderer turns Harness markdown into Slack blocks: headings, lists, tables, code, links, citations, and long output (split, or a file with **Open in Overlay**).

## Slack work in the web app

- **Overlay stores the transcript, and Slack is a copy of it.** Each Slack thread is an ordinary Overlay agent thread with `origin: { platform, teamId, channelId, threadTs, permalink }`, listed under Overlay with a Slack mark; its header shows the channel and **Open in Slack**.
- **Visibility follows Slack.** Channel threads are visible to linked channel members (private channels rechecked on read); DM threads only to their sender.
- **Slack participants** without an Overlay account show by name with a *Not invited* badge.
- **Two-way.** A web reply posts to Slack under the member's name, and Overlay answers in both.

## Who can use it

1. Each Slack user is a *linked member*, an *unlinked member* or a *guest/external user*. Linking uses Sign in with Slack.
2. The owner chooses *Linked members only* (default), *Everyone except blocked* or *Only allowed people*. Guests and Slack Connect are off by default.
3. Unlinked people get **Connect to Overlay**, and their request resumes after linking. Optionally, channel-only access: no workspace data or actions.

## Access rule

**Effective access = agent scope ∩ requester's access ∩ access of everyone in the audience.** Anything the channel can't see goes only to the requester. Revocation fails closed mid-run.

## Routing

- **Workspace resources:** Overlay or a workspace specialist. A named agent wins.
- **Requester's personal resources:** the requester's own personal agent, after consent. The result is private by default.
- **Mixed tasks:** split them, and merge only shareable output.
- **Someone else's personal agent:** only through their grant (Chief plan, Phase 5).

## Implementation

| Area | Work |
|---|---|
| Ingress | `/api/v1/integrations/slack/events`, OAuth and link routes |
| Data | `slackInstallations`, `slackIdentityLinks`, `slackSettings`, conversation `origin` |
| Turns | Admit with requester, tier and audience; run the Harness; deliver to Slack and Convex |
| Policy | `resolveSurfaceAccess()` for tools, delivery and web reads |
| UI | Connected apps list and app pages, thread origin, Slack participants |

## Phases

1. Install, linking, linked mentions and DMs, renderer, web threads, access rule.
2. Web replies to Slack, personal-agent handoff, approvals.
3. Open access modes, guests, Slack Connect.

## QA

PR Preview with a test Slack app: formatting, unlinked users, a private-channel leak, web replies, revocation mid-run.
