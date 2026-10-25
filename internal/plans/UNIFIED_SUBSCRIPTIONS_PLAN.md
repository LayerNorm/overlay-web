# Unified subscription connections for Overlay

## Recommendation

### Approved scope, October 25, 2026

The unified architecture is approved for end-to-end implementation, followed by testing on the PR's isolated preview URL. This is not limited to a standalone Codex proof; the proof is the first implementation gate.

- Exclude Anthropic/Claude and Google Antigravity from the new subscription provider list, login endpoints, catalog discovery, and broker routing. Enforce the exclusion on the server, not only in the UI. Do not offer generic Gemini subscription login through an unverified alternative.
- Preserve existing Anthropic and Google API-key/gateway access. Existing native Claude Code bindings are legacy runtime-only access, not eligible for migration into general inference. Do not silently break existing agents or broaden those credentials' use.
- Eligible integration candidates are ChatGPT via Codex, Grok via xAI/Grok Build, Meta via Muse, Kimi, Kimi.ai, and Devin. Enable each adapter only after its actual login and inference path is verified. The UI must not imply unsupported adapters work.
- Once connected, a provider and its discovered, enabled models must appear in the shared model dropdown immediately, without a reload or an external-agent feature flag. Preserve provider grouping, favorites, quality ordering, and the existing provider rail. Distinguish subscription-backed choices from Overlay-billed and API-key choices when model names overlap.
- Use account-scoped discovery, not a static universal model list. Show only usable models for that connection. Keep subscription models selectable on free Overlay workspaces, subject to existing platform/tool entitlements. Do not mark them universally free or unlimited.
- Settings and onboarding share the connection flow. Include pending sign-in, cancellation, expiry, discovery failure, reconnect, model refresh, and disconnect states. Disconnect removes the connection's models from every picker and invalidates runtime access. Existing chats must show an actionable unavailable-model state rather than silently switch payer.
- Implement first-party chat, native agents, persisted background identity, compatible cloud runtime access, and migration in the phases below. Any unsupported provider/runtime combination must remain unavailable and be reported explicitly, not counted as complete.
- Use a draft PR targeting main and request the exact-head isolated preview with `needs-preview`. No shared-dev or production deployment. Preview QA must include real connection, model selection, and inference; fixtures are suitable for failure-path tests, not evidence of live provider compatibility.

The UI mockup is the next approval gate under the existing mockup-first preference. Architecture approval is recorded; UI implementation awaits that separate approval. Infrastructure provisioning and live-provider credentials must be verified before claiming end-to-end completion.

**Yes, the architecture is feasible. Replace agent-specific subscription configuration with first-class model connections, available from onboarding and usable by first-party Overlay inference and compatible external agents. Use CLIProxyAPI as a replaceable backend adapter, not as Overlay's identity, authorization, or billing system.**

Do not delete the current implementation first. Introduce the unified system, migrate connections and bindings, prove parity, and then remove the redundant account UI and credential-delivery code.

The promise should be **“Connect once, use across compatible Overlay features”**, not “every subscription supports every model, modality, and agent.” A subscription does not become an unrestricted API entitlement merely because a proxy exposes an API-shaped interface.

### Evidence and scope

Source review on October 25, 2026:

