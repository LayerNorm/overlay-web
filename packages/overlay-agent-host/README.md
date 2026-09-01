# Overlay Agent Host

`@layernorm/overlay-agent-host` runs the same outbound-only bridge on a local computer, VPS, container, or
managed sandbox. It persists command outcomes, remote sessions, adapter stream cursors, and
unacknowledged events in SQLite, so restarting the host does not duplicate accepted work.

Node.js 24 or newer is required. Overlay's one-copy command supplies a pinned Node 24 runtime even
when the machine's default `node` is older:

```sh
npx --yes --package node@24 --package @layernorm/overlay-agent-host@0.3.2 \
  overlay-agent-host connect <enrollment-code> \
  --server https://getoverlay.io \
  --kind vps \
  --run
```

The machine needs outbound HTTPS access to Overlay and durable storage for the state directory.
It does not need an inbound port.

Browser enrollment writes a restartable `config.json` beside the private connection state. The
credential remains in the mode-0600 connection store rather than the JSON file:

```json
{
  "environmentId": "environment-id",
  "workspaceId": "workspace-id",
  "controlPlaneUrl": "https://example.com/api/v1/agent-environments/environment-id/host/",
  "credentialEnv": "OVERLAY_AGENT_HOST_CREDENTIAL",
  "stateDirectory": "/absolute/path/to/overlay-agent-host",
  "filesystem": {
    "mode": "selected_roots",
    "roots": ["/absolute/project-one", "/absolute/project-two"]
  },
  "adapters": [
    { "manifest": "codex" },
    { "manifest": "claude-code" },
    { "manifest": "hermes" }
  ]
}
```

The built-in manifests resolve to the exact, release-tested
`@agentclientprotocol/codex-acp@1.7.0` and
`@agentclientprotocol/claude-agent-acp@0.70.0` packages. Hermes uses its official
`hermes acp` stdio server and requires Hermes Agent 0.20.6 or newer. Install Hermes from the
official Nous Research distribution, then verify it before enrollment with
`hermes acp --check`. A custom
ACP process can still use the explicit `id`, `displayName`, `protocol`, `command`, and `args`
shape.

## Eve

Eve is connected through its supported `eve/client` session and durable NDJSON stream contract.
Run the Agent Host beside the private Eve service and point the adapter at its loopback or private
network URL:

```json
{
  "id": "eve",
  "displayName": "My Eve agent",
  "protocol": "eve",
  "host": "http://127.0.0.1:3000",
  "bearerTokenEnv": "EVE_AGENT_TOKEN"
}
```

The equivalent enrollment form is:

```sh
npx --yes --package node@24 --package @layernorm/overlay-agent-host@0.3.2 \
  overlay-agent-host connect <enrollment-code> \
  --server https://getoverlay.io \
  --kind vps \
  --adapter eve \
  --eve-url http://127.0.0.1:3000 \
  --eve-auth-env EVE_AGENT_TOKEN \
  --run
```

Overlay remains authoritative for approvals, commands, billing attribution, audit, and transcript
projection. The adapter ignores private reasoning events, validates replies against Eve's pending
input requests, and persists Eve's session ID, stream cursor, visible text, and usage accumulators
for reconnects. Eve is pinned because its APIs are still preview. A missing cursor fails closed and
requires `start fresh`. Eve connection OAuth pauses are not bridged; an `authorization.required`
event fails the run closed instead of leaving it parked without an Overlay control.

## Background and container operation

On macOS, install the per-user LaunchAgent after enrollment so the environment remains online when
Terminal closes and returns after login or process failure. Use the exact config path printed by
`connect`:

```sh
npx --yes --package node@24 --package @layernorm/overlay-agent-host@0.3.2 \
  overlay-agent-host service install --config "$HOME/.overlay/agent-host/config.json"
npx --yes --package node@24 --package @layernorm/overlay-agent-host@0.3.2 \
  overlay-agent-host service status --config "$HOME/.overlay/agent-host/config.json"
```

The installer records the current executable search path plus common user-level agent locations,
so adapters installed in locations such as `~/.local/bin` remain available after Terminal closes.
`service uninstall` stops and removes only that environment's LaunchAgent. It preserves the
credential, config, and SQLite state so the connection can be restarted later.

For a Linux VPS, create a dedicated `overlay-agent` system account, install the CLI globally, copy
`systemd/overlay-agent-host.service` to `/etc/systemd/system/`, and place configuration under
`/etc/overlay-agent-host/`. Adjust `ReadWritePaths` in the unit to exactly the project roots granted
in Overlay, then enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now overlay-agent-host
sudo systemctl status overlay-agent-host
```

The unit restarts after process or machine failure and keeps state in `/var/lib/overlay-agent-host`.
Upgrades are `npm install -g @layernorm/overlay-agent-host@<version>` followed by `systemctl restart`; do not
delete the state directory. `docker-compose.example.yml` provides the same persistent, outbound-only
shape for Docker. It exposes no host ports. Mount the approved workspaces and state volume, pull a
pinned image version, and recreate the service to upgrade.

Run diagnostics and then the host:

```sh
OVERLAY_AGENT_HOST_CREDENTIAL=... overlay-agent-host doctor --config /absolute/path/config.json
OVERLAY_AGENT_HOST_CREDENTIAL=... overlay-agent-host run --config /absolute/path/config.json
```

Use `{"mode":"all_user_files"}` only when the user deliberately wants the harness to inherit
all filesystem access available to the host OS account. Selected roots validate the working
directory and ACP workspace roots; they are not an operating-system sandbox. For strict file
isolation, run the host and harness under a restricted OS account, container, VM, or managed
sandbox.

Native adapters such as OpenClaw are added only when the harness cannot expose ACP and only after
the unchanged Agent Host conformance suite passes. Hermes uses its official ACP server. MCP remains
a tool/resource protocol; it is not used as the execution lifecycle transport.
