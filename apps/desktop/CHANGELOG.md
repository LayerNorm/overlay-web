# Changelog

All notable changes to Overlay Desktop are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Cancel pending microphone permission requests safely; stale captures cannot start behind a hidden dictation HUD or stop a newer recording.

- Retain notification click handlers after delivery, restore minimized windows and clear delivered alerts on sign-out.

- Convert captured audio to PCM WAV before local inference so offline models can decode HUD and composer recordings.

- Use Control+Space for default dictation and report macOS notification permission failures instead of silently losing alerts.

- Fix native dictation HUD startup by isolating its recorder state from the preload bridge, and cover actual audio capture in Electron CI.

- Exercise signed macOS candidates with clean and upgraded profiles in CI before release publication.

- Scope cloud dictation to the trusted calling window’s workspace route.

- Include pinned tokenizer files in local Whisper model downloads and repair
  existing downloads so first-use dictation can run without networking.

- Keep floating panel identity across conversation URL changes and reloads.

- Let Quit finish while a floating panel is open, while keeping ordinary panel
  close actions as hide-and-return-focus.

- Use an ephemeral signing keychain with its own password for macOS CI, and
  explain cloud dictation plan limits in the native controls.

- Add opt-in crash diagnostics, clamp floating panels after display changes, and
  allow a failed legacy export to retry while the web app still opens.

- Load the full web app by default with a versioned, origin-checked native bridge.
  Keep dictation, compact chat/notes panels, screenshots, notifications, local
  Agent Host controls and updates; retire duplicate chat/UI/provider code.
- Preserve legacy transcripts, preferences, recordings and knowledge files during
  upgrade. Cancel active microphone capture and native work on web sign-out.
- Exercise the sandboxed bridge and package the native app in macOS CI.

### Added

- Public history-free source repository at
  [LayerNorm/overlay-desktop](https://github.com/LayerNorm/overlay-desktop).
- Documented Ask for approval vs Full access host-execution modes.
- SUPPORT.md and expanded README for self-hosting, permissions, and troubleshooting.

### Security

- Removed fake runtime sandbox IPC that claimed isolation without providing it.
- Coding tools (`code_*`) execute via `execFile` argv arrays (no shell interpolation).
- Convex deployment URLs resolve from environment / build define only (no hardcoded slugs).
- Official website download APIs remain fail-closed until Gate B.

### Changed

- Canonical development remote is LayerNorm; private DevelopedByDev history is archived.
- Dependency batch: TipTap 3.29, groq-sdk 1.x, GitHub Actions release pins, Storybook 10.5.

## [0.1.23] - prior

Pre–public-source builds lived on private release infrastructure. Tags
`v0.1.19`–`v0.1.23` on the private `overlay-releases` repository were drafted
and are not the recommended public distribution channel.
