# Overlay in Slack (Chat SDK)

**Status:** Proposed. Not started.

## Goal

Meet teams in Slack. Only the **Workspace Overlay** (the `workspace_chief` / `isDefault` agent) is installed. It answers mentions and DMs and orchestrates the other agents through the existing Harness. Other platforms come later.

## Why the Chat SDK

The Harness already runs durable Workflow turns on the AI SDK. The Chat SDK (`chat` + `@chat-adapter/slack`) only adds the platform layer: signature checks, dedupe, threads, streaming, cards and actions, and multi-workspace OAuth. Later adapters reuse the same handlers.

PR #582 removed our first version (`4a65e3f4^`: `src/server/surfaces/*`, `ConvexChatStateAdapter`, `surfaceAgentTurnWorkflow`). Restore those pieces instead of rewriting them. Keep the Workflow VM exclusion on the `chat` import and the Convex state backend; in-memory state cannot be shared across serverless instances.

## Who can use it

1. **Identity.** Each Slack user is a *linked member*, an *unlinked workspace member* or a *guest/external user*. Linking uses Sign in with Slack (OIDC).
2. **Owner setting:** *Linked members only* (default), *Everyone except blocked*, or *Allowlist*. Guests and Slack Connect each have a separate switch, both off by default.
3. **Unlinked requester.** Overlay replies with a **Connect to Overlay** card, and the request runs after linking. If the owner allows unlinked use, the request instead runs in a *channel-guest* scope: the thread, web, and resources marked shareable in channels. That scope has no writes, and its usage is charged to the workspace.

## Access rule

**Effective access = agent scope ∩ requester's access ∩ access of everyone in the audience**

The audience is the channel's members, or only the requester in a DM. If a result exceeds that audience, Overlay replies with an ephemeral message or a DM. Writes follow per-tool policy: *auto*, *approve* (an action card for the requester or an admin) or *never*. Revoking a link, removing someone from a channel or uninstalling the app fails closed mid-run.

## Routing

Route by **whose resources** the task needs:

- **Workspace resources:** handle it, or delegate to a workspace specialist through assignments. A named agent ("ask Quill") overrides inference.
- **Requester's personal resources:** delegate to the requester's own personal agent after one-time consent. Results are private by default, with **Post to thread**.
- **Mixed tasks:** split them, and merge only shareable output.
- **Another person's personal agent:** never call it directly. It becomes a request to that person through a grant (Chief plan, Phase 5).

## Implementation

| Area | Work |
|---|---|
| Ingress | `/api/v1/webhooks/slack`: mentions, subscribed threads, DMs, actions, uninstall |
| Data | Connections, identity links, access settings and channel policy in Convex. Revive or replace the retired `surface*` tables |
| Turns | Admit the turn with requester, tier and audience, then run the Harness. Stream results through `thread.post` |
| Policy | One server-side `resolveSurfaceAccess()` for tools and delivery |
| UI | Settings → Integrations → Slack: install, access mode, guests, approvals |

## Phases

1. Install, linked-member mentions and DMs, linking, access rule, private fallback.
2. Personal-agent consent and handoff, approval cards.
3. Everyone/allowlist modes, channel-guest scope, guests, Slack Connect.

## QA

Use the PR Preview with a dedicated Slack test app. Cover linked and unlinked users, a private-channel leak attempt, an approval, personal-agent consent and mid-run revocation.
