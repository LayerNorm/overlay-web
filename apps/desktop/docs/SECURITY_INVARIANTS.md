# Security Invariants

Changes must preserve these properties:

1. Renderers never receive reusable auth, provider, billing, signing, or release
   secrets.
2. Every privileged IPC handler validates the sender, window/frame, schema,
   authorization context, and payload bounds.
3. Ask for approval is the default desktop chat mode. Only the main process can
   store or mutate the mode.
4. Full access affects only explicitly eligible desktop host operations. It
   cannot bypass server authentication, authorization, model policy, billing,
   reservations, or usage accounting.
5. Hosted work is authorized and accounted by the server under concurrency-safe
   reservations. Local counters are advisory only.
6. Agent browsing never shares the interactive cookie jar and cannot reach
   prohibited local or metadata destinations.
7. Self-hosted failures never silently fall back to Overlay Cloud.
8. Optional diagnostics remain off by default and exclude content, credentials,
   raw identity, filesystem paths, and browsing data.
9. Release publishing credentials are absent from install, test, build, and
   artifact-verification steps.
10. Public builds use only files in this repository and public immutable
    dependencies; no sibling checkout is required.

Tests may make these invariants stricter, but product code must not weaken them
without an explicit security review and release-gate update.
