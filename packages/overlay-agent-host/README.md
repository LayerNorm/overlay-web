# Overlay Agent Host

`@overlay/agent-host` runs user-owned agents on a local computer, VPS, container, or managed
sandbox. It makes outbound requests only and persists command outcomes, remote sessions, and
unacknowledged events in SQLite.

Phase 2 uses a manual config while Phase 3 adds browser enrollment and short-lived credentials.
Keep credentials out of the JSON file:

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
    { "manifest": "claude-code" }
  ]
}
```

The built-in manifests resolve to the maintained
`@agentclientprotocol/codex-acp` and `@agentclientprotocol/claude-agent-acp` packages. A custom
ACP process can still use the explicit `id`, `displayName`, `protocol`, `command`, and `args`
shape.

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
