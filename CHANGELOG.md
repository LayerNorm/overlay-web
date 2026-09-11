# Changelog

This file records user-visible and operational changes that reach `main`. Pull requests add concise entries under **Unreleased**; the integration agent moves shipped entries into dated sections when cutting a release. Pull requests and Git history remain the detailed implementation record.

## Unreleased

### Added

- Entry routing is agent-first: signed-out visitors to the root land on the marketing home, while signed-in users go straight to their agents. Try Overlay and all marketing CTAs open the agents surface (previously chats), and the demo shell now opens on a showcase agent conversation instead of the chat demo — the retired tile directory is deleted. Requires the Convex `avatarShape` validators from the creature release on deploy.

- Agent avatars are now anthropomorphic creatures instead of metallic orbs: a solid-color body in one of eight shapes (circle, blob, squircle, pill, triangle, hexagon, cloud, droplet) with blinking eyes that go dark-on-light and light-on-dark automatically. Shape and color are chosen in the agent editor's Identity section (live creature preview, shape grid, color grid) and persist per agent across the sidebar roster, directory tiles, DM headers, and message avatars. Opening the Agents page now resolves the most recently used agent's conversation directly behind a loading indicator — the blank intermediate page only appears when the workspace has no agents. Requires Postgres migration `0074_agent_avatar_shape` (nullable column, circle default) and the additive Convex schema field on deploy.

- Marketing and auth pages now render outside the application shell: home, manifesto, pricing, legal pages, download, and sign-in/sign-up/recovery open on a standalone marketing frame (navbar + content + footer) with no sidebar, no session resolution, and no demo state. The old `/app/home`, `/app/manifesto`, and `/app/pricing` demo addresses redirect to their canonical pages, and the sidebar showcase links point at the top-level routes. Docs were already served outside the shell via the Mintlify proxy.

- The Overlay logo is now a resizable SVG orb component (`OverlayMark`) instead of a PNG: sidebar, marketing nav/footer/showcase, sign-in popover, notebook, and loaders render it crisply at any size. Agents are orbs too (`AgentOrb`): the Overlay master agent renders as the grey metallic mark while every other agent tints the same sphere from its avatar color — in the sidebar roster, directory tiles, DM headers, message avatars (animated while streaming), and the editor, whose color picker now previews orb colorways. Lifecycle emails and favicons intentionally keep the PNG raster.
- Offline Bring-Your-Own-Agent environments now explain themselves in Settings → Environments: why the machine went quiet (asleep or connector closed), that Overlay cannot wake it remotely, and — on macOS — a one-click copy of the persistent-service install command so the connector survives Terminal restarts and logins. The enrollment setup prompt now nudges toward the persistent service for the same reason.
- Workspace agents now have an access mode: **Only me** (`visibility: 'creator'`) or **Everyone in workspace** (`visibility: 'workspace'`, the default). Creator-only agents are hidden from the agents directory, workspace search, and direct reads for everyone but their creator (reported as not found, so their existence does not leak); only the creator can edit them, while workspace managers keep archive access as a safety valve. The agent editor has a matching Access control and directory tiles show an "Only me" badge. Backed by Postgres migration `0073_agent_visibility` (nullable column; existing agents stay workspace-visible) with no Convex migration needed.
- Creator-only agents are now also gated on every invocation path: DMs with one by anyone but its creator return 404, @-mentions of one by non-creators silently produce no agent run (including in pre-existing DMs after an Everyone → Only me flip), and new creator-only agents no longer auto-join public channels. Flipping Only me → Everyone grants no retroactive channel joins.
- Agent creation and editing moved from a dialog to dedicated full-page routes (`/app/agents/new` and `/app/agents/:id`) with Identity, Behavior, Access, Connection, and Danger-zone sections, a sticky save bar, and a post-create "Say hello" handoff that opens a DM with the new agent. Directory tiles now attribute each agent to its creator ("by {name}").
- Added the chat-platform bot seam: `WorkspaceGovernanceService.resolvePlatformActor` maps a linked Slack/Teams user to its workspace principal (manager-gated linking, uniform not-found for unmapped identities), and the new `PlatformAgentAccess` routes bot list/DM requests through the same visibility-enforced services first-party clients use. No new API routes; the Chat SDK bot processes, platform OAuth, and install storage remain future work.

