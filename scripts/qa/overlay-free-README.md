# Overlay Free router playground

This standalone playground uses live provider access. Its startup refresh can
send short synthetic probes, and a chat request can incur provider charges.
Use a development key and verify costs before testing.

## Start

From the repository root, configure `AI_GATEWAY_API_KEY` and/or
`OPENROUTER_API_KEY`, then run:

```sh
node scripts/qa/overlay-free-server.mjs
```

Open <http://localhost:4317>. The server generates a random access token and
injects it into the served page; no token environment variable or API base URL
prompt is needed. Do not open the HTML file directly with `file://`.

The prototype is not production authentication or durable safety state. Its
quarantine file is local playground state under `artifacts/`.
