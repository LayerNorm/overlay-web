# Changelog

This file records user-visible and operational changes that reach `main`. Pull requests add concise entries under **Unreleased**; the integration agent moves shipped entries into dated sections when cutting a release. Pull requests and Git history remain the detailed implementation record.

## Unreleased

### Changed

- Simplified agentic development to two roles: Builders submit pull requests to `staging`, and the Integration agent owns staging QA and promotion from `staging` to `main`.
- Established a worktree-first agentic development process with a designated integration role and history-preserving merge commits by default.
- Disabled pull-request Preview deployments in both Vercel projects; hosted pre-production QA runs only from the dedicated staging project's `staging` branch.

## 2026-08-30

### Added

- Added an exhaustive web API route catalog and compact route index ([#72](https://github.com/LayerNorm/overlay-web/pull/72)).
- Added Hermes connected-agent support ([#67](https://github.com/LayerNorm/overlay-web/pull/67)).
- Prepared Bring Your Own Agents for production rollout ([#66](https://github.com/LayerNorm/overlay-web/pull/66)).

### Changed

- Enabled contextual memory in agent direct messages and channels ([#69](https://github.com/LayerNorm/overlay-web/pull/69)).
- Improved project navigation and made inline project naming safer ([#71](https://github.com/LayerNorm/overlay-web/pull/71)).
- Published agent-host packages under the LayerNorm npm scope ([#68](https://github.com/LayerNorm/overlay-web/pull/68)).
