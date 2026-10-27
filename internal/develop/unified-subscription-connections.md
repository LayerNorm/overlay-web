# Unified subscription connections

Subscription connections add account-owned model providers alongside API-key
connections. They keep the `byok/{connectionId}/{modelId}` model namespace and
are checked against the authenticated owner, active connection status, account
discovery and the enabled-model list before inference. The empty endpoint on a
subscription record is a sentinel only; subscription inference never uses it
as a destination and never falls back to paid Overlay routing.

## Request-based architecture

The web application handles authorization, polling, token refresh, discovery
and inference. Convex stores owner-bound state, generations, leases, polling
times, connection metadata and opaque vault references. The existing
`ByokCredentialStore` holds immutable snapshots of Codex device and token JSON.
There is no subscription broker process, Docker service, broker key, master
key, or local auth directory.

`OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS` remains empty by default. Runtime
eligibility is the intersection of that deployment allowlist and implemented
request adapters; currently only `codex` is implemented. Other listed
providers remain visible but unavailable until their request adapters and
configuration are implemented. An environment setting cannot enable an
unimplemented adapter. Anthropic/Claude, Antigravity and Gemini subscriptions
remain excluded.

Codex authorization uses the existing device-code helper. Durable Convex
leases fence authorization, polling, refresh and discovery across instances;
the rotating refresh token is reread after acquiring its lease and a refreshed
immutable vault snapshot is committed before release. Ambiguous expired refresh
leases require reconnect rather than reusing a potentially consumed token.
Disconnect revokes the generation and public connection access before cleanup.
Failed vault deletion leaves retryable cleanup references in Convex.
Disconnect retains the prior operation deadline as a cleanup barrier before a
connection or account can be removed. A retry can finish deletion after that
deadline. Before writing a Vault object, the service registers its generated
name and timestamp in Convex. Saving the resulting reference or retaining it for
cleanup clears that pending name in the same mutation. Writes older than five
minutes are deleted by name during reconciliation, which exceeds the 60 second
Convex lease and avoids touching an in-flight write. Disconnect and account
revocation reconcile all pending writes after invalidation and block state
removal until cleanup succeeds. This closes the process-crash orphan window
without claiming cross-service atomicity.

Vault failures log only a structured failure code and, for upstream rejections,
the HTTP status. `missing_configuration` means the runtime has no
`WORKOS_API_KEY`; `http_failure` requires checking that environment's WorkOS
Vault access; `transport_failure` covers request/response transport failures;
`invalid_response` means a create response omitted its object ID. Credentials,
upstream response bodies and messages are never logged. Preview diagnosis must
use Preview credentials, never a Production key. HTTP failures may also log
WorkOS's machine-readable `upstreamCode` and offending `upstreamFields` names
when they match a strict identifier pattern; messages and values are never
logged.
Vault context values are limited to letters, numbers, `/`, `_`, and `-`, and
the writer validates each value and the ten-entry limit before making a request.

Codex model discovery uses the signed-in account's
`https://chatgpt.com/backend-api/codex/models?client_version=0.154.0` catalog.
No static model list is used. Empty or unavailable discovery preserves
recoverable credentials for a later retry. Generic connection edits may change
display name or enabled selections but cannot forge discovery, provider, or
subscription status metadata.

Inference uses the installed OpenAI Responses SDK adapter with a placeholder
SDK key. Each dispatch revalidates owner, provider, active status, discovered
and enabled model membership before reading the vault. Only the fixed Codex
Responses endpoint receives the account bearer token. Requests support text
and function/custom-text tools; images, files, audio, video, hosted tools and
zero-data-retention guarantees are unsupported. Unsupported semantic options
are rejected rather than silently dropped. The adapter removes the unsupported
`max_output_tokens`, `max_completion_tokens`, `temperature`, and `top_p` controls
before validation. Provider failures never trigger additional inference or paid
fallback.

The request-based connection flow does not provide subscription credentials to
external cloud agents or native-only legacy paths. First-party owner-aware
background consumers such as context compaction and automation turns resolve
the same owner's active connection through the server service and use the same
ownership, enabled-model and lease checks as interactive requests. Fixed
system-owned `TAB_GROUP_MODEL` and `MEDIA_INTENT_MODEL` tasks remain on their
configured system model path.
