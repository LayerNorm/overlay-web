# Changelog

All notable changes to Overlay Desktop are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- First-run setup for new accounts (with overlay-web's desktop onboarding). A new `localSetup` bridge capability lists what Claude Code, Codex, Claude Desktop, Cursor and Gemini CLI keep on this computer (instructions, skills, subagents and MCP servers) by name only, and imports the ones the person ticks through Overlay's own API with the app's session, so file contents and header tokens never reach the page. It also finds model keys in the login shell (shown by name and last four characters) and, on *Use this key*, checks one with the provider and keeps it in the keychain, and it notices Claude Code and Codex plan sign-ins for later. Local (command) MCP servers are listed but not imported.

## [0.5.0] - 2026-11-26

- Give private threads their agent's Overlay tools (memory, files, notes, tasks, web search…). Before each turn the app asks Overlay for a one-hour token for that person, workspace and agent with its own signed-in session, so the page never holds it, and hands it to the bundled Agent Host (now 0.7.0), which calls the tools over Overlay's MCP server at this app's own server address. The conversation still stays on this computer. Without a token (signed out, offline) the turn runs with this computer's tools only. Which tools a thread gets, and the free tier for workspaces without a plan, are decided by the server.
- Private threads get the same screen tools as synced threads on this computer: screenshots and mouse and keyboard input on macOS, and the browser and open-URL tools on macOS and Linux, with the same approval rules. Long private threads are summarized before they outgrow the model's context window, and screenshot images aren't kept after a turn. These come with the bundled Agent Host 0.7.0, now resolved from npm in the bundle lockfile.
- Update the web shell sign-in tests for the current desktop sign-in screen (one Sign in button that reads the server's discovery document, then opens the browser).

## [0.4.0] - 2026-11-21

- Connect to Overlay Cloud at `overlay.works`, its new main address. New installs start there, and a computer that was set up for `getoverlay.io` moves to `overlay.works` automatically, still treated as Overlay Cloud. The old address only redirects now, so earlier versions should update.
- Run threads on this computer without syncing them to the cloud. With Cloud sync off, a thread's agent runs in the bundled Agent Host (0.6.0, started as `overlay-agent-host private` over an IPC channel with no network port), its transcript stays in `private-threads/private-threads.sqlite` in the app's data folder, and it calls the agent's model with the person's own Anthropic, OpenAI, Google or OpenRouter key. Keys are checked with the provider before they are kept in the system keychain, and are handed to the host only for the run that needs them. A new `localThreads` bridge capability lists, opens, runs, stops and deletes these threads and streams their replies to the page; it is advertised only when the bundled host supports it. A thread may work only in `~/Overlay Files`, a folder chosen in the system folder dialog, or a folder already approved for this computer. Signing out or quitting stops running threads and keeps their transcripts. The bundled host's ESM build now provides `require()` for the CommonJS packages its model SDKs use.

## [0.3.1] - 2026-11-17

- Run threads on this computer without Node.js installed. The app used to start the Agent Host through `npx`, so a Mac without Node.js could not run a local thread and a Mac with it downloaded the host from npm on first use. The app now ships the Agent Host (0.5.0) and Node.js 24.22.3 inside the signed bundle and starts them directly; nothing is installed or downloaded on the user's computer. `npm run build:agent-host` assembles the bundle from the official Node.js build, pinned by checksum in `native-artifacts.json`, and from `agent-host-bundle/package-lock.json`; the release build runs it, and the license check, SBOM and artifact verification cover it. The download grows by the size of Node.js. `OVERLAY_DESKTOP_DEV_HOST_PACKAGE` is replaced by `OVERLAY_DESKTOP_DEV_HOST_CLI`, the path to another host checkout's `cli.mjs`, for unpackaged builds.

## [0.3.0] - 2026-11-16

- Run agent threads on this computer from a thread, not only from Settings. The bridge gains `localComputer.chooseFolder`, which opens the system's folder dialog so people pick a folder instead of typing a path, and `localComputer.status` now reports the computer's own name (from System Settings), the environment it connected as and its work folder, so the web app knows which threads belong to this computer. Connecting creates `~/Overlay Files`, where threads without a folder work. The computer connects under its own name instead of its network host name. The app says "this computer" instead of "Mac".
- Remove the Agent host harness mode: the embedded host no longer starts Codex, Claude Code or Hermes over ACP. `agentHost.start` now only connects This Mac with local tools, and host status no longer reports an adapter.
- Add This Mac: Overlay agents can use this Mac as a Computer. The embedded Agent Host (now 0.5.0) can start with `--local-tools` and no third-party harness. The bridge gains the `localComputer` capability (status, macOS Screen Recording and Accessibility permission requests, and a per-device "keep available" switch) plus a `localTools` option on `agentHost.start`. With "keep available" on, the saved local-tools host restarts at launch once the session is verified; sign-out turns it off and stops the host. Unpackaged development builds can run a locally packed host through `OVERLAY_DESKTOP_DEV_HOST_PACKAGE` for QA.
- Slim the repository down to the desktop shell: delete the release-gate checklists, internal TODOs, outdated guides and docs, one-off test scripts for the old chat app (Composio, LanceDB, OpenRouter, phase tests, voice QA and their audio fixtures), checks for the removed renderer, the public-export tooling, unused fonts, provider logos, sounds and file icons, and duplicate license files. Settings, system helpers and security code lose the leftovers nothing called (old assistant settings, screenshots/volume/context capture helpers, rate limiter, unused sign-in exchange, panel latency marks).
- Allow the manual `Release macOS` workflow to publish to GitHub Releases; it was disabled while the old release gates were open.
- Drop the Windows/Linux packaging config (the app is macOS only) and the unused WorkOS/Convex environment variables.
- Remove the `electron-log` and `@electron-toolkit/utils` runtime dependencies, which nothing imports anymore.

- Show the Dock's running indicator: the dictation overlay is now a non-activating panel that floats over full-screen apps without briefly turning Overlay into a background app, which made macOS drop the dot under its Dock icon.
- Match the main window's frame to the Overlay theme (from the page's theme colour) instead of the macOS appearance, removing the black outline around the light theme when macOS is in Dark mode.
- Use the current Overlay logo (the black serif O with two eyes) as the app icon on macOS, Windows and Linux, sized to the macOS icon grid so it matches other Dock icons. Delete the outdated orb and "Dawn" logos, tray images and marketing images that the app no longer used.
- Restore ESLint: remove the React plugins left in the config after the web-shell switch (they were uninstalled, so lint crashed), drop disable comments that no longer suppress anything, and run `npm run lint` in the clean-clone CI so a broken config fails the build.
- Explain cloud dictation refusals: a workspace without billing, a member who may not use its billing, or exhausted workspace credit now show what to do (set up Billing or pick a local model) instead of "Cloud dictation failed (402)".
- Keep a new recording active when a cancelled take finishes its pending worklet flush.
- Normalize provider whitespace and preserve spacing between successive dictation insertions.
- Register initial window visibility before navigation to avoid missing a fast first render.


- Start microphone capture independently of cloud session admission, prepare a suspended PCM graph at launch, and capture WAV directly without a whole-recording decode.
- Replace the recorder box with a non-focusable, bottom-centered capsule, real audio meter, reduced-motion support, finish/dismiss controls and temporary retry/copy recovery.
- Add microphone selection, cancellation of inference, frontmost-app delivery checks and clipboard preservation. Audio/results remain in memory and expire after 60 seconds.

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
