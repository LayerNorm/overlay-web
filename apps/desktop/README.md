# Overlay for Mac

The Overlay web app in a secure Electron shell, plus the parts a browser can't do:
system-wide dictation, floating chat and notes panels, screenshots, notifications,
a local Agent Host and automatic updates. Every web feature ships to desktop
through the same app routes; the desktop itself contains no chat or model code.

macOS on Apple Silicon only.

## Develop

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

`APP_SERVER_URL` picks the Overlay Server the window loads (HTTPS, or HTTP on
localhost only). SSO opens in your normal browser and hands a one-time,
PKCE-bound session back to the app.

```sh
bun run lint
bun run test
bun run build
bun run test:e2e
```

## How it works

- **Web shell.** One window pinned to one server origin. Remote pages get no Node
  access; only the top-level page of that origin receives the typed desktop bridge
  (`@overlay/desktop-bridge`, the shared package in the monorepo's `packages/overlay-desktop-bridge`).
  The main process validates every call again.
- **Dictation.** Default shortcut Control+Space (tap to toggle, hold to talk).
  Local WhisperKit and Parakeet models run offline after download; cloud
  dictation uses your Overlay account. No provider key is stored on the Mac.
- **Panels.** Command+. opens chat and Command+/ opens notes.
- **This computer.** Agent threads can run on this computer, in folders chosen in
  the system's folder dialog. The app starts a bundled Agent Host for this, only
  when the user chooses it; it serves Overlay's own tools and the server still
  approves every folder. The host and the Node.js runtime it uses ship inside
  the app, so nothing else needs to be installed.
- **Upgrades from the old app.** Old transcripts and native preferences are
  exported to the app's data folder once; nothing is uploaded or deleted.

## Release

`Release macOS` (manual dispatch with a full commit SHA) builds, signs,
notarizes, verifies and attests the DMG and ZIP, then publishes them to this
repository's GitHub Releases, which the auto-updater reads.

## License

AGPL-3.0-or-later ([LICENSE](LICENSE)). Overlay branding is not licensed for
forks; see [TRADEMARKS.md](TRADEMARKS.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Report security issues as
described in [SECURITY.md](SECURITY.md).
