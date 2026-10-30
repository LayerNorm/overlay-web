# Overlay for Mac

The complete Overlay web app in a secure Electron shell, with native dictation,
floating chat and notes panels, screenshots, notifications, a local Agent Host
and automatic updates. Web features ship to desktop through the same app routes.

CI exercises the native recorder HUD with a synthetic media device as well as
direct transcription, so capture startup and preload isolation are both covered.
Local capture is decoded to 16 kHz mono PCM WAV in the isolated preload before
native inference; cloud transcription keeps its original capture container.

```sh
npm ci
npm run dev
```

Development defaults to the local web server. Set `APP_SERVER_URL` to the intended
HTTPS server (HTTP is accepted only for loopback development). The server profile
pins the origin used for navigation, permissions and the typed bridge. Remote
pages have no Node access. SSO opens in your normal browser and transfers a
one-time PKCE-bound session into the persistent app cookie partition.

Settings → Desktop configures native features. Default shortcuts are Control+Space (tap to toggle, hold to talk)
for dictation, Command+. for chat and Command+/ for notes. Local WhisperKit and
Parakeet models work offline after downloading; cloud dictation uses your Overlay
account and its existing billing checks. No provider key is stored in the desktop.

```sh
npm test
npm run build
npm run test:e2e
npm run security:verify:source
```

Playwright drives the actual Electron preload with throwaway profiles. Boundary
tests use a loopback fixture; the configured-server tests exercise real signed-out
web rendering and PKCE transfer navigation. Real Google sign-in, audio, screen
permissions and signed upgrade acceptance also require the release QA checklist.

`packages/overlay-desktop-bridge` is vendored from overlay-web. Keep its schemas
and fingerprint synchronized. Only the pinned top-level origin receives it; main
validates the caller, method and arguments again. Main contains no chat/agent
inference pipeline, provider SDK or direct Convex client. Agent Host enrollment is
user-initiated and server approval still gates filesystem access.

On upgrade, transcripts and native preferences are exported privately, while
recordings, knowledge files and migration journals remain on disk. Desktop settings
opens that folder. Legacy browser tabs/bookmarks and local assistant preferences
are retired. No local content is uploaded or deleted automatically.

Official macOS builds use the existing signed/notarized workflow and protected
release environments. Binary publication remains gated by the release checklist;
source validation alone does not approve publication. CI saves the compiled shell
with source provenance for interactive QA without rebuilding on the laptop. See [release process](guides/RELEASE_PROCESS.md)
and [security policy](SECURITY.md).

The macOS CI wrapper imports the existing signing certificate into an ephemeral
keychain using a separate random keychain password, then passes `CSC_KEYCHAIN`
to electron-builder. It removes the certificate file and keychain after use.
Signing and notarization remain in CI; the publication gate remains separate.

Clean-clone CI also seeds a throwaway legacy file-origin browser profile and
launches the real upgrade path, verifying private transcript export, secret
exclusion, retained recordings/journals and a once-only migration notice.

For real local-model QA, dispatch Clean public clone with `local_transcription`
enabled. The macOS runner synthesizes a test phrase and downloads the pinned
Whisper Base model before transcribing through the actual sandboxed bridge. The ASR helper runs
under a test-only macOS sandbox that denies networking, verifying offline inference.
This is an opt-in network/model smoke, separate from the ordinary fixture suite.

Whisper downloads include pinned model-specific tokenizer files. Older downloads
without them appear as needing Download; this repairs their tokenizer without
replacing existing model weights. Transcription refuses an incomplete offline
setup instead of letting the helper fetch dependencies implicitly.
