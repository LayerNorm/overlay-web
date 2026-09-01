# Changelog

This file records user-visible and operational changes that reach `main`. Pull requests add concise entries under **Unreleased**; the integration agent moves shipped entries into dated sections when cutting a release. Pull requests and Git history remain the detailed implementation record.

## Unreleased

### Added

- Connected agents that advertise slash commands over ACP now power a composer slash menu in their DMs: the Agent Host forwards `available_commands_update`, the transcript stores it as a stable part, and typing `/` lists the agent's commands with descriptions. Agents that do not advertise commands are unaffected; activating this in production requires the next Agent Host package release.

### Changed

- Made a pristine Agent Host state store adopt the server's command stream position on first delivery (a previous host incarnation may have consumed earlier sequences), while keeping out-of-order rejection fail-closed once a cursor exists; released the Agent Host and bridge protocol together at `0.3.4`.
- Scoped direct-message and channel creation to the workspace visible in the UI, surfaced connected-agent start failures in chat, expired stale environment health, terminalized rejected host commands, and released the Agent Host and bridge protocol together at `0.3.3` with a pinned Node 24 macOS LaunchAgent that retains access to user-installed adapter CLIs. Agent Host SQLite state is now bound to its environment and workspace, preventing a misconfigured or migrated host from rejecting a new environment's command sequence using stale durable state.
- Enforced manual production releases with a source-controlled Vercel rule that suppresses Git-triggered deployments from `main` while preserving explicit CLI deployment and promotion.
- Made the staging Vercel project branch-only: its Ignored Build Step now fails closed and runs only for the exact `staging` ref, preventing PR, manual, hook, and other-branch builds.
- Retired the obsolete Overlay Vercel projects (`overlay-web-rc`, `overlay-landing-prod-migration-runner`, and the misspelled `overlay-web-postgress`); the canonical Overlay set is now `overlay-landing`, `overlay-web-staging`, and `overlay-web-postgres`.
- Clarified that the Integration agent reuses one long-lived `staging` worktree across pull requests, reserving temporary worktrees for exceptional investigations.
- Added an Integration preflight to confirm the PR base (`staging` or `main`) and Vercel deployment intent before acting.
- Added an owner-only direct-push fast path for `DevelopedByDev` on `main` and `staging`, while keeping force-pushes and branch deletion blocked for every account.

### Fixed

- Allowed `data-remote-agent-commands` parts in the conversation message schema and BFF serialization: the Convex validator rejected connected-agent command events with 500s, and the BFF conversation serializer dropped the commands payload, leaving the agent DM slash menu empty after a page load.

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
