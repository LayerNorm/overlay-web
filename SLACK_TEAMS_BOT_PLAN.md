# Slack + Teams bot — phased implementation plan

Status: **B0–B2 implemented** on `staging` (direct push per standing owner
auth). B3–B6 remain planned. Corrections from implementation are recorded
inline below (marked IMPLEMENTATION NOTE). Adapter recon done (Chat SDK
`chat` + `@chat-adapter/slack` + `@chat-adapter/teams` all at **4.39.0**,
verified on npm). Phases 1–4 of `AGENT_VISIBILITY_AND_EDITOR_PLAN.md` are on
`main` and are the foundation this plan builds on.

## 0. Goal and non-goals

**Goal:** Overlay agents answerable inside customer Slack workspaces (first)
and MS Teams (second), managed in Overlay. The bot is the GTM wedge: teams
trial agents where they already live, usage meters through the same SaaS
entitlement path as first-party clients, and standout accounts convert to
Overlay-native or on-prem.

**Non-goals:**
- Per-user / per-team agent grant scopes (still future; the Only-me/Everyone
  model transfers as-is).
- Auto-provisioning Overlay accounts from platform users.
- AppSource / Slack Marketplace listing (pilot distribution only; listing is a
  separate decision).
- Changing the mention-first invocation policy, tool-approval model, or agent
  runtime.

## 1. Locked decisions

1. **Slack first, Teams second, one shared core.** Both transports program
   against the same seam; no per-platform agent logic.
2. **Enforcement lives in Overlay, never in the bot process.** The bot resolves
   a platform user to a principal and calls the same services first-party
   clients use. Creator-only agents are automatically creator-only in Slack.
3. **User-mapped identity.** Service-account invocation is out: every bot call
   carries the linked principal, so visibility, audit, and metering are
   correct. Unmapped users get nothing (silent no-op, never an existence
   leak).
4. **Webhook mode on Vercel.** Slack socket mode needs a persistent WebSocket
   and does not fit serverless; the adapter's cron-forwarding recipe is a
   fallback, not the design.
5. **Tokens live in our storage.** Chat SDK's `installationProvider` hook (Slack)
   and app-level auth (Teams) mean we never hand token custody to the SDK's
   state layer. Install rows live beside the identity mappings both backends
   already serve.

## 2. Foundation inventory (already on `main`)

- `src/server/agents/PlatformAgentAccess.ts` — the bot seam: `listAgents` and
  `openAgentDirectMessage` resolve the platform actor, then call the same
  `WorkspaceAgentService` / `createDirectMessage` paths. Room-message
  invocation needs no adapter code: call `resolveWorkspaceAgentInvocations`
  with the mapped actor (`src/server/agents/workspace-agent-invocation.ts`).
- `WorkspaceGovernanceService.resolvePlatformActor` — maps
  `(workspaceId, directory, externalId)` to the linked human principal's
  `userId`; unknown/deprovisioned/archived/non-human all report uniform
  `not_found`. Linking stays manager-gated and audited via
  `linkDirectoryIdentity`.
- Identity storage on both backends: Convex `workspaceIdentityMappings`
  (`convex/schema.ts:1919`, `by_workspaceId_external` index,
  `*IdentityMappingByServer` handlers in `convex/collaboration/workspaces.ts`);
  Postgres `workspace_identity_mappings`
  (`migrations/app-data/0038_workspace_governance_policy.sql`, mirrored in
  `PostgresWorkspaceRepository`).
- Durable agent turns (`resolveWorkspaceAgentInvocations` → workflow-backed
  runs) — the answer to Slack's 3s ack window: acknowledge fast, post the
  result when the run completes.
- Webhook route convention: thin `src/app/api/.../route.ts` → `handleBffRoute`
  → `src/server/app-api/...` (see `src/app/api/v1/webhooks/route.ts` and the
  Stripe precedent at `src/app/api/webhooks/stripe/route.ts`).
- `redis@^5` is a dependency and `OVERLAY_REDIS_URL` is configured — the Chat
  SDK Redis state adapter has somewhere to live.
- Agent search, DM guard, mention filter, and channel auto-join skip all read
  live visibility — flips apply to bot invocations with no extra code.

## 3. Adapter maturity verdict (from `chat-sdk.dev` recon)

**Slack (`@chat-adapter/slack`) — pilot-ready.** Mentions, DMs, threads,
files, slash commands, modals, reactions; multi-workspace OAuth with per-team
install storage, AES-256 token encryption, Enterprise Grid support, token
rotation; `installationProvider` for external (our) token storage; native
streaming with post-and-edit fallback; agent-native surface (`agent_view`,
Agent Sessions API with working indicator + stop-button abort, suggested
prompts, feedback buttons); `toAiMessages` AI-SDK interop; `@chat-adapter/tests`
harness.