- Overlay current main: [139ea13a](https://github.com/LayerNorm/overlay-web/tree/139ea13a7bc6379508ab12c87c653a033886ea62).
- CLIProxyAPI current main: [bc064340](https://github.com/router-for-me/CLIProxyAPI/tree/bc0643405a1d0adf77dd0f109972ac3313d66397).
- This is an implementation plan, not a completed integration or live entitlement test. No account sign-ins, inference calls, deployments, or application code changes were performed for this review. Source defaults do not establish live deployment flag values.

## 1. What Overlay implements today

| Area | Current implementation |
| --- | --- |
| Agent subscriptions | Supported provider IDs are Claude Code and Codex. Historical IDs for other agents do not represent working support. |
| Claude Code | User runs `claude setup-token`, pastes the token, and Overlay stores it in the credential vault. The runner receives `CLAUDE_CODE_OAUTH_TOKEN`. |
| Codex | ChatGPT device-code sign-in. Overlay stores and refreshes the token set under a refresh lock. Each run receives a short-lived `auth.json`, without the refresh token. |
| Account records | `agentProviderAccounts` holds user-owned metadata and a vault reference. Agent bindings refer to an account and its owner. |
| Product placement | Agent-account setup is tied to external runtimes and the cloud-agent creation experience, not general inference. The underlying binding machinery belongs to the connected-agent control plane. |
| First-party inference | `getLanguageModel()` separately resolves Overlay-hosted gateway models or user-owned BYOK provider connections. It does not resolve agent subscription accounts. |
| Existing subscription-like exception | OpenCode Go already has a BYOK preset for its subscription endpoint, using a key and required session header. This is not consumer OAuth sign-in. |
| Release gates | Current source marks external runtimes, including account setup, disabled for launch. Native Overlay agents and model provider connections are independent. |

The useful foundation already exists: a model gateway, three protocol adapters, user-owned provider records, credential storage, model-picker integration, and BYOK-specific billing behavior. Generalize those instead of creating a third parallel connection system.

## 2. What CLIProxyAPI actually supports

Its current built-in v8 OAuth dispatcher contains the following routes. These are source-supported integrations, not verification of a particular user's paid plan or authorization to redistribute that access.

| Desired service | Integration found | Qualification |
| --- | --- | --- |
| ChatGPT | Codex OAuth and device login | Access is through Codex, not every ChatGPT feature or necessarily every plan. |
| Claude | Claude Code OAuth | Excluded from the new subscription system by the approved scope. Existing API-key access is unchanged. |
| Grok | xAI / Grok Build OAuth | Verify account eligibility and which allowance or billing balance is consumed. |
| Meta | Meta Muse device OAuth and minted API credential | This is Muse access, not proof that any Meta account has general inference entitlement. |
| Gemini | Antigravity OAuth route to supported models | Antigravity is excluded. No generic Gemini subscription connection is promised; API-key access is unchanged. |
| Additional built-ins | Kimi, Kimi.ai, Devin | Validate each separately before exposing it in Overlay. |
| Other integrations | Plugins and OpenAI-compatible/API-key providers | Not automatically subscription integrations. Inspect and pin each plugin before enabling it. |

Do not promise Qwen, iFlow, Copilot, or another provider based on old blog posts, a fork's README, or a reseller advertisement. Build the enabled list from the pinned version's actual integrations and acceptance results.

CLIProxyAPI exposes OpenAI Chat Completions, Responses, Anthropic Messages, and Gemini-compatible routes, with streaming/tool translation. Its MIT license permits software reuse with the required notices. That license does not grant rights to upstream provider services.

### Material restrictions, without making this a legal research project

[Anthropic's current guidance](https://code.claude.com/docs/en/legal-and-compliance) expressly disallows third-party applications routing through subscription credentials or collecting/intermediating Claude session tokens. It separately permits end users signing into hosted, unmodified Claude Code. Our existing setup-token custody is not evidence that the broader use is authorized.

[Google's Antigravity FAQ](https://antigravity.google/docs/faq/) explicitly restricts third-party access and warns about account suspension. It also excludes consumer-plan wrappers around headless `agy` and automated account rotation.

These are not merely undocumented interfaces. Keep technical experiments and production launch eligibility separate, with provider-specific disable switches and an API-key/native-runtime alternative. Do not make the architecture depend on evading provider controls. I have not audited the terms of every remaining provider.

## 3. Proposed architecture

```text
Onboarding / Settings / Model picker / Agent configuration
                         |
              Unified model connections
                         |
       Overlay authorization + inference-source resolver
                  /                      \
       Existing API/gateway adapters     Subscription broker
                                               |
                                  Isolated CLIProxyAPI workers
                                               |
                                  User's upstream connection

Consumers: first-party chat, native agents, background LLM jobs,
           automations, and explicitly compatible cloud runtimes.
```

### 3.1 One connection model

Extend the existing provider-connection domain with explicit authentication and transport types. Keep upstream provider identity separate from agent runtime identity: `openai` is a provider; `codex` is a harness.

Recommended fields include owner, provider, auth kind, transport, credential reference, status, permitted models, verified capabilities, default usage policy, and optional explicit sharing grants. Track `needs_reauth`, `rate_limited`, and `disabled` distinctly.

Keep existing `byok/{connectionId}/{modelId}` identifiers valid. A general connection identifier can be added without rewriting stored chats immediately. Resolve a structured inference source internally, rather than making billing and permissions depend on a string prefix.

**Personal connections are private by default.** A workspace agent cannot implicitly spend the creator's subscription for every coworker. Scheduled and delegated work must carry a valid persisted owner/grant; deleting a connection or removing access must revoke future use.

### 3.2 A private broker, not a public management console

Run CLIProxyAPI as a pinned container service outside request-scoped Next.js functions. Overlay handles account ownership, login-session binding, quotas, and usage records. CLIProxyAPI handles the verified provider login/refresh and protocol translation paths.

Start with an isolated worker/auth store per connection, scheduled on shared infrastructure. Optimize density only after isolation tests and measurements. Do not place all users' tokens into one global round-robin credential pool. Separate inbound API keys alone are not evidence of isolation between users.

Requirements:

- Only Overlay's backend can invoke the management API. No management keys, raw tokens, or unrestricted proxy endpoints reach clients or agent prompts.
- OAuth sessions are short-lived, single-use, bound to the initiating Overlay identity and connection, and protected with state/PKCE where supported. Hosted callback and device flows require provider-specific verification; a local CLI login is not automatically a web onboarding flow.
- Exactly one component owns token refresh after migration. Prevent the legacy broker and CLIProxyAPI from independently rotating the same refresh token.
- Encrypt durable auth storage, use narrowly scoped ephemeral materialization where required, and synchronize rotated credentials before a worker is discarded. Disconnect removes worker copies as well as the vault record.
- Disable unnecessary request/error payload logging, automatic control-panel downloads, and unreviewed plugins. Redact auth codes, credentials, and prompts from operational logs.
- Enforce per-connection concurrency, cancellation, bounded retries, stable session affinity, and explicit model/account selection. Never fail over to another user's account.
- Separate this trusted internal transport from custom BYOK URLs. Preserve existing SSRF protections; do not make private IPs generally acceptable in BYOK configuration.

### 3.3 Resolve the source everywhere, not just in chat

Extend `getLanguageModel()` and the gateway interface so authorized subscription connections produce the appropriate AI SDK model implementation. Prefer the provider's native compatible protocol where it preserves semantics; do not blindly translate everything through Chat Completions.

The audit must cover interactive turns, native agent delegation, scheduled work, personal chat workflows, compaction, titles, suggestions, notebook helpers, and extension planning. Current call sites include fixed hosted helper models and calls without a user ID. Adding one model-picker option will not redirect those calls.

For user-scoped auxiliary language tasks, use the selected/default connection when compatible, unless the user has explicitly chosen a separate source. Preserve ownership and grants in background jobs. System-wide jobs need their own service source, not an arbitrary user's subscription.

Treat embeddings, transcription, speech, images, video, provider-hosted search, and computer-use capabilities separately. Subscription-backed chat does not imply those APIs exist. Keep existing paths until a specific capability has passed verification. Never silently charge a paid fallback.

### 3.4 Billing and reliability

Record source, connection, model, actor, run, tokens, latency, and outcome even when Overlay does not charge for upstream model tokens. Generalize the existing BYOK exemption into a verified source policy, while retaining Overlay compute, storage, tools, and platform charges.

Do not label subscription inference universally free or unlimited. Show provider quota/reset information only when reliably available; otherwise show unavailable rather than invented percentages. Disable provider credit-spending fallbacks by default. Antigravity is excluded entirely, including its credit fallback configuration.

Default exhaustion behavior: stop or wait with a clear explanation. API-key/Overlay-wallet fallback is opt-in, identified in the UI, and subject to a spending limit. Revocation and provider outages must fail closed, not silently switch payer.

Preserve workspace ZDR requirements. Consumer subscription routes should not be marked ZDR without independently verified evidence.

### 3.5 External agents

Retain the agent control plane, machines, MCP tools, and run lifecycle. They are not subscription plumbing and should not be deleted.

Compatible runtimes receive a short-lived, run-scoped Overlay broker credential and endpoint, not the user's refresh token. Verify configuration, model mapping, streaming, tool calls, and resume separately for each harness. A proxy's protocol support does not guarantee that Claude Code can use every other provider correctly.

Where a runtime requires native sign-in, keep a distinct native-runtime connection capability. It must not masquerade as generic inference support. Future runtimes can consume the shared connection layer without reimplementing login.

## 4. Delivery sequence and acceptance gates

| Phase | Deliverable | Exit condition |
| --- | --- | --- |
| 1. Compatibility proof | Pin CLIProxyAPI; build the provider/capability matrix; exercise one initial provider through Overlay's existing custom-provider seam against a secured isolated proxy. Codex is the best initial candidate because we already implement its login lifecycle. | Real first-party streamed text and tool round-trip, refresh/reconnect, cancellation, and confirmed entitlement/billing behavior. A successful `/models` call is insufficient. |
| 2. Shared foundation | Generalize provider connections and inference-source policy; add the broker, private transport, isolated workers, revocation, and telemetry behind a new subscription flag independent of external-agent flags. | Cross-user isolation, revoked access, concurrent refresh, unauthorized model IDs, and explicit fallback tests pass. Existing API-key/gateway paths remain unchanged. |
| 3. First-party launch | Offer optional connection during onboarding, unified Settings, and source-aware model selection. Thread connection context through language helpers, native agents, and automations. Produce a minimal mockup for approval before implementing UI. | A new user connects without creating a cloud agent or enabling external runtimes. Native tools and scheduled work function; helper calls cannot silently spend Overlay credits. |
| 4. Provider expansion and runtimes | Add Grok/Muse/Kimi/Kimi.ai/Devin adapters individually after validation. Exclude Claude and Antigravity server-side. Wire compatible cloud runtimes to scoped broker credentials. | Each provider/runtime passes its own acceptance matrix. One provider can be disabled without breaking others or deleting history. |
| 5. Migration and removal | Map legacy account IDs to unified connections, migrate agent bindings and UI, then retire duplicated subscription services. | Existing agents keep working, rollback is tested, and no live caller depends on removed fields/routes. |

Migration is expand, migrate, contract. Preserve API-key agent accounts as well as subscription accounts. Existing Codex refresh tokens must not be assumed interchangeable with CLIProxyAPI auth records: validate compatibility, transfer refresh ownership atomically when possible, otherwise request reconnect. Do not import Claude setup-tokens into the unified broker; preserve legacy native-runtime bindings separately. Never silently broaden a user's connection scope during migration.

Keep the old read path and explicit mapping until clients and workers have upgraded. Do not roll back by resurrecting stale rotating tokens. Preserve disconnected-account cleanup and historical runs even when a provider is disabled.

### Minimum acceptance suite

1. Connect from onboarding; stream a first-party response; complete a tool call and continue the turn; reload the conversation.
2. Use the connection in a native agent and a scheduled job with correct owner/grant context. Exercise an auxiliary language task as well.
3. Verify refresh across concurrent requests and worker restart; disconnect and confirm new/in-flight use is terminated according to policy.
4. Attempt cross-user connection/model/session access and workspace use without a grant. All must fail closed.
5. Exhaust quota or return 401/429/5xx. Verify no cross-account, cross-model, or paid fallback without authorization, including retries after partial streaming.
6. Validate native-agent tools, structured output, images-in-input, and runtime resume only where advertised. Unsupported modalities and ZDR-only requests must be rejected clearly.
7. Migrate a legacy binding and test rollback without duplicated refresh ownership or missing history.
8. On the exact-head PR preview, connect an allowed provider and verify its models appear immediately in the shared dropdown. Select one, send a real prompt, reload, and confirm the selected connection persists. Verify settings, chat, and native-agent selectors agree; duplicate model names retain distinct connection identities.
9. Disconnect and reconnect on the preview. Models disappear and return appropriately; stale conversation selections fail clearly without paid fallback. Verify discovery errors, expired sign-in, and quota errors remain actionable.
10. Reject Anthropic and Antigravity subscription requests at the server and worker boundaries, including direct API calls and models exposed through another provider's catalog when they would route via an excluded subscription credential. Existing API-key connections still function. Model authorship alone is not credential provenance: a model served legitimately through an allowed provider is governed by that provider's verified capability policy.

## 5. Concrete implementation locations

Existing files to evolve, not a prescription to replace them wholesale:

- `src/server/ai/provider-connections/` and `convex/schema.ts`: connection metadata, ownership, migration mapping.
- `src/server/ai/model-runtime.ts`: authorized source resolution and broker transport.
- `packages/overlay-llm-gateway/src/contracts.ts` and `src/adapters/byok-gateway.ts`: source/protocol capabilities and model construction.
- `src/shared/ai/gateway/byok-model-conversion.ts`: model identity compatibility and catalog conversion.
- `src/server/conversations/ActEntitlementService.ts`, `ActUsageBudgetService.ts`, and act orchestration: source-aware eligibility, accounting, and fallback.
- `src/server/agents/provider-accounts/`, `ConnectedAgentControlPlaneService.ts`, cloud-agent services: migration and runtime credential delivery.
- Background callers in `src/server/automations/`, `workflows/`, `chat/`, and helper API routes: persisted execution identity and source propagation.
- Shared app/API contracts and the model picker: ensure web, desktop, and mobile agree on connection status and model identity.
- `FEATURES.md`: keep subscription availability independent of external runtime launches.

## 6. Source references

- [Overlay provider definitions](https://github.com/LayerNorm/overlay-web/blob/139ea13a7bc6379508ab12c87c653a033886ea62/src/shared/agents/provider-accounts.ts)
- [Overlay credential service](https://github.com/LayerNorm/overlay-web/blob/139ea13a7bc6379508ab12c87c653a033886ea62/src/server/agents/provider-accounts/AgentProviderAccountService.ts)
- [Overlay model runtime](https://github.com/LayerNorm/overlay-web/blob/139ea13a7bc6379508ab12c87c653a033886ea62/src/server/ai/model-runtime.ts)
- [Overlay BYOK adapters](https://github.com/LayerNorm/overlay-web/tree/139ea13a7bc6379508ab12c87c653a033886ea62/packages/overlay-llm-gateway/src/adapters)
- [Overlay feature inventory](https://github.com/LayerNorm/overlay-web/blob/139ea13a7bc6379508ab12c87c653a033886ea62/FEATURES.md)
- [CLIProxyAPI built-in OAuth providers](https://github.com/router-for-me/CLIProxyAPI/blob/bc0643405a1d0adf77dd0f109972ac3313d66397/internal/api/handlers/management/auth_files_v8.go)
- [CLIProxyAPI inference routes](https://github.com/router-for-me/CLIProxyAPI/blob/bc0643405a1d0adf77dd0f109972ac3313d66397/internal/api/server_routes.go)
- [CLIProxyAPI configuration](https://github.com/router-for-me/CLIProxyAPI/blob/bc0643405a1d0adf77dd0f109972ac3313d66397/config.example.yaml)
- [Meta Muse implementation](https://github.com/router-for-me/CLIProxyAPI/blob/bc0643405a1d0adf77dd0f109972ac3313d66397/internal/auth/meta/meta.go)

## Implementation status

The approved subscription-connection implementation is present on the feature branch, with Anthropic/Claude, Antigravity, and Gemini subscriptions excluded. App and broker provider allowlists are independent and default empty. No live provider account, authorization, inference, hosted-broker deployment, or preview has been verified; allowlist configuration is eligibility, not compatibility evidence.

Current gaps remain explicit: external cloud and native-only legacy runtimes do not receive subscription credentials, and the fixed system-owned `TAB_GROUP_MODEL` and `MEDIA_INTENT_MODEL` background tasks do not route through the selected subscription connection. Preserve these system paths rather than implying general subscription coverage. Completion still requires provider-specific real acceptance evidence and reporting actual runtime coverage.
