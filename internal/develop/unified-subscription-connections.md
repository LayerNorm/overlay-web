# Unified subscription connections

## Current scope

Production and shared Preview enable ChatGPT/Codex, Claude, Grok Build, Meta Muse,
Kimi and Devin by explicit owner authorization. New connections offer one Kimi
choice bound to `kimi.com`. The unused `kimi-ai` adapter is removed from the
bridge, API contracts and Convex validators. Production inventory contained no
connections or pending authorization states for it before removal.

The provider implementation supports the exact IDs `codex`, `claude`, `xai`,
`meta`, `kimi`, and `devin`. Subscription inference and provider-side
authorization use the pinned CLIProxyAPI source in a private, stateless service
bound to the web service inside the same Vercel project. The service has no
public rewrite, shared account pool, auth files, background refresh, or
provider/domain fallback.

Subscription connections support explicit, immutable `personal` or `workspace`
scope. Missing scope on legacy rows is personal; creation defaults to personal,
and workspace identity comes from the authenticated active-workspace context.
Only active members of that exact active workspace may list or use a shared
subscription. API-key connections remain unchanged and are never workspace-
shared. Lifecycle management and Vault references remain owner-only; nonowner
shared rows reach the picker with `canManage: false`, are excluded from Settings
management, and expose no reconnect URL. The scope selector defaults to Personal,
offers Workspace only with an active workspace, and locks scope once authorization
starts. Reconnects preserve the stored scope. Requests pin the active workspace
through the workspace header, not a client-controlled body field.
Model visibility does not grant execution access:
existing paid-access requirements still apply to all models, including BYOK.

### Dispatch endpoint rollout compatibility

The owner-only `getForDispatchByServer` endpoint retains its `userId` argument
and provider, credential-reference, and generation response. It never
authorizes another user through a workspace row. The
`getForDispatchForActorByServer` endpoint accepts the authenticated actor and
workspace context and is the only endpoint that can authorize workspace use;
it returns owner identity and revision for server-side Vault and fencing
operations. The current web service calls this new endpoint and does not fall
back to the owner-only endpoint for workspace access.

Production sequencing is web first, then the matching Convex synchronization:
ship the web through the native Git deployment from clean canonical `main`,
wait for the matching production web to be live, then sync the additive Convex
backend from clean current canonical `main`. Never deploy the customer backend
from a feature worktree. Until that synchronization, the new actor-aware query
is unavailable and subscription dispatch requests fail closed; this interval
is an availability gap, not a zero-downtime rollout.

Keep the legacy query for rollback and older web versions. Those callers remain
compatible with its owner-only contract and can dispatch personal connections
only; workspace use requires the actor-aware endpoint, with no legacy fallback.

The plan-based Codex catalog is sourced from CLIProxyAPI's plan registry. The
`prolite` and `promax` variants additionally intersect that pinned registry with
its Codex client catalog's explicit per-model plan membership; they do not
inherit unverified Pro-only models. It is
catalog provenance, not proof that a particular account is entitled to every
listed model. Unknown plans fail closed at catalog discovery and inference. A successful
authorization still saves the valid credential before discovery, so a missing
catalog cannot discard a newly exchanged rotating token.

Reasoning controls use optional levels from the pinned registry's explicit
`Thinking.Levels` metadata. Unsupported and unknown values are omitted; provider
default remains the universal choice. Chat overrides are stored per exact model
ID and conversation scope, and are not migrated from the legacy global effort.
Native agents persist one optional model reasoning choice and pass it through
their workflow settings. Missing values on legacy agents remain provider-managed.
Neither capability metadata nor a saved effort changes paid-access enforcement.

## Responsibilities

Overlay owns the authenticated connection, its immutable scope, generation and
revision fences, model selections, and durable secret lifecycle. Provider credentials and
authorization state live in Overlay Vault; Convex keeps opaque references,
pending-write names, selected model IDs, and lease state. The bridge accepts a
credential envelope and explicit connection/model identity for each request. It
constructs one upstream auth record and executes only that credential—there is
no manager, pool, or account/model/paid-route fallback.

Runtime dispatch preserves the acting user and billing workspace as execution
identity. Convex resolves the credential owner internally for Vault reads and
refresh leases; after refresh, actor/workspace authorization and provider,
credential-reference, generation, and revision stability are checked again.
The bridge returns bounded, typed control responses for authorization, polling,
callback completion, refresh, model listing, and inference. Authorization state is persisted by
Overlay so polling survives container restarts. Bridge calls require the
private service bearer secret. A missing URL or secret disables the adapter;
it never activates the old native subscription backend.

