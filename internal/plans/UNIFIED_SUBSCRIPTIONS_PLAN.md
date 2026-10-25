# Unified request-based subscription connections

Status: Phases 1, 2 and 4 are implemented in the request-based Codex path. Provider expansion,
live provider acceptance and preview verification remain deferred/unverified.

## Decision

Run subscription authorization, discovery, refresh and inference inside the existing
Next.js application. Convex holds durable coordination and connection metadata; the
existing credential vault holds secrets. No separate Docker host, CLIProxyAPI daemon,
local auth directory, broker service key or broker master key is required.
CLIProxyAPI is an adapter reference, not a runtime dependency.

Preserve the approved Settings/onboarding design and shared model dropdown. Connected
accounts contribute discovered, enabled models using
`byok/{connectionId}/{rawModelId}`. Preserve owner identity, provider grouping,
favorites, quality ordering and duplicate connection identity. Never silently switch
to another account, model or payer when the selected connection is unavailable.

Anthropic/Claude, Antigravity and generic Gemini subscriptions remain excluded
server-side. Existing API-key and native-only legacy agent accounts remain unchanged.
Do not transfer rotating tokens between old and new systems or expose them to runtimes.

## Request lifecycle and security

`Authenticated web request -> owner-bound connection service -> provider HTTP adapter`

- Start authorization in one bounded request. Persist secret device/PKCE material in
  the vault and its expiry, generation and next-poll time in durable coordination.
- Each browser poll/callback performs one exchange. No daemon waits for a human.
  Return only the public verification URL/code/status, never tokens or PKCE secrets.
- Write credentials as immutable vault versions. Atomically commit the new opaque
  reference using the matching Convex revision and lease token before using it.
- Serialize credential-changing operations with transactional, expiring, fenced
  leases. Process-local maps are not an authorization or concurrency boundary.
  Lease expiry during rotating-token exchange is an uncertain outcome: require
  reconnect rather than retrying a possibly consumed refresh token.
- Commit discovery and active metadata under the same generation fence. Repeated
  polls and refreshes preserve explicit disabled or empty model selections.
- Recheck owner, state, discovery and enabled-model membership at dispatch. Fetch
  only fixed provider endpoints, reject redirects, and do not forward client headers.
- Stream with cancellation/backpressure within hosting execution limits. Existing
  durable orchestration can resume between turns, not extend one function forever.
- Disconnect invalidates runtime access and the authorization generation first,
  then deletes vault secrets. Retain retryable cleanup metadata if deletion fails.
  Already-dispatched provider work may finish. Do not claim provider-side revocation
  without a supported upstream endpoint.
- Bound and sanitize failures. Never put raw auth/provider error bodies, credentials,
  or vault references in public JSON, model metadata, logs, prompts or client state.

## Phases

### 1. Durable request-based foundation

Implement a server-only subscription service and explicit provider adapter interface.
Add owner-checked durable state, generation/revision fences, transactional leases,
cleanup state and vault secret snapshots. Replace broker calls in authorization,
inference, model updates, disconnect and account deletion. Preserve public API shapes.

Acceptance: cross-user rejection, cold-instance continuity, concurrent polling,
stale completion rejection, refresh uncertainty, disconnect races and failed cleanup
tests. No runtime dependency on local files/processes or a remote broker URL.

### 2. Complete Codex path

Reuse the existing ChatGPT device-code and token-refresh helpers. Add authenticated
Codex account model discovery and a Responses HTTP adapter. Normalize required
request fields without injecting hosted tools or changing the requested model.
Support streaming and nonstream consumers, text and Overlay-executed function tools.
Never substitute a static registry for account discovery.

Acceptance: authorization/poll/expiry, refresh rotation, discovery, tool continuation,
streaming/nonstream output, cancellation, unsupported input rejection, and sanitized
401/429/5xx behavior without fallback. Verify real sign-in, model-dropdown appearance,
selection persistence, inference, refresh and disconnect on the exact PR preview
with an account owner when available. Fixture tests are not live acceptance.

### 3. Provider expansion, individually gated

Candidates remain visible but cannot be enabled by an env var unless an implemented
request-compatible adapter exists. Each needs auth, discovery, refresh, tool/stream,
and failure contract tests plus separate real-account rollout evidence.

| Candidate | Port work | Acceptance concern |
| --- | --- | --- |
| xAI / Grok Build | OIDC device flow, rotating tokens, Grok CLI HTTP endpoint | Fixed auth destinations and no paid API fallback |
| Kimi / Kimi AI | Separate device/token hosts and coding endpoints | Domain isolation, account discovery and supported protocol |
| Meta Muse | Device authorization and minted API-key lifecycle | Mint destination validation, expiry and available models |
| Devin | PKCE completion and Connect/protobuf inference | Full protocol translation and real account discovery, not a generic OpenAI wrapper |

Unsupported adapters stay disabled with accurate availability messaging. Report
implementation coverage and live-provider verification separately. Do not imply all
CLIProxyAPI providers port cleanly because Codex works.

### 4. Remove broker hosting requirements and validate consumers

Remove the superseded broker package/configuration from active runtime and docs.
Preserve attribution for translated upstream code. Update the living architecture
doc, API catalog and changelog. Keep fixed system-owned tab-label/media-intent models
on their current paths. Cover chat, native agents, automations and auxiliary calls
only where the owning user's identity is propagated.

Acceptance: focused tests, Convex tests, targeted ESLint, typecheck and unchanged
complexity/security gates. Current-head isolated preview QA for Settings, onboarding
and available provider flows. Never deploy shared dev or customer production.

### 5. Legacy migration and broader runtimes

After live acceptance, migrate legacy Codex bindings with explicit consent and one
refresh owner. Keep history and rollback safe. External runtimes need a separate
scoped transport, never raw refresh credentials. Embeddings, media, provider-hosted
tools and ZDR guarantees are outside the initial text-inference implementation.

## Rollout and evidence

Intersect the application allowlist with implemented adapters. Existing vault and
backend configuration replaces broker hosting configuration. A configured adapter
is not proof of live compatibility. Live authorization needs the account owner;
bounded live inference needs their approval. Never fabricate credentials or models.

Keep the PR draft until required checks and proportionate current-head preview QA
are complete. Do not merge without instruction. Record exact revision/backend,
automated checks, provider coverage and live gaps in the PR. UI-only checks are not
end-to-end subscription acceptance.

## Reference seams

- `src/server/agents/provider-accounts/codex-subscription.ts`: existing device flow.
- `src/server/ai/gateway/byok-credential-store.ts`: existing secret vault.
- `convex/providers/connections.ts`: connection metadata and ownership.
- `src/server/ai/model-runtime.ts`: selected model authorization and dispatch.
- `packages/overlay-chat-react/src/components/ModelSelector.tsx`: shared picker.
- [Codex account discovery](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/models.rs)
- [CLIProxyAPI reference revision](https://github.com/router-for-me/CLIProxyAPI/tree/bc0643405a1d0adf77dd0f109972ac3313d66397)
