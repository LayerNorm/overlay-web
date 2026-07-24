# Overlay Desktop

Overlay Desktop is the macOS client for Overlay: voice input, chat, notes, files,
and permissioned agent operations in an always-available desktop surface.

This repository is independently cloneable and buildable. It includes the
versioned `@overlay/*` source workspaces used by the desktop app and does not
require the Overlay web repository to be checked out beside it.

## Current support

- macOS on Apple Silicon (`arm64`) only.
- Node.js 22 or newer.
- Hosted mode connects to the official Overlay Server.
- Self-hosted mode can connect to a compatible Overlay Server deployment.
- The app is not a standalone offline backend. Authentication, hosted model
  policy, entitlements, billing, and hosted usage accounting remain
  server-authoritative.

Local transcription, local notes, local file operations, and user-owned API-key
flows can run on the Mac where the selected feature supports them. Cloud chat,
sync, hosted models, integrations, and account features require an Overlay
Server.

## Security model

Desktop chat operations use one of two host-execution modes:

- **Ask for approval** (default): the app requests fresh approval before an
  eligible command or local computer operation.
- **Full access**: eligible desktop chat operations may run without individual
  prompts. This is unsandboxed access to the user's Mac and should be enabled
  only when the user understands and accepts that risk.

Neither mode bypasses server authentication, authorization, billing, model
policy, or hosted usage accounting. Full access is a desktop-only host
permission; it is not a server privilege.

Agent browser sessions are isolated from the interactive browser profile, and
private, loopback, link-local, metadata, and other restricted network
destinations are blocked by policy. This is defense in depth, not a claim that
arbitrary host execution is risk-free.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Do not post audit details or proofs of concept in public issues.

## Build from source

Prerequisites:

- An Apple Silicon Mac
- Node.js 22+
- Xcode Command Line Tools

```bash
git clone https://github.com/DevelopedByDev/overlay-desktop.git
cd overlay-desktop
cp .env.example .env.local
npm ci
npm run dev
```

The checked-in default configuration points to Overlay's hosted server. No
owner-funded provider key, signing credential, release token, or server secret
belongs in the desktop environment.

To use a compatible self-hosted server, set `APP_SERVER_URL` to its HTTPS origin.
The server must implement Overlay's discovery and `/api/v1` contracts. A local
development server may use `http://localhost:3000`.

Useful checks:

```bash
npm run typecheck
npm test
npm run build
npm run check:dependencies:all
npm run license:check
```

Build a local Apple Silicon package:

```bash
npm run build:mac:ci
```

Official releases additionally require Developer ID signing, Apple
notarization, provenance, artifact verification, protected release
environments, and the release gates in
[guides/RELEASE_PROCESS.md](guides/RELEASE_PROCESS.md). Publishing is currently
frozen until those gates are independently approved.

## Repository layout

- `src/main`: trusted Electron main process and host capabilities
- `src/preload`: narrow renderer-to-main bridge
- `src/renderer`: React desktop UI
- `src/shared`: desktop-shared types and security helpers
- `packages`: versioned Apache-2.0 Overlay contracts, clients, and shared UI
- `scripts`: build, security, and release verification
- `resources`: native helpers and bundled application assets

The local workspaces use exact `0.0.1` versions so a clean checkout is
deterministic. They are prepared for public npm publication, but publication of
the `@overlay` scope is a separate release operation. A registry package should
not be assumed to exist until it is visible on npm and has passed its own
provenance review.

## Privacy

Optional diagnostics are off by default. See
[privacy-policy.md](privacy-policy.md) for the current data-flow description.

## Licensing

Overlay Desktop is licensed under `AGPL-3.0-or-later`. The reusable packages in
`packages/*` are explicit `Apache-2.0` exceptions. See [LICENSE.md](LICENSE.md),
[NOTICE.md](NOTICE.md), and each package's `LICENSE` file.

Open-source licenses do not grant rights to the Overlay name, logos, domains, or
trade dress. See [TRADEMARKS.md](TRADEMARKS.md).

## Links

- [Overlay website](https://getoverlay.app)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
