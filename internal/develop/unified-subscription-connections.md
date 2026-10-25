# Unified subscription connections

Subscription connections add account-owned model providers alongside API-key
connections. They keep the `byok/{connectionId}/{modelId}` model namespace and
are checked against the authenticated owner, active connection status, account
discovery and the enabled-model list before inference. The empty endpoint on a
subscription record is a sentinel only; subscription inference never uses it
as a destination.

## Services and configuration

The web application calls a separate Node broker through the server-only
`OVERLAY_SUBSCRIPTION_BROKER_URL` and `OVERLAY_SUBSCRIPTION_BROKER_KEY`
settings. The URL must be HTTPS outside local development. Do not put either
setting in `NEXT_PUBLIC_*` or accept a broker URL from a client.

The broker needs `OVERLAY_SUBSCRIPTION_BROKER_KEY` (shared with the backend)
and `OVERLAY_SUBSCRIPTION_MASTER_KEY` (a private 32-byte key used to encrypt
durable AES-GCM snapshots). Build
`packages/overlay-subscription-broker/Dockerfile`; it fetches CLIProxyAPI at
the pinned commit documented in that Dockerfile. Mount its runtime directory
as private `noexec` tmpfs and its state directory on encrypted persistent
storage. Keep the broker reachable only from the application backend. See the
broker README for a keyless example and container limits.

Every connection has an isolated worker, auth directory, API key and
management key. Worker ports bind to loopback. Subprocess output is discarded.
Only authenticated server requests can create, poll, update models for, or
revoke a connection; each operation carries both owner and connection IDs.
Corrupt snapshots stop broker startup rather than silently creating a new
account. Disconnect revokes worker state before deleting connection metadata.

Codex authorization uses Overlay's existing device-code exchange helper; the
resulting token metadata is imported into that account's isolated worker, which
then owns refresh and rotation. xAI, Meta, Kimi, Kimi AI and Devin rely on the
pinned CLIProxyAPI management handlers. Devin callback completion validates a
loopback callback and matching state without fetching a user-supplied URL.

## Compatibility and coverage

Provider adapters and OAuth host allowlists are defined in the broker source,
but no live subscription account or hosted broker has been tested. Do not
interpret this source-level integration as a live compatibility guarantee.
Only discovered models are shown, and model selection cannot be forged through
the generic connection update route. Inference currently supports text
requests; image, audio, video and ZDR guarantees are not supported. This broker
does not supply credentials to external cloud agents or native-only legacy
agent paths.

The frontend and the API expose authorization status without returning device
secrets or callback state. Polling is serialized per connection, and an
incomplete Codex poll releases its lease for the next request. On a failed
disconnect, leave the metadata intact and retry revocation before removing it.
