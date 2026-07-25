# Overlay Desktop

Overlay Desktop is the macOS client for Overlay: voice input, chat, notes, files,
and permissioned agent operations in an always-available desktop surface.

**Status:** public source (beta). Official signed macOS downloads open after
[Gate B](docs/GATE_B_BINARY_RELEASE_CHECKLIST.md).

This repository is independently cloneable and buildable. It includes the
versioned `@overlay/*` source workspaces used by the desktop app and does not
require the Overlay web repository to be checked out beside it.

## Download for macOS

Official Apple Silicon builds will be published from this repository’s GitHub
Releases and linked from [getoverlay.io/download](https://getoverlay.io/download)
once Gate B is approved.

Until then:

- Website download APIs remain fail-closed.
- Build from source on an Apple Silicon Mac (below), or wait for the signed beta.

**Requirements for official builds:** macOS on Apple Silicon (`arm64`) only.

## Current support

| | |
| --- | --- |
| Platforms | macOS Apple Silicon only |
| Node (from source) | 22+ |
| Hosted mode | Connects to the official Overlay Server at [getoverlay.io](https://getoverlay.io) |
| Self-hosted mode | Point the app at a compatible Overlay Server (`APP_SERVER_URL`) |
| Offline backend | Not supported — auth, hosted models, entitlements, and billing stay server-authoritative |

### Local vs cloud

| Capability | Local on the Mac | Needs Overlay Server |
| --- | --- | --- |
| Notes / notebook files | Yes | Optional sync |
| Local transcription helpers | Yes (where installed) | No |
| File / workspace tools | Yes (with permission) | No |
| User-owned provider API keys | Stored in Keychain | No |
| Sign-in / account | — | Yes |
| Hosted chat models & policy | — | Yes |
| Billing / entitlements | — | Yes |
| Cloud sync & integrations | — | Yes |

## Connecting to Overlay Server

The default configuration uses Overlay’s hosted server (`https://getoverlay.io`).

To use a compatible self-hosted server:

```bash
# .env.local (development) or your launch environment
APP_SERVER_URL=https://your-overlay-server.example.com
```

Requirements:

- HTTPS origin in production (HTTP `localhost` is allowed for local development).
- Server must implement Overlay discovery and `/api/v1` contracts compatible with
  this desktop client version.
- Do not put owner-funded provider keys, signing credentials, or server secrets
  in the desktop environment.

## Security model: Ask for approval vs Full access

Desktop chat host operations use one of two modes (main-process owned):

- **Ask for approval** (default): the app requests a fresh native approval before
  each eligible local computer operation.
- **Full access**: after an explicit native warning, eligible desktop chat
  operations may run without per-action prompts. This is **unsandboxed** access
  to the user’s Mac. Enable only when you understand and accept that risk.

Neither mode bypasses server authentication, authorization, billing, model
policy, or hosted usage accounting. Full access is a desktop-only host
permission; it is not a server privilege.

Agent browser sessions are isolated from the interactive browser profile.
Private, loopback, link-local, metadata, and other restricted destinations are
blocked by policy — defense in depth, not a claim that host execution is risk-free.

Report vulnerabilities privately per [SECURITY.md](SECURITY.md). Do not post
audit details or proofs of concept in public issues.

## macOS permissions

Overlay may request:

| Permission | Why |
| --- | --- |
| Microphone | Voice input / transcription |
| Accessibility | UI automation tools the user approves |
| Apple Events / Automation | Control other apps when an approved tool needs it |
| Files / folders | Read/write workspace paths the user selects or approves |
| Browser / network | Interactive browsing and agent browser (policy-restricted) |
| Keychain | Store auth session material and user-owned API keys via OS secure storage |

macOS may show system prompts the first time a capability is used. Deny any
permission you do not want Overlay to use; related features will fail closed.

## Build from source

Prerequisites: Apple Silicon Mac, Node.js 22+, Xcode Command Line Tools.

```bash
git clone https://github.com/LayerNorm/overlay-desktop.git
cd overlay-desktop
cp .env.example .env.local
npm ci
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm test
npm run build
npm run check:dependencies:all
npm run license:check
```

Local unsigned Apple Silicon package:

```bash
npm run build:mac:ci
```

Official releases require Developer ID signing, notarization, provenance, and
the gates in [guides/RELEASE_PROCESS.md](guides/RELEASE_PROCESS.md). Publishing
stays frozen until Gate B is signed.

## Troubleshooting

### Sign-in / authentication

- Confirm `APP_SERVER_URL` (or the default hosted server) is reachable.
- Complete the browser sign-in flow; return via the `overlay://` callback.
- If the callback fails, check that Overlay is the default handler for
  `overlay://` and that no other Electron build is intercepting it.
- Sign out and retry after a server-side session revocation.

### Keychain

- Overlay uses the macOS Keychain (via Electron `safeStorage` / Keychain-backed
  storage) for secrets. If Keychain access is denied, auth and user API keys
  will not persist.
- After moving machines or resetting Keychain, sign in again and re-enter any
  user-owned provider keys.

### Permissions

- Open **System Settings → Privacy & Security** and grant Microphone,
  Accessibility, Automation, and Files as needed.
- Quit and relaunch Overlay after changing TCC permissions.

### Native models / helpers

- Local transcription helpers require the bundled native artifacts for arm64.
- If a helper fails to start, confirm you are on Apple Silicon and that the app
  was not stripped of `parakeet-bundle` / related resources.
- From-source builds may need a successful `npm run build` / packaging step
  before helpers are present.

More configuration notes: [SUPPORT.md](SUPPORT.md).

## Uninstall and local data

1. Quit Overlay.
2. Move `Overlay.app` to Trash (or delete your from-source build output).
3. Optional — remove local data:

```bash
rm -rf ~/Library/Application\ Support/Overlay
# Dev / unsigned Electron builds may instead use:
# rm -rf ~/Library/Application\ Support/Electron
```

4. Optional — remove Keychain entries created for Overlay if you no longer use
   the app (Keychain Access → search “Overlay”).

Uninstalling the app does not delete your cloud account or server-side data.

## Repository layout

- `src/main` — trusted Electron main process and host capabilities
- `src/preload` — narrow renderer-to-main bridge
- `src/renderer` — React desktop UI
- `src/shared` — desktop-shared types and security helpers
- `packages` — versioned Apache-2.0 Overlay contracts, clients, and shared UI
- `scripts` — build, security, and release verification
- `resources` — native helpers and bundled application assets

Workspace packages use exact `0.0.1` versions for deterministic clean checkouts.
Publishing `@overlay/*` to npm is a separate operation.

## Privacy

Optional diagnostics are off by default. See
[privacy-policy.md](privacy-policy.md).

## Licensing

Overlay Desktop is `AGPL-3.0-or-later`. Reusable packages in `packages/*` are
explicit `Apache-2.0` exceptions. See [LICENSE.md](LICENSE.md), [NOTICE.md](NOTICE.md),
and each package `LICENSE`. Trademarks: [TRADEMARKS.md](TRADEMARKS.md).

## Links

- [Website](https://getoverlay.io)
- [Download page](https://getoverlay.io/download)
- [Source](https://github.com/LayerNorm/overlay-desktop)
- [Docs](https://getoverlay.io/docs)
- [Changelog](CHANGELOG.md)
- [Support](SUPPORT.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
