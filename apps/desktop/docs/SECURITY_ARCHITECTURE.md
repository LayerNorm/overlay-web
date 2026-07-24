# Desktop Security Architecture

Overlay Desktop treats every renderer, model response, webpage, document,
integration result, tool output, and modified client request as untrusted.

## Authority boundaries

The Electron main process owns host capabilities, credentials, session state,
server profiles, browser profiles, approval state, updates, and telemetry
consent. Renderers receive narrow context-bridge methods and cannot define
their own IPC channels or retrieve reusable secrets.

Overlay Server is authoritative for authentication, user and organization
identity, authorization, hosted model policy, entitlements, billing,
reservations, and hosted usage accounting. A desktop UI check is never the
financial or authorization boundary.

## Desktop operation permissions

Ask for approval is the default. Approval is fresh, contextual, sender-bound,
and limited to the operation displayed to the user.

Full access permits eligible desktop chat operations to bypass individual
approval prompts after an explicit native confirmation. It does not bypass
server controls and does not grant hidden capabilities to web, mobile, or other
surfaces. Full access is deliberately unsandboxed; users should enable it only
for trusted tasks.

## Browser and network isolation

Interactive browsing and agent browsing use separate session partitions.
Agent sessions do not inherit interactive cookies. Network policy rejects
loopback, private, link-local, metadata, reserved, and internal destinations,
including after DNS resolution and redirects. Downloads are bounded and
quarantined.

## Distribution

Production packages burn restrictive Electron fuses, use ASAR integrity, omit
source maps, minimize entitlements, sign nested code, require Apple
notarization, and use monotonic stable updates. The build and publish roles are
separate so release credentials are not exposed to dependency installation or
compilation.

See `docs/THREAT_MODEL.md` for attacker goals and `SECURITY.md` for private
reporting.
