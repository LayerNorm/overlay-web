# Changelog

This file records user-visible and operational changes that reach `main`. Pull requests add concise entries under **Unreleased**; the integration agent moves shipped entries into dated sections when cutting a release. Pull requests and Git history remain the detailed implementation record.

## Unreleased

- Added a versioned personal plan catalog that presents existing Stripe quantities as Starter, Pro, Max, or a preserved legacy plan without rewriting customer subscriptions.
- Restricted new personal subscription checkout to Starter, Pro, or Max on the existing Stripe unit Price; added duplicate-subscription protection and a guarded preview/confirm flow that prorates upgrades now and schedules downgrades for renewal.
- Replaced variable personal pricing with responsive Free, Starter, Pro, and Max cards; added guarded purchase and plan-change confirmations, current and legacy plan states, clearer Account billing indicators, and a compact sidebar plan status while keeping all top-up controls in Account.
- Added repeatable Stripe test-mode payment QA for named Checkout quantities, legacy migration previews, failed-payment pending updates, portal recovery/cancellation, webhook allowances, and duplicate-subscription prevention; unpaid flows can no longer grant a new or upgraded allowance before Stripe confirms payment.
- Propagated authoritative past-due and scheduled-cancellation state through Convex, PostgreSQL, web, sidebar, Account, bootstrap, and native subscription responses; the Customer Portal now fails closed unless cancellation occurs at period end, and both webhook lanes preserve the last paid allowance until Stripe confirms a change.

### Added

- Agent scope navigation moved from header tabs into the secondary sidebar (Personal/Workspace/Archived, matching chats/files), the editor footer is a plain end-of-scroll action row, and agents carry an explicit chat-platform enablement list: Workspace agents default to all platforms, Personal agents default to none, older agents grandfather to all, and the Slack bot silently skips disabled agents on mentions, slash commands, and Manage actions. Backed by Postgres migration `0076_agent_platforms` with no Convex migration needed.
- Agents page splits into Personal, Workspace, and Archived tabs with counts; archived agents show Personal/Workspace labels without actions, the agents list API accepts `?includeArchived=1`, and creating from the Personal tab defaults new agents to Personal.
- Workspace agents now have an access mode: **Only me** (`visibility: 'creator'`) or **Everyone in workspace** (`visibility: 'workspace'`, the default). Creator-only agents are hidden from the agents directory, workspace search, and direct reads for everyone but their creator (reported as not found, so their existence does not leak); only the creator can edit them, while workspace managers keep archive access as a safety valve. The agent editor has a matching Access control and directory tiles show an "Only me" badge. Backed by Postgres migration `0073_agent_visibility` (nullable column; existing agents stay workspace-visible) with no Convex migration needed.
- Creator-only agents are now also gated on every invocation path: DMs with one by anyone but its creator return 404, @-mentions of one by non-creators silently produce no agent run (including in pre-existing DMs after an Everyone → Only me flip), and new creator-only agents no longer auto-join public channels. Flipping Only me → Everyone grants no retroactive channel joins.
- Agent creation and editing moved from a dialog to dedicated full-page routes (`/app/agents/new` and `/app/agents/:id`) with Identity, Behavior, Access, Connection, and Danger-zone sections, a sticky save bar, and a post-create "Say hello" handoff that opens a DM with the new agent. Directory tiles now attribute each agent to its creator ("by {name}").
- Added the chat-platform bot seam: `WorkspaceGovernanceService.resolvePlatformActor` maps a linked Slack/Teams user to its workspace principal (manager-gated linking, uniform not-found for unmapped identities), and the new `PlatformAgentAccess` routes bot list/DM requests through the same visibility-enforced services first-party clients use. No new API routes; the Chat SDK bot processes, platform OAuth, and install storage remain future work.
- Slack bot spike and multi-workspace installs (staging): `POST /api/webhooks/slack` answers URL verification and runs @-mention/DM turns through the mapped user's Overlay agent DM (same visibility, DM-guard, and entitlement path as first-party clients), posting the reply back to the thread; `GET /api/v1/slack/install` (manager-gated) starts OAuth and `GET /api/webhooks/slack/oauth` completes it, storing AES-256-GCM-encrypted tokens in the new platform-installations table (Postgres migration `0074_platform_installations`, Convex table added with no migration). Requires `SLACK_SIGNING_SECRET` plus, for installs, `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`/`SLACK_REDIRECT_URI`/`SLACK_ENCRYPTION_KEY`; without them the webhook reports unconfigured.
- Slack bot invocation wiring: channel @-mentions resolve a named agent against the caller's visible directory (default-agent fallback), `/overlay agents` lists agents ephemerally, `/overlay ask <name> <question>` runs a turn and posts to the channel, and every reply carries a Manage in Overlay button whose clicks are audit-logged as the conversion event before answering with an ephemeral deep link. Stop-button cancellation stays deferred to the `Chat`-class streaming phase.
- Slack bot pilot hardening: at-most-once delivery via platform event receipts (Postgres migration `0075_platform_event_receipts`, Convex table, 30-day sweep), IP rate limits on the unauthenticated webhook routes, ordering tests proving bot turns run the mapped user through limits before any model work, and a token-custody/rotation runbook in the new `docs/develop/chat-platform-bots.mdx` living doc.
- Workspace managers get a Connected chat settings section: linked Slack/Teams identities with Slack display names, manual link/unlink against workspace members, and connected-workspace inventory with one-click Slack install start. Unlinking retires the mapping immediately without touching membership or history.

