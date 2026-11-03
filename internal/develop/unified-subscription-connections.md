# Unified subscription connections

## Current scope

The first implementation slice supports Codex subscriptions only. Subscription
inference and provider-side authorization use the pinned CLIProxyAPI source in a
private, stateless service bound to the web service inside the same Vercel
project. The service has no public rewrite, shared account pool, auth files,
background refresh, or provider fallback. This implementation does not expand
personal/workspace schema or add other providers. The model picker is not part
of this slice.

The plan-based Codex catalog is sourced from CLIProxyAPI's plan registry. It is
catalog provenance, not proof that a particular account is entitled to every
listed model. Unknown plans fail closed.

## Responsibilities

Overlay owns the authenticated connection, its generation and revision fences,
model selections, and durable secret lifecycle. Provider credentials and
authorization state live in Overlay Vault; Convex keeps opaque references,
pending-write names, selected model IDs, and lease state. The bridge accepts a
credential envelope and explicit connection/model identity for each request. It
constructs one Codex auth record and executes only that credential—there is no
manager, pool, or account/model/paid-route fallback.

The bridge returns bounded, typed control responses for authorization, polling,
refresh, model listing, and inference. Authorization state is persisted by
Overlay so polling survives container restarts. Bridge calls require the
private service bearer secret. A missing URL or secret disables the adapter;
it never activates the old native subscription backend.

The old native Codex token format is not imported. Existing subscription
credentials in that format require one explicit reconnect. The shared
`codex-subscription.ts` helper remains for native/external Codex agent runs
through `AgentProviderAccountService`; it is not an inference or refresh
fallback for unified subscription connections.

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

Catalog reconciliation removes selections only when a successful catalog
update proves a selected model is no longer present. Temporary inference
failures, failed refreshes, reconnect requirements, and `failClosed` preserve
saved model choices for later reconnect.

## Inference boundary

Overlay validates the selected model and supported stateless Responses request
before sending it to the private service. The bridge requires `stream: true`
and `store: false`; it has no stateful response or conversation continuation
store. CLIProxyAPI owns Codex provider translation. Overlay returns bounded
streaming events for `streamText` and converts a completed Responses event to
JSON for `generateText`. Cancellation, response/event size limits, and safe
typed errors are enforced at the boundary. There is no timeout after an
upstream inference stream has connected.

Only the enumerated reconnect, rate-limit, model-unavailable, and temporary
failure codes are surfaced with actionable messages. Provider response text,
credentials, and raw errors are not returned or logged. Ordinary API-key and
gateway inference paths are unchanged.

## Configuration and rollout

Configure `OVERLAY_CLIPROXYAPI_URL` as the private service binding and
`OVERLAY_CLIPROXYAPI_SECRET` as a secret of at least 32 characters. Keep
`OVERLAY_SUBSCRIPTION_ENABLED_PROVIDERS` limited to `codex` to enable this
implemented adapter. Do not expose the subscriptions service through a public
rewrite. Hosting compatibility, preview behavior, cold starts, real-account
refresh, and end-to-end hosted streaming require isolated preview validation;
local tests and builds do not establish those hosted results.

Other subscription providers, workspace-scope schema work, broader catalog
entitlement verification, and the picker UI remain future work.
