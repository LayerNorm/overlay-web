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
- Authorization, billing, model policy, and usage-accounting bypasses
- Electron IPC and renderer-to-main privilege boundaries
- Shell, AppleScript, Accessibility, filesystem, and browser-agent operations
- Approval-mode or Full-access policy bypasses
- Browser profile isolation, SSRF, downloads, and local network access
- Auto-update, signing, notarization, release workflow, and supply chain
- Sensitive telemetry, logs, local storage, and credential handling

Detailed audits and active remediation notes are maintained privately. Public
security documentation describes supported behavior without publishing
unresolved exploit details.