- Connected agents that advertise slash commands over ACP now power a composer slash menu in their DMs: the Agent Host forwards `available_commands_update`, the transcript stores it as a stable part, and typing `/` lists the agent's commands with descriptions. Agents that do not advertise commands are unaffected; activating this in production requires the next Agent Host package release.

### Changed

- The ESLint boundary registry now covers every feature domain — `workspaces`, `agents`, `settings`, `showcase`, `admin`, and `knowledge-bases` are registered — and the workspace primitives all domains share moved out of the feature: `useWorkspace`/`WorkspaceProvider` → `@/contexts/WorkspaceContext`, routing helpers → `@/shared/workspaces/routing`, workspace types → `@/shared/workspaces/types`, and `useWorkspaceChanged` → the new `@/hooks` layer. The `showcase ↔ workspaces` import cycle is gone (the app layer injects the showcase workspace client), and `SERVER_DOMAINS` now covers all server domain directories with `config`/`database`/`env`/`idempotency`/`shared` as leaf infra; existing server cross-wiring is now enumerable warn-only debt.

- File ingestion jobs moved behind a real repository: `FileIngestionJobRepository` (Convex impl, Postgres `unsupportedRepository` sentinel) replaces the inline `lazyConvex` calls in the ingest-jobs routes, so `check-files-route-boundary` is enforced green again. `ActConversationRepository` now exposes a branded `ConversationId` — the BFF no longer imports `convex/_generated` for conversation ids, and the brand propagates through the conversation services and API routes.

- Root folder reorganization landed (~98 → 58 entries): strategy docs moved to `docs/plans/` (internal, exempt from public-docs wording rules), `infra/` + `installer/` consolidated under `deploy/`, `fixtures/` → `tests/fixtures/`, `workflows/` → `src/server/workflows/` (the `@/workflows` alias is gone; imports use `@/server/workflows/*`), and `scripts/` split into `ci/` (checks + boundary rules), `qa/` (smoke/rehearsal harnesses), `db/` (migrations/backfills), and `lib/`. `landing-copy/`, orphaned `app.json`/`eas.json`, and the `workers/` cache are gone; `scripts/dev-setup.sh` and `scripts/vercel-ignore-build.sh` stay at root (pinned by docs and the Vercel project setting).

- The web-complexity ratchet learned two behaviors: baseline exemptions are date-stamped (`recordedAt` carried across regenerations; exemptions older than 90 days print a non-blocking burn-down warning), and the new-file LOC check no longer fires on pure renames — a moved file keeps its exemption when the basename matches a vanished baseline path and LOC stays within 10%.

- The agent editor can dock to the side panel or float as a centered dialog from a single toggle in its title row, sharing the same form, border, and chrome so switching never remounts state. Saving keeps the editor open (with a brief "Saved" confirmation) while Cancel discards and closes.

- The Agents roster now opens the most recently used agent per workspace and orders the sidebar by recency (unused agents stay alphabetical). A conversation open that fails no longer sticks on the blank state: it retries, then shows an explicit error with a manual Retry.
- Made Agents the first primary navigation item and default authenticated home. Selecting an agent now opens its conversation directly, while create and edit controls use the shared right-side panel (and its small-screen dialog presentation) instead of the authenticated directory grid.
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

- Fixed display-math fences glued to equation lines (`… × 100$$`) reflowing onto their own lines, stray `$` inside display spans repaired, and TeX grouping parens preserved inside single-dollar spans — sloppy model output now degrades to readable math instead of raw code.
- Fixed currency amounts being eaten by math rendering (`$20/mo **— $100…` tables): dollar signs followed by digits are now classified as currency openers and escaped unless the span carries explicit TeX structure, so prices survive KaTeX. Genuine digit-led math (`$2x + 1 = 5$`, finance examples) still renders.

- Pinned the Agent Host CLI restart/service hints, README, and launchd test to the released `0.3.5` line (they still pointed at `0.3.4`), and extended the release-gate script to assert all version pins together so the drift cannot recur.
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
