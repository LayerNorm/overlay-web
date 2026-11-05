# Plan: Replace subscription plumbing with CLIProxyAPI

Status: The Codex implementation is merged in #386. The seven-provider implementation and workspace control plane have hosted Claude text/tool and sandbox isolation acceptance. The owner authorized Production/shared Preview activation of all six selectable providers after real authorization-start and adapter checks. Kimi uses kimi.com for new connections; kimi-ai remains reconnect-only. Live shared inference, rotating refresh and remaining provider-account acceptance are still unverified.

> Progress note: the original Codex slice uses a same-project private bridge.
> This branch extends its backend and control plane to Claude, xAI, Meta, Kimi,
> Kimi AI, and Devin, and adds immutable personal/workspace subscription scope,
> active-member authorization, workspace-aware dispatch, and picker/cache
> isolation. The approved scope selector defaults to Personal and offers explicit
> Workspace sharing, with scope-specific privacy copy and immutable reconnects.
> Hosted personal Claude inference and sandbox scope/isolation checks pass.
> Live shared inference, rotating refresh and other-provider account acceptance
> remain separate rollout gates.
> Local build and injected-HTTP fixtures establish implementation behavior only;
> they do not establish hosted deployment or live provider-account acceptance.
> The plan catalog is not account-entitlement proof. The superseded in-process
> adapter plan has been removed; git history preserves its original decisions.

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

Expose Codex, Claude, xAI (Grok), Meta, Kimi and Devin for new connections; retain
Kimi AI only for existing kimi.ai credentials and reconnects through the pinned
CLIProxyAPI integration. Codex, xAI, Meta and Kimi use
device authorization; Claude and Devin use generated PKCE plus locally
validated callback completion. Persist credentials and pending state only in
Overlay Vault, keep provider/domain identity exact, and use provider catalogs
without treating them as account-entitlement proof. Preserve the private,
stateless bridge and fenced Overlay refresh/discovery/inference lifecycle.
Provide the same shared subscription picker across supported entry points,
including Settings, new chats, existing chats and native agents. Keep provider
logos and model capability metadata consistent, preserve favorites and
recommendations, and expose only models discovered for the exact connection.
Workspace-scoped subscription sharing is implemented for explicitly scoped
rows. Legacy rows remain personal, scope is immutable, and only active members
of the matching active workspace may list or use a shared connection. The
acting user and billing workspace remain authoritative; the credential owner
is resolved internally for Vault reads and refresh leases. Picker caching and
nonowner management safeguards are workspace-aware. The approved scope selector
and privacy copy are implemented. Full shared-picker QA, hosted acceptance, and real-account validation
remain pending and are not implied by synthetic tests.

Dispatch rollout is additive: `getForDispatchByServer` retains its legacy
owner-only `userId` contract, while the current web uses
`getForDispatchForActorByServer` for actor/workspace authorization. Deploy the
web first through native Git from clean canonical `main`; after the matching
production web is live, synchronize the additive Convex backend from clean
current canonical `main`, never from a feature worktree. Until that sync, the
new actor-aware query is unavailable and subscription dispatch fails closed.
Treat this as an availability gap, not a zero-downtime rollout. Keep the
legacy endpoint for rollback and older web versions; it supports personal-only
dispatch and is never a workspace fallback.

## 7. Verify and roll out

Test scope enforcement, discovery changes, tool streaming, refresh races,
restart recovery, reconnect, disconnect and removed models. Distinguish
temporary failures, limits and invalid credentials with actionable messages.
Never silently switch accounts or paid routes. Personal Claude text/tool streaming
and credential durability across deployment have hosted acceptance. All six real
authorization-start requests and pinned executor contracts pass. The owner approved
activation of all six after these checks; remaining real-account completion,
shared inference and rotating-refresh cases stay explicit. Rollback disables
subscription availability without reactivating competing credential refreshers.

## Accepted integration checks

A previously connected personal Claude subscription survives a new private-service
deployment and completes text and function-tool streaming; saved replies and full
traces survive reload. Hosted owner/member/outsider fixtures verify scoped listing,
management denial, immutable scope and invalid-callback recovery. Local bridge
executor fixtures cover all implemented provider transports. All six real authorization-start requests pass and the owner authorized enabling
the six selectable providers in Production and shared Preview. Do not treat this acceptance as live shared-account
inference, rotating refresh, or live inference proof for every provider.
