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

## Workspace agent directory and editable profiles

The native directory surface is backed by `workspaceAgentDefinitions` and the
transactional helpers in `convex/collaboration/agents.ts`. It is separate from
the imported runtime-profile records and secrets described above: native
directory projections expose only the public editable profile and the
`WorkspaceAgentDirectoryItem` allowlist, never binding adapter configuration,
provider credentials, or imported runtime secrets.

The feature-scoped provider under `src/features/agents` uses authenticated
Convex list, detail, create, update, and restore operations when native auth is
configured. Editable snapshots carry an opaque revision derived from the
persisted public profile, update time, and personal-chief identity overlay.
Update and restore mutations compare that revision atomically so older BFF
writes and chief identity propagation cannot silently overwrite a draft.
Native list pages are capped at 100 records and the UI loads every page before
presenting a complete directory. Related-record traversals are capped at 200;
native writes and chief bootstrap fail closed with a capacity error rather
than silently truncating related records. A configured-but-unavailable native
path fails closed rather than falling back to HTTP; installations without
native auth retain their legacy compatibility path.

The migration does not move server-owned orchestration. Archive remains the
privileged BFF cleanup path; computer provisioning/lifecycle, connected-agent
bindings, threads, runs, memories, and profile-secret cleanup also remain
server-owned. Directory consumers not yet wired to the feature hook are
integration gaps: Direct Message hooks, automation panels, Computer Settings,
archived-agent actions, onboarding, and shared chat. They should migrate only
through a deliberate feature-scoped hook/seam, not by broadening the provider
or removing the legacy directory API.

Run the native endpoint tests with
`npx vitest run --config vitest.config.mts convex/nativeAgentDirectory.convex.test.ts`.
The provider, connected-agent settings and organization editor seams are part
of `vitest.unit.config.mts`, so the repository-wide test orchestrator runs them.
