# Plan: Replace subscription plumbing with CLIProxyAPI

Status: Codex-only implementation in review; real-account hosted acceptance pending. Broader provider and workspace-scope work remains planned.

> Progress note: this plan is broader than the current implementation slice.
> The first slice is Codex-only and uses a same-project private bridge; no other
> subscription provider, workspace-scope schema expansion, or production picker
> UI is included or implied. The plan catalog is not account-entitlement proof.

## 1. Establish one subscription backend

Replace Overlay’s custom Codex subscription implementation with CLIProxyAPI as the single backend for subscription authentication, discovery, refresh and inference. Keep Overlay responsible for connection ownership, personal/workspace scope, model preferences and product UX. Preserve ordinary API-key connections and gateway routing. Do not retain the old Codex adapter as a fallback or build additional provider-specific adapters inside Next.js.

## 2. Prove the deployment architecture

Package a pinned CLIProxyAPI revision as a private container service alongside Next.js in the same Vercel project. Connect the services through private bindings and authenticated internal requests. Validate preview deployment, cold starts, streaming, concurrent requests and shutdown behavior before committing to production. Vercel’s container runtime is beta; confirm compatibility rather than assuming its background refresh behavior survives instance shutdown. Keep management endpoints inaccessible to browsers and public traffic. Do not switch hosting providers without reviewing that decision.

## 3. Define the integration boundary

Introduce one Overlay subscription service that translates application operations into CLIProxyAPI operations: connect, complete authorization, list models, refresh catalog, disconnect and infer. Associate each credential with an Overlay connection and its personal or workspace scope. Route inference to the selected connection explicitly; never use an unrestricted shared account pool. Preserve `byok/{connectionId}/{modelId}` identities wherever upstream identifiers remain compatible. CLIProxyAPI owns provider protocol translation; Overlay owns authorization and saved selections.

## 4. Make credentials durable

Integrate CLIProxyAPI’s credential persistence with durable encrypted storage. Do not rely on container-local authentication files. Establish one refresh owner, coordinated across instances, so rotating tokens cannot be refreshed independently by multiple processes. Persist completed credential updates before acknowledging success. Disconnect must immediately prevent further inference and remove stored credentials through retryable cleanup. Logs must exclude tokens and raw authentication responses. Keep connection health separate from saved model preferences.

## 5. Migrate Codex and remove obsolete code

Inventory existing connections, credential formats, model selections and consumers. Import credentials only where compatibility and refresh ownership are verified; otherwise require a clearly explained one-time reconnect. Preserve connection identity and preferences wherever possible, while disabling dispatch until authorization succeeds. Validate CLIProxyAPI-backed Codex end to end, then cut traffic over and delete the custom authorization, discovery, transport and refresh implementations plus obsolete configuration, tests and documentation. Retain shared storage utilities still used elsewhere. Never run both refresh systems against the same credentials.

## 6. Deliver provider and picker parity

Expose Codex, Claude, Grok, Meta, Kimi, Kimi AI and Devin through verified CLIProxyAPI integrations, accurately indicating unavailable capabilities. Use one reactive catalog across chat, new agents and agent editing. Add subscription sections immediately below Recommended, with provider logos and bottom-right plug badges. Preserve favorites, search and quality ordering. Approve a standalone mockup before UI implementation.

## 7. Verify and roll out

Test scope enforcement, discovery changes, tool streaming, refresh races, restart recovery, reconnect, disconnect and removed models. Distinguish temporary failures, limits and invalid credentials with actionable messages. Never silently switch accounts or paid routes. Validate isolated previews with real accounts, roll providers out individually, and monitor failures. Rollback disables subscription availability without reactivating competing credential refreshers.