**Teams (`@chat-adapter/teams`) — real, slightly less polished.** Adaptive
Cards, Task Module modals, mentions, threading, ephemeral messages, Graph user
lookup (email — useful for identity linking). App-level auth
(MultiTenant/SingleTenant) makes SaaS installs simpler than Slack's per-team
tokens; webhooks are plain HTTPS POSTs with a custom token factory for
serverless. Gaps: no agent-sessions/streaming story (expect post-and-edit),
DM history needs admin-consented `Chat.Read.All`. The binding distribution
constraint is product, not adapter: sideload per-team for pilots, AppSource
validation for org-wide.

## 4. Phase B0 — Slack spike (days, staging-only)

Single workspace, single hardcoded agent, one webhook route. Proves the loop:
Slack @-mention → Overlay agent → threaded reply.

- Install `chat` + `@chat-adapter/slack`; single-workspace mode
  (`SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` from env, staging values only).
- `POST /api/webhooks/slack` (thin route → BFF service): verify signature,
  ack 200 immediately, resolve the hardcoded agent through
  `PlatformAgentAccess`, run the turn, post back to the thread.
- Slash command and OAuth explicitly out; one test workspace installed
  manually from `api.slack.com/apps`.
  - IMPLEMENTATION NOTE: B0 and B1 shipped together. Transport uses the
    low-level `@chat-adapter/slack/webhook` + `/api` subpaths (verify/parse +
    post), not the `Chat` class — full ack control on serverless, no session
    state to manage. The `Chat` class (sessions, streaming) arrives in B3.
    Retry safety comes from deterministic `clientNonce`
    (`slack:<team>:<channel>:<ts>`, and `addMessage` dedupes on it) plus the
    existing prior-reply invocation-nonce guard; concurrent-retry double-post
    remains a B4 hardening item.
- **Acceptance:** @-mention in the test workspace yields the agent's reply in
  thread; restart-safe (no in-memory install state beyond the single env
  token); `tsc` + ESLint + a handler smoke test green.
  - IMPLEMENTATION NOTE: the live @-mention loop additionally needs a Slack
    app + staging env secrets (`SLACK_SIGNING_SECRET`, spike
    `SLACK_BOT_TOKEN`/`SLACK_SPIKE_WORKSPACE_ID`/`SLACK_SPIKE_AGENT_ID`) and
    one manually linked identity mapping — none committable, all owner-side.
    Staging QA without them covers: 503 unconfigured, 401 bad signature,
    challenge handshake, silent-200 for unknown teams/users, OAuth 400s.

## 5. Phase B1 — Multi-workspace installs

- OAuth callback route (`handleOAuthCallback`) with a `state` param carrying
  the target Overlay workspace id; install is manager-gated (only a workspace
  manager can complete linking a Slack team to a workspace).
- New migration (both backends): `workspace_platform_installations`
  (`workspace_id`, `directory`, `external_team_id`, encrypted token blob,
  `installed_by_principal_id`, timestamps) behind a small repository
  interface — implement once against the interface so Convex and Postgres
  stay in parity, mirroring the agents-repository pairing.
- Wire Chat SDK's `installationProvider` to that repository; `encryptionKey`
  from `SLACK_ENCRYPTION_KEY` (AES-256-GCM, per deployment, never committed).
  - IMPLEMENTATION NOTE: custom OAuth exchange via `callSlackApi`
    (`oauth.v2.access`) instead of the adapter's `handleOAuthCallback`, which
    writes to the SDK's internal state adapter (read-only
    `installationProvider` can't intercept the write). Tokens are encrypted
    server-side (`src/server/slack/slack-token-crypto.ts`) before storage, so
    Convex/Postgres rows only ever hold ciphertext. `installationProvider()`
    in `SlackInstallService.ts` is wired and tested for the B3 `Chat` class.
    Second finding: `@chat-adapter/slack` subpaths export `types` + `import`
    conditions only (no `require`), so static imports break under the repo's
    tsx-compiled unit tests — all runtime uses go through the dynamic loaders
    in `src/server/slack/slack-adapter-modules.ts` (works in Next.js ESM and
    tsx alike). `after()` is injectable (`scheduleWork`) for the same reason.
- Enterprise Grid: key installs by enterprise id for org-wide installs, per
  the adapter's contract.
- **Acceptance:** two Slack workspaces mapped to two Overlay workspaces with
  isolated tokens; uninstall cleans up; rotation-safe resolver.

## 6. Phase B2 — Identity linking UX

- Start manual/admin-gated: a workspace settings surface listing linked
  identities with link/unlink, built on the existing `linkDirectoryIdentity`
  (audited) — no new tables.
- Show Slack display name + id; unlink keeps history, retires future
  invocation (same semantics as SCIM deprovisioning).
- Email matching and auto-provisioning are explicitly out for the pilot;
  unmapped Slack users get a silent no-op or an ephemeral "not linked"
  message (decide in implementation; default silent to avoid user
  enumeration).