The old native Codex token format is not imported. Existing subscription
credentials in that format require one explicit reconnect. Claude and Devin
use generated PKCE authorization and callback URLs validated locally against
their pending flow; the bridge never fetches a supplied URL or opens a
localhost listener. xAI, Kimi/Kimi AI, and Meta device flows advance one
bounded poll per browser request. Kimi's domain and device identity remain
connection-bound. Devin session tokens and minted Meta API keys may use
nullable expiry only for upstream-confirmed non-expiring credentials. The shared
`codex-subscription.ts` helper remains behind provider-account compatibility
services; retired hosted third-party runtimes still receive no credentials. It
is not an inference or refresh fallback for unified subscription connections.

## Credential lifecycle and dispatch

Authorization, polling, discovery, and refresh are fenced by Convex generation,
revision, and lease state. Vault writes are registered before they start and
committed by opaque reference before success is reported. Disconnect revokes
dispatch access immediately; failed cleanup remains retryable.

Near-expiry credentials are refreshed by Overlay before inference while holding
the existing refresh lease. The service rereads the credential under the lease,
skips rotation if a concurrent request already refreshed it, writes and commits
the new immutable credential before dispatch, then rechecks the model,
generation, and credential reference. The Go inference executor never refreshes
credentials. An uncertain rotating-token result fails closed rather than
blindly retrying a possibly consumed token.
Explicit refresh always rediscovers the provider catalog, including when the
credential is non-expiring or not near expiry. Temporary provider failures
release leases and preserve valid credentials and saved selections. Device sign-in
continues polling after retryable errors until completion or authorization expiry;
terminal failures stop the flow. Definite
credential rejection and uncertain rotation outcomes remain fail-closed.

Catalog reconciliation removes selections only when a successful catalog
update proves a selected model is no longer present. Temporary inference
failures, failed refreshes, reconnect requirements, and `failClosed` preserve
saved model choices for later reconnect.

## Inference boundary

Overlay validates the selected model and supported stateless Responses request
before sending it to the private service. The bridge requires `stream: true`
and `store: false`; it has no stateful response or conversation continuation
store. Pinned CLIProxyAPI executors own provider translation. The bridge sends
OpenAI Responses source/target formats only to executors that register that
translator contract. SSE field lines and combined event/data frames pass
through unchanged; only bare JSON chunks receive a
`data:` prefix. Function tools without an explicit strictness choice send
`strict: false`, preserving optional arguments instead of inheriting the
provider's strict default; explicit strict choices are retained. Overlay returns bounded
streaming events for `streamText` and converts a completed Responses event to
JSON for `generateText`. Cancellation, response/event size limits, and safe
typed errors are enforced at the boundary. There is no timeout after an
upstream inference stream has connected.

Only the enumerated reconnect, rate-limit, model-unavailable, and temporary
failure codes are surfaced with actionable messages. Provider response text,
credentials, and raw errors are not returned or logged. Ordinary API-key and
gateway inference paths are unchanged.

## Configuration and rollout

General settings uses the shared model picker. Its reasoning controls edit the
same browser-local, workspace-scoped preferences used by new chats; the help
text states this scope. Existing threads keep their own snapshots. Model
defaults retain their existing account-settings persistence. No additional
reasoning defaults are written to global account settings.

Configure `OVERLAY_CLIPROXYAPI_URL` as the private service binding and
`OVERLAY_CLIPROXYAPI_SECRET` as a secret of at least 32 characters. Keep
`OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS` as the explicit comma-separated
allowlist `codex,claude,xai,meta,kimi,devin` when all are approved for
that environment. The bearer secret is shared between web and the private
service within each environment; Preview and Production use separate secrets.
The URL is supplied by the service binding, not a manually copied deployment
URL. Rebuild after changing settings and verify live provider availability before
starting authorization. Do not expose the subscriptions service through a public
rewrite. Hosting compatibility, preview behavior, cold starts, real-account
refresh, and end-to-end hosted streaming require isolated preview validation;
local tests and builds do not establish those hosted results.

The provider connection dialog stays within the dynamic viewport and scrolls
when its provider list exceeds the available height, keeping sign-in actions
reachable on short desktop and mobile screens.

Hosted acceptance verifies a previously connected Claude account after a new
service deployment: personal text and function-tool streaming, persisted replies
and full traces. Three real sandbox identities verify workspace-scoped listing,
owner-only management, cross-workspace denial, immutable reconnect scope and
retryable invalid callbacks. Mobile scope selection and the API-key form are
checked separately. Active shared dispatch and lease races have synthetic
Convex/service coverage; live shared-account inference and rotating refresh
remain unverified live-account cases. All six providers successfully start their
real authorization flows through the private bridge; pinned-executor fixtures
verify host, credential/model identity, text/function streaming and sanitized
failures. The owner explicitly authorized enabling all six in Production and
shared Preview after these checks. Live account completion/inference for every
provider is not implied by availability or catalog membership. Existing paid
access, exact-connection routing and no paid fallback remain enforced.
