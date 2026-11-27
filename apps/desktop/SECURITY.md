# Security Policy

## Supported versions

Security fixes currently target the latest code on the default branch. Older
snapshots, forks, development builds, and unofficial distributions are
unsupported unless maintainers explicitly say otherwise.

## Report a vulnerability privately

Do not open a public issue, discussion, or pull request containing a
vulnerability, proof of concept, private audit, secret, or customer data.

Use GitHub Private Vulnerability Reporting for this repository when available.
If it is unavailable, contact the maintainer privately at
divyansh@layernorm.co with the subject `Overlay Desktop security report`.

Include the affected version or commit, environment, reproduction steps,
impact, required privileges, and whether the issue has been disclosed
elsewhere. Use test accounts and non-production data.

We aim to acknowledge reports promptly, may request a reduced reproduction, and
ask reporters to allow time for investigation and coordinated disclosure.

## High-priority scope

- Authentication, session transfer, and server-profile trust
- The desktop bridge and main-process privilege boundaries
- Dictation delivery, Accessibility, AppleScript and Agent Host operations
- Auto-update, signing, notarization, release workflow, and supply chain
- Sensitive telemetry, logs, local storage, and credential handling

## Remote web shell

The macOS shell pins one server origin. Only its top-level document receives the
versioned desktop bridge; sandboxing, context isolation and web security remain
enabled. Main checks registered window identity and exact sender-frame origin,
validates allow-listed methods with bounded schemas and limits concurrent calls.
Subframes, offline pages and foreign origins receive no bridge. Permissions are
denied outside trusted main frames. External URLs permit HTTP(S)/mailto only.

The window owns its cookie session. Native code never stores or refreshes a second
WorkOS session; SSO transfer requires the pending PKCE verifier. Sign-out stops the
local Agent Host and closes panels. Native model helpers remain revision-pinned,
updates require a stable increasing version, and telemetry requires consent.