- **Acceptance:** mapped user invokes; unmapped user cannot (and learns
  nothing about agent existence); unlink takes effect immediately.
  - IMPLEMENTATION NOTE: unlink is retire-only — it reuses the repo-level
    deprovision call but skips the membership suspension that SCIM
    deprovisioning performs, since unlinking chat access is not offboarding.
    History and audit preserved either way. Unmapped-user behavior stays
    silent (no ephemeral message). UI is a `connected-chat` settings section
    (app-core entry, no capability gates; server enforces managers) rather
    than a workspace-settings tab, avoiding backend changes to the
    `WorkspaceManagementView` contract; member picker reuses the existing
    management `people` view.

## 7. Phase B3 — Invocation wiring (the real bot)

All through `PlatformAgentAccess` / `resolveWorkspaceAgentInvocations` with
the mapped actor — no new authorization code:

- Channel @-mentions → candidate resolution → threaded reply; invisible
  agents behave as non-agents (no run, no room-visible error).
- Slack DMs → `openAgentDirectMessage` → Overlay DM → run → post back.
- `onAgentSessionStopped` (stop button) cancels the run's client signal.
- A `/overlay` slash command for agent directory + per-agent "Manage in
  Overlay" deep links (`/app/w/:workspaceId/agents/:agentId`); every bot
  reply carries the manage link (Block Kit button). **Log manage-link clicks:
  this is the GTM conversion metric** (Slack user → Overlay signup/usage).
- **Acceptance:** creator-only agent answers its creator in Slack and is
  silent for everyone else; flip semantics hold end-to-end; conversion events
  recorded.

## 8. Phase B4 — Pilot hardening

- Streaming on (native, post-and-edit fallback verified); `thread.signal`
  wired to model APIs; mass-mention cost cap inherited
  (`MAX_AGENTS_PER_MESSAGE`).
- Retry dedupe by Slack `event_id`; rate-limit posture reviewed against the
  existing `RateLimiter`.
- **Metering assertion tests:** bot-path invocations bill identically to
  first-party invocations through the same entitlement gates (usage revenue
  is the point — prove it, don't assume it).
- Webhook security review: signing-secret verification on every request,
  no tokens in logs, secret rotation documented.
- Docs in the same PRs: `api-route-catalog.mdx` + compact catalog for the
  webhook/OAuth routes, new living doc `docs/develop/chat-platform-bots.mdx`
  (register it in the AGENTS.md table), CHANGELOG entries.

## 9. Phase B5 — Pilot and measure

- One friendly team, per-team install, admin-linked identities.
- Measure: weekly active bot users, invocations per user, manage-link
  click-through → Overlay activation, and qualitative pull ("we want this
  everywhere" / on-prem inquiries).
- Kill criteria written before the pilot starts: if the manage-link loop
  doesn't convert, the learning is the deliverable — do not scale
  distribution to compensate.

## 10. Phase B6 — Teams

- Same core + `@chat-adapter/teams`: MultiTenant app via the Teams CLI,
  tenant→workspace mapping stored alongside installs, RSC permissions for
  channel/group-chat history, sideloaded pilot distribution.
- Teams-specific gaps to design around: post-and-edit replies (no streaming
  story), DM history limits, Adaptive Card rendering of the manage link.
- AppSource validation only when pilot pull justifies it.

## 11. Sequencing and conventions

- One feature worktree per phase (`codex/<slug>`), one focused PR per phase
  against `staging` (standing owner auth: staging-bound work pushes direct
  to `staging`; PRs for `main` promotions where branch rules require them).
- Staging QA per `docs/develop/worktree-staging-qa.mdx`: Convex dev push
  from the staging worktree when `convex/` changes, Vercel staging READY,
  headed-Chrome Playwright QA against `staging.getoverlay.io`.
- Backend work behind repository interfaces (both providers), contract tests
  on both, migration + journal + `APP_DATA_SCHEMA_VERSION` bump for every
  Postgres schema change.

## 12. Open questions for the owner

1. Slack-first confirmed; Teams in the same quarter or on pilot-pull?
2. Install gating: workspace managers only (recommended), or any member?
3. Unmapped-user behavior: silent no-op (recommended) or ephemeral "ask an
   admin to link you"?
4. Vercel Connect vs owning Slack OAuth ourselves (default: own it; evaluate
   in B1)?
5. Novu (managed credentials across platforms) vs owning adapters (default:
   own them; evaluate before B6)?
6. Which team pilots, and what conversion number makes it a success?

## 13. Risks

- **Long runs vs 3s ack:** durable turns solve this, but the completion→Slack
  post-back path is new code and must be idempotent (Slack retries).
- **Threading model mismatch:** under `agent_view`, DM replies thread per
  user message — build AI history from user history, not channel history,
  or the model loses its own replies (per adapter docs).
- **Token custody:** install tokens are the crown jewels — encryption,
  rotation, and minimal logging from day one.
- **Distribution ≠ adapter:** Teams AppSource and Slack org-wide installs are
  review processes; pilots sideload and prove value first.
- **Scope creep into a second agent runtime:** the bot is a transport. Any
  logic that only works in Slack is a bug — it must go through the shared
  services.
