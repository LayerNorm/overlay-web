# Support

## Supported

| Item | Supported |
| --- | --- |
| OS | macOS on Apple Silicon (`arm64`) |
| Official signed builds | After Gate B (GitHub Releases + getoverlay.io/download) |
| From-source builds | Apple Silicon Mac, Node.js 22+ |
| Hosted Overlay Server | https://getoverlay.io |
| Self-hosted Overlay Server | HTTPS origin implementing compatible discovery + `/api/v1` |
| Chat permission modes | Ask for approval (default), Full access (explicit opt-in) |

## Unsupported / out of scope

| Item | Status |
| --- | --- |
| Intel Macs (`x86_64`) | Not supported |
| Windows / Linux desktop | Not supported |
| Fully offline account/billing/hosted models | Not supported |
| Running the Electron UI inside Docker | Not supported |
| Making `DevelopedByDev/overlay-desktop` public | Do not — private history retained for archive only |
| Public detailed security audit reports | Kept private; use SECURITY.md reporting |

## Getting help

1. Check [README.md](README.md) troubleshooting and this file.
2. Search existing GitHub issues on
   [LayerNorm/overlay-desktop](https://github.com/LayerNorm/overlay-desktop).
3. Open a new issue with macOS version, Apple Silicon confirmation, Overlay
   version (or git SHA), and reproduction steps.
4. Security issues: follow [SECURITY.md](SECURITY.md) — do not file public PoCs.

## Configuration quick reference

| Variable | Purpose |
| --- | --- |
| `APP_SERVER_URL` | Overlay Server origin (hosted default if unset in official builds) |
| User provider API keys | Entered in-app; stored via OS Keychain / safe storage |
| Owner-funded server keys | Server-only — never ship in the desktop client |

## Uninstall

See [README.md](README.md#uninstall-and-local-data).
