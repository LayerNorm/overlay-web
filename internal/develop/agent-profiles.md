# Retired hosted agent profiles

Overlay Cloud no longer imports or applies third-party harness configuration.
New profile uploads and hosted configuration changes return
`410 hosted_runtime_retired`. The legacy profile GET remains available to read
sanitized historical metadata; owners may discard staged versions or delete
stored secret values through the existing cleanup actions.

No profile rows, artifacts, or audit history are automatically removed by this
retirement. Users running Claude Code, Codex, or another external harness on a
user-owned computer or VPS manage that harness configuration on their own host.
Overlay provider-account and model/subscription adapters remain independent of
hosted harness configuration and credential delivery.
