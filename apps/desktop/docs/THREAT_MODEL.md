# Desktop Threat Model

## Assets

- User files, notes, chats, audio, browser state, and integration data
- Authentication and refresh tokens
- User-owned provider credentials
- Host capabilities such as shell, AppleScript, Accessibility, and filesystem
- LayerNorm-funded provider access and billing accounts
- Signing identities, update metadata, and release credentials

## Adversaries

- A malicious webpage, document, prompt, memory, tool response, or integration
- A compromised renderer or dependency
- A hostile modified desktop client
- An attacker who copies local app data from another account or device
- A compromised download, update feed, build dependency, or release workflow
- An abusive authenticated user attempting owner-funded spend or cross-tenant access

## Primary abuse cases

1. Untrusted content causes host execution or private-network access.
2. A renderer invokes undeclared IPC, steals reusable credentials, or changes
   approval state.
3. A modified client removes UI checks to obtain models, entitlements, or
   owner-funded work.
4. Stolen app data becomes a reusable account session or Full-access grant.
5. A model, native helper, dependency, or update is replaced upstream.
6. Logs or optional diagnostics disclose prompts, tokens, identifiers, URLs,
   or filesystem paths.

## Required controls

- Main-process capability ownership and sender/origin validation
- Server-authoritative auth, authorization, billing, policy, and usage
- Default-deny tool registration and contextual approval
- Isolated agent browser storage and destination validation
- System keychain/token protection and revocation
- Pinned inputs, lockfile installs, SBOM, provenance, signing, and notarization
- Diagnostics off by default with redaction and bounded local retention

## Accepted and deferred risk

Full access intentionally permits unsandboxed eligible host operations after
explicit informed consent. microVM isolation is deferred; permissioning reduces
accidental or unauthorized execution but does not contain an operation the user
has allowed. This residual risk must remain visible in product copy and release
review.

Official release remains blocked until the independent review and packaged
adversarial tests close the release gates.