- Connected agents that advertise slash commands over ACP now power a composer slash menu in their DMs: the Agent Host forwards `available_commands_update`, the transcript stores it as a stable part, and typing `/` lists the agent's commands with descriptions. Agents that do not advertise commands are unaffected; activating this in production requires the next Agent Host package release.

### Changed

- Released the Agent Host and bridge protocol together at `0.3.5`, which forwards agents' advertised ACP slash commands (`available_commands_update`) to the transcript; production DM slash menus and the composer slash button activate once connected hosts are restarted on `0.3.5`.
- Unified the list-page UI system: added shared `Tile`, `TileGrid`, `TileIcon`, `TileSkeleton`, `CreateTile`, `ListRow`, and `HeaderSearch` primitives to `@overlay/ui` and migrated the Projects, Knowledge, Agents, and Extensions (Connectors, Skills, MCP Servers) list pages plus the Files/Knowledge header onto them, so tiles, list rows, and page headers share one spacing, radius, hover, and dark-mode language.
- Projects can now be archived and restored from a three-dot menu on each project tile, and the projects sidebar gained All/Archived subpages that list active and archived projects respectively.
- Newly created projects now open straight into inline rename with the title text pre-selected, whether created from the projects page or the sidebar, so the name can be typed immediately.
- Made a pristine Agent Host state store adopt the server's command stream position on first delivery (a previous host incarnation may have consumed earlier sequences), while keeping out-of-order rejection fail-closed once a cursor exists; released the Agent Host and bridge protocol together at `0.3.4`.
- Scoped direct-message and channel creation to the workspace visible in the UI, surfaced connected-agent start failures in chat, expired stale environment health, terminalized rejected host commands, and released the Agent Host and bridge protocol together at `0.3.3` with a pinned Node 24 macOS LaunchAgent that retains access to user-installed adapter CLIs. Agent Host SQLite state is now bound to its environment and workspace, preventing a misconfigured or migrated host from rejecting a new environment's command sequence using stale durable state.
- Enforced manual production releases with a source-controlled Vercel rule that suppresses Git-triggered deployments from `main` while preserving explicit CLI deployment and promotion.
- Made the staging Vercel project branch-only: its Ignored Build Step now fails closed and runs only for the exact `staging` ref, preventing PR, manual, hook, and other-branch builds.
- Retired the obsolete Overlay Vercel projects (`overlay-web-rc`, `overlay-landing-prod-migration-runner`, and the misspelled `overlay-web-postgress`); the canonical Overlay set is now `overlay-landing`, `overlay-web-staging`, and `overlay-web-postgres`.
- Clarified that the Integration agent reuses one long-lived `staging` worktree across pull requests, reserving temporary worktrees for exceptional investigations.
- Added an Integration preflight to confirm the PR base (`staging` or `main`) and Vercel deployment intent before acting.
- Added an owner-only direct-push fast path for `DevelopedByDev` on `main` and `staging`, while keeping force-pushes and branch deletion blocked for every account.

### Fixed

- Fixed Workspace → People showing the authenticated provider user ID instead of the person’s profile name; existing member principals are repaired from the current browser session, and newly created workspaces start with the correct owner name.
- Allowed `data-remote-agent-commands` parts in the conversation message schema and BFF serialization: the Convex validator rejected connected-agent command events with 500s, and the BFF conversation serializer dropped the commands payload, leaving the agent DM slash menu empty after a page load.
- Fixed the agent DM slash menu ignoring typed input: the composer kept its live text outside React state by design, so the slash-menu hook only ever saw programmatically set text — typing `/` did not open the menu, filtering and selection did not update, and choosing a command left the menu stuck open. Typing now refreshes composer state only while a slash token is on screen, preserving the no-re-render-per-keystroke behavior for normal text.

## 2026-08-30

### Added

- Added an exhaustive web API route catalog and compact route index ([#72](https://github.com/LayerNorm/overlay-web/pull/72)).
- Added Hermes connected-agent support ([#67](https://github.com/LayerNorm/overlay-web/pull/67)).
- Prepared Bring Your Own Agents for production rollout ([#66](https://github.com/LayerNorm/overlay-web/pull/66)).

### Changed

- Renamed the public Agent Host packages to the product-qualified `@layernorm/overlay-agent-host` and `@layernorm/overlay-agent-bridge-protocol` names ([#78](https://github.com/LayerNorm/overlay-web/pull/78)).
- Simplified agentic development to two roles: Builders submit pull requests to `staging`, and the Integration agent owns staging QA and promotion from `staging` to `main` ([#77](https://github.com/LayerNorm/overlay-web/pull/77)).
- Added reusable Builder and Integration agent prompt files that encode the role boundaries and handoff contract ([#77](https://github.com/LayerNorm/overlay-web/pull/77)).
- Established a worktree-first agentic development process with a designated integration role and history-preserving merge commits by default ([#77](https://github.com/LayerNorm/overlay-web/pull/77)).
- Disabled pull-request Preview deployments in both Vercel projects; hosted pre-production QA runs only from the dedicated staging project's `staging` branch ([#77](https://github.com/LayerNorm/overlay-web/pull/77)).
- Disabled Git-triggered production Vercel deployments; merging `main` now leaves a release merged but not deployed until an explicit production deployment is authorized ([#79](https://github.com/LayerNorm/overlay-web/pull/79)).
- Enabled contextual memory in agent direct messages and channels ([#69](https://github.com/LayerNorm/overlay-web/pull/69)).
- Improved project navigation and made inline project naming safer ([#71](https://github.com/LayerNorm/overlay-web/pull/71)).
- Published agent-host packages under the LayerNorm npm scope ([#68](https://github.com/LayerNorm/overlay-web/pull/68)).
