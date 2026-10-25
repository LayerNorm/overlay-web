# Overlay subscription broker

This standalone Node service supervises an isolated, loopback-only CLIProxyAPI
process per Overlay subscription connection. The CLIProxyAPI source is fetched
at the fixed commit `bc0643405a1d0adf77dd0f109972ac3313d66397` by the Docker
build; it is not vendored in this repository.

## Configuration

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `OVERLAY_SUBSCRIPTION_BROKER_KEY` | At least 32 random bytes, base64 or hex. The app sends it only in a server-to-server bearer header. |
| `OVERLAY_SUBSCRIPTION_MASTER_KEY` | Exactly 32 random bytes, base64 or hex, used for AES-256-GCM snapshots. |

Mount `/run` as private tmpfs
(`--tmpfs /run:rw,noexec,nosuid,size=1g,uid=1000,gid=1000`) and
mount `/var/lib/overlay-subscription-broker` on encrypted persistent storage.
The service refuses startup if any durable snapshot fails authentication.
Keep the broker URL private, use HTTPS between the app and broker, and restrict
network access to the application backend. The management endpoints require the
service key as well as owner and connection identifiers.

Example:

```sh
openssl rand -base64 32 # set as OVERLAY_SUBSCRIPTION_BROKER_KEY
openssl rand -base64 32 # set as OVERLAY_SUBSCRIPTION_MASTER_KEY
docker build -f packages/overlay-subscription-broker/Dockerfile -t overlay-subscription-broker .
docker run --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --tmpfs /run:rw,noexec,nosuid,size=1g,uid=1000,gid=1000 \
  -v overlay-subscriptions:/var/lib/overlay-subscription-broker \
  -e OVERLAY_SUBSCRIPTION_BROKER_KEY -e OVERLAY_SUBSCRIPTION_MASTER_KEY \
  -e OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS=codex,xai \
  --memory=2g --cpus=2 \
  -p 127.0.0.1:8088:8088 overlay-subscription-broker
```

Configure the application separately with
`OVERLAY_SUBSCRIPTION_BROKER_URL=https://<private-broker-host>` and the same
service key. Use HTTP only for an explicitly local development broker. Set
`OVERLAY_SUBSCRIPTION_MAX_WORKERS` to a value from 1 to 128 to lower the
default process cap. All providers share serialized admission, including pending
Codex device authorizations and worker startup; reconnecting the same connection
reuses its reservation. Container memory and CPU limits remain the outer safety
boundary. `OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS` is an explicit
operator rollout allowlist and defaults to empty. This is eligibility
configuration, not proof that a provider works in production; verify each
adapter and inference protocol separately before adding it. Run exactly one
broker replica with an exclusive durable volume. The broker takes a durable
startup lock and refuses to run alongside another process; investigate a
stale lock after an unclean host loss and remove it only after confirming no
broker owns the volume.

Do not expose worker ports or management APIs. Each worker receives a generated
API key and management key, and subprocess output is discarded because it can
contain account data. Worker auth files exist only on the private runtime
filesystem and are encrypted before persistence. Limits default to 128 workers
and 2 MB request bodies.

## Current adapter coverage

The service defines OAuth adapters for Codex, xAI, Meta, Kimi, Kimi AI, and
Devin. Codex uses Overlay's existing device-code helper and imports the
resulting account into its isolated worker. The other adapters rely on the
pinned CLIProxyAPI v8 management handlers. Provider compatibility and
discovery must be validated against the deployed pinned build; no live provider
account has been tested. Devin callback completion accepts only a loopback
callback URL whose state matches the encrypted authorization session and never
fetches the URL supplied by the user.

The service supports text streaming only. It accepts Overlay-handled function
and custom text tools, and rejects provider-hosted tools plus image, audio,
video, and zero-data-retention requests. No inference retry, shared account
pool, or paid Overlay fallback is provided. Fixed system/background helpers
such as tab-group labels and media intent remain on their existing hosted
models; native-only external cloud consumers are not subscription-supported.
