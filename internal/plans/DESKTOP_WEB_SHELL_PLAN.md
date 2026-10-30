# Desktop app as a web shell

Status: In progress (2026-10-29). Phases 2–5 are implemented and automated acceptance passed, including real Google/native session handoff, live isolated Agent Host lifecycle, and captured-audio offline inference. Final signed-candidate and physical-input confirmation remain in progress; binary publication stays frozen under the separate release gates.

Repos: `LayerNorm/overlay-web` (this repo) and `LayerNorm/overlay-desktop`.

## Progress

| Phase | State | Where |
| --- | --- | --- |
| Groundwork | Done | Desktop `verify` CI runs tests and builds again (overlay-desktop#74: audit fixes, Electron 42.11.18); shared sidebar and Tailwind 4 landed (overlay-desktop#67, #68) |
| 0: spike | Code landed; flow checks open | overlay-desktop `933e842` |
| 1: sign-in | Implemented; real Google and native handoff exercised | overlay-web `7f62ce390`, overlay-desktop `9e7969f` |
| 1: end-to-end test | Done | overlay-desktop `a5f0d49` (`npm run test:e2e`) |
| 2: bridge | Implemented; boundary acceptance passed | Shared v1 contract, exact-origin preload/router, desktop chrome and settings |
| 3: native capabilities | Implemented; hardware/live acceptance open | Dictation, models, hotkeys, panels, notifications/badge, host, updates, capture |
| 4: web panels | Implemented; authenticated send/persistence/reload exercised | Shared session and compact chat/notes routes |
| 5: duplicate removal | Implemented; CI passed | Native-only startup and dependency guard |
| 6: release readiness | In progress | Signed/notarized CI and legacy-profile/offline-model tests passed; real-device release acceptance remains |

Baseline completed before this continuation:

- `src/main/services/web-shell.ts` (desktop): with `OVERLAY_WEB_SHELL=1` the
  main window loads `<serverOrigin>/app` in `persist:overlay` with no
  preload. Same-origin navigation and WorkOS sign-in pages stay in the
  window; other links open in the system browser. Media, notifications,
  clipboard writes and fullscreen are granted only to the server origin.
  Injected CSS pads the sidebar 28px for the traffic lights and makes that
  strip a drag region. `window-manager` keeps a reference to the window so
  `findWindowByType('main')` still finds it.
- SSO sign-in (desktop + web): an SSO click in the window
  (`/api/auth/sso/*`) starts the existing PKCE browser handoff. When the
  browser returns `overlay://auth/transfer?token=...`, the window loads
  `/auth/desktop/complete` with the verifier header; the web route
  (`src/app/auth/desktop/complete/route.ts`,
  `src/server/auth/desktop-web-session-policy.ts`, 5 tests) consumes the
  token, sets the session cookie and redirects to `/app`. `desktop-link`
  now carries `emailVerified`.
- `e2e/web-shell.e2e.ts` (desktop, Playwright Electron, throwaway profile,
  against the configured server): signed-out window shows the web sign-in
  dialog with no preload bridge; Google opens the handoff instead of
  navigating; the transfer link is redeemed in the window with a verifier
  whose hash matches the challenge.

Current implementation (companion web and desktop branches):

- Web shell is the default, without injected CSS or the spike flag. The shared
  v1 bridge validates origin, top frame and bounded arguments in main.
- Native settings, dictation/composer capture, panels, activity notifications,
  Agent Host enrollment and updates use the bridge. Sign-out cancels capture and
  closes native work. Chat/notes panels share the main window's cookie partition.
- Duplicate provider/chat/agent/renderer code is removed. A dependency guard and
  macOS CI cover the retained native code, Electron boundary flows and packaging.
- Upgrade exports local transcripts/preferences and preserves recordings,
  knowledge files and journals. Existing native model and panel choices migrate.

Authenticated acceptance has exercised real Google browser sign-in and native
transfer, restart persistence, chat streaming/model selection, file attachment,
an agent reply, and floating-panel message persistence in the main window.
The native bridge now owns the integrations omitted by the original spike.

Current acceptance limitations:

- Paid workspace checkout, billing admission, actual cloud transcription and
  network-denied offline inference from HUD capture passed.
- Agent Host lifecycle acceptance passed with an exact-source CI candidate in
  the isolated QA workspace, including scoped-root approval, online state, stop
  and revoked-credential rejection. Temporary rollout settings were removed.
  Public package publication remains a separate release requirement.
- Signed/notarized CI acceptance passed with clean and legacy profiles: sandbox,
  panels, sign-out, restart cookies and private migration. Physical microphone/
  hotkey and notification-click acceptance remain open. The final notification
  lifetime fix is being checked in CI; binary publication remains frozen.

## Goal

Make the desktop app the real Overlay web app inside an Electron window,
with desktop-only features (hotkeys, transcription, floating panels, the
local Agent Host, native notifications, auto-update) added on top through a
small, typed bridge.

When this is done:

- Every web feature works on desktop the day it ships on web. There is no
  second API client, no second chat pipeline and no second set of pages.
- The desktop repo only contains code a browser cannot run.
- The desktop and web apps look identical, apart from deliberate desktop
  touches such as the title bar and floating panels.

## Non-goals

- Offline use of the full app. If there's no connection, the window shows a
  native "can't reach Overlay" page with a retry button. Local transcription
  keeps working offline because it is native.
- Windows and Linux builds. The design stays portable, but this plan only
  ships macOS (Apple Silicon first, as today).
- Rewriting the web app's UI. Desktop-specific layout changes are small and
  gated on the bridge being present.

## Why

The current desktop app is a second copy of Overlay rather than a client of
it:

- The main process has about 130 files and 38,600 lines. That includes its own
  AI chat and agent pipeline (`services/agent`, `services/ai`,
  `chat-service`, `openrouter-chat-service`, `gateway-provider`), its own
  memory and retrieval stack (`services/memory`, `services/context`) and
  direct model-provider SDKs (`ai`, `@ai-sdk/*`, `@openrouter/*`, `openai`,
  `@anthropic-ai/sdk`, `@composio/core`).
- The renderer has its own pages (29 in `src/renderer/src/pages`), including
  Projects and Memory, which web removed on 2026-09-17.
- Only part of the web API is used (mainly conversations, agents, agent
  environments, workspaces and memory), so features drift. Chats that never
  respond and agent threads that cannot start are symptoms of that drift.
- The sidebar work in overlay-desktop#67/#68 showed what sharing UI package
  by package costs: vendoring, Tailwind sync and theme drift (the
  `tokens.test.mjs` failure). Loading the web app removes that whole class
  of problem.

## Target architecture

```
┌──────────────────────────── Electron main process ────────────────────────────┐
│ window-manager   panel-manager   hotkeys   transcription (Parakeet/WhisperKit)│
│ native-auth      safe-storage    agent-host child   notifications   updater   │
│                     bridge router (validates every call)                      │
└───────────────▲───────────────────────────────────────────────▲───────────────┘
                │ IPC (allow-listed channels, origin-checked)    │
┌───────────────┴───────────────┐               ┌───────────────┴───────────────┐
│ Main window                   │               │ Floating panels               │
│ https://<server>/app          │               │ https://<server>/app/...      │
│ preload: window.overlayDesktop│               │ ?surface=panel                │
└───────────────────────────────┘               └───────────────────────────────┘
        local renderer bundle kept only for: transcription HUD, notification
        toast, offline page, and onboarding permission prompts (mic, accessibility)
```

### Main window

- Loads `<serverOrigin>/app`. `serverOrigin` comes from
  `server-profile-service` (default `https://www.getoverlay.io`; a
  self-hosted server origin when configured).
- Uses a persistent session partition (`persist:overlay`) so cookies survive
  restarts and stay separate from the agent browser and other partitions.
- Keeps `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
  and `webSecurity: true`, as today.
- Title bar: keep `titleBarStyle: 'hidden'` and the traffic lights. When the
  bridge is present, the web shell reserves room for them (see
  [Desktop-aware web shell](#desktop-aware-web-shell)).

### Bridge

- The preload exposes one object, `window.overlayDesktop`, through
  `contextBridge`, only when the top-level page origin exactly matches
  `serverOrigin`. Subframes never get it.
- The main process checks every call again: `event.senderFrame` must be the
  top frame and its URL origin must equal `serverOrigin`. Arguments are
  validated with zod before any work runs. Unknown channels are rejected.
- The bridge is versioned. On startup the web app calls
  `overlayDesktop.handshake()` and gets `{ bridgeVersion, appVersion,
  capabilities: string[] }`. Web code checks a capability before using it,
  so an older desktop build against a newer web deploy degrades gracefully
  instead of breaking.
- The contract lives in this repo as a workspace package,
  `packages/overlay-desktop-bridge` (`@overlay/desktop-bridge`): types, zod
  schemas and a `getDesktopBridge()` helper that returns `null` in a normal
  browser. Desktop vendors it the same way it vendors other `@overlay/*`
  packages, and a test in each repo checks that both copies match.

### Desktop-aware web shell

These are small, gated changes in this repo:

- `useDesktopBridge()` hook in `@overlay/app-core` (or the bridge package).
  `null` means a plain browser, and nothing changes.
- When the bridge is present, the root sets `data-desktop="mac"` on
  `<html>`. CSS uses it to:
  - add top padding to the sidebar header so the traffic lights sit above the
    `BrandLockup` and never overlap it
  - mark the sidebar header and page header as drag regions
    (`-webkit-app-region: drag`, with interactive children set to `no-drag`)
- External links: the bridge exposes `openExternal(url)`. Web code that opens
  new tabs (`target="_blank"`, OAuth connect flows, Stripe checkout) goes
  through a shared helper that uses the bridge when present.
- Settings gains a **Desktop** section, shown only with the bridge, for
  hotkeys, transcription models, panels, the Agent Host and updates. Its
  forms call bridge methods. Settings that matter on both platforms stay in
  Convex.
- A panel layout: routes that support panels render without the sidebar when
  `?surface=panel` is set. The first such routes are chat (`/app/chat`) and
  notes (`/app/notes`).

### Sign-in

Google and other providers block sign-in inside embedded browsers, so SSO
sign-in runs in the system browser and the resulting session is moved into
the window. The desktop main process never holds the window's tokens: WorkOS
refresh tokens rotate on use, so two holders of one session would sign each
other out.

1. Email and password sign-in works inside the window as on web.
2. Clicking an SSO option (a same-origin `/api/auth/sso/*` navigation) is
   intercepted. The desktop starts the existing PKCE browser handoff
   (`native-auth-service`: `/account?desktop_code_challenge=...`).
3. The browser, signed in or after signing in, creates a one-time,
   90-second, PKCE-bound transfer token (`POST /api/auth/desktop-link`) and
   opens `overlay://auth/transfer?token=...`.
4. In web shell mode the desktop does not redeem that token itself. It
   navigates the window to `<serverOrigin>/auth/desktop/complete?token=...`
   with the verifier in the `x-overlay-code-verifier` header. That route
   consumes the token, sets the normal httpOnly session cookie in the
   window's partition and redirects to `/app`. A bare link cannot sign anyone
   in, because only the desktop can attach the verifier to its own window's
   request.
5. Signing out on web clears the cookie as usual. Native features that need
   the user's identity get it from the web app through the bridge (phase 2
   onward) instead of a second stored session.

Everything in the web app (WorkOS session, Convex JWKS verification, billing)
then works exactly as it does in a browser.

### Navigation and permission policy

- `will-navigate` and `setWindowOpenHandler`: same-origin navigation stays in
  the window. Allow-listed auth hosts (WorkOS, SSO providers) are allowed
  only during an active sign-in. Everything else opens in the system browser.
- `session.setPermissionRequestHandler`: microphone, camera, notifications
  and clipboard are granted only to `serverOrigin`. Everything else is
  denied.
- No `allowRunningInsecureContent`. HTTP origins are refused except
  `http://localhost:*` in dev builds.
- The web CSP stays as is. The desktop does not loosen it.

## Inventory: what happens to each desktop module

**Keep (native, moves behind the bridge):**

| Module | Bridge capability |
| --- | --- |
| `hotkey-manager`, `global-keyboard` (uiohook-napi) | `hotkeys` |
| `parakeet-service`, `whisperkit-service`, `model-download-service`, `transcription-request` | `transcription` |
| `panel-manager`, `window-manager` | `panels`, `window` |
| `embedded-host-service`, `embedded-host-config` (local Agent Host) | `agentHost` |
| `notification-ipc` + notification window | `notifications` |
| `auto-updater`, `auto-updater-policy` | `updates` |
| `security/native-auth-service`, `safe-storage-service`, `server-profile-service` | `auth` |
| `context-menu-ipc` | `contextMenu` |
| `chat-media-cache`, screenshot capture in `ai-assistant` | `capture` |
| `sentry` | none (main process only) |

**Decide in phase 3 (native, but maybe not needed):**

| Module | Question |
| --- | --- |
| `agent-browser-service`, `browser-manager`, `browser-chat-session-service` | Does the desktop-controlled browser stay a product feature, or do Overlay Cloud machines replace it? |
| `terminal-service` (node-pty), `runtime-service` | Already disabled by Phase 0 containment. Delete unless the Agent Host needs them. |
| `native-knowledge-files`, `knowledge-files-ipc` | Local folder sync. Keep only if it maps to a web feature (Files). |
| `agent/ax-bridge`, `agent/grounding` | Accessibility and screen grounding for the voice assistant. Keep if the assistant overlay stays. |

**Delete (the web app or server already does this):**

- `services/agent` except the parts above: `chat-agent-v2`,
  `openrouter-agent-service`, `unified-*-agent`, `unified-tools`,
  `composio-service`, `token-usage`, `context-manager`.
- `services/ai`, `chat-service`, `openrouter-chat-service`, `llm-enhancer`,
  `test-llm-enhancer`, `model-pricing`, `key-cache-service`,
  `subscription-service` (web owns billing).
- `services/memory`, `services/context` (server-side memories and search).
- `convex-client.ts` (the web app talks to Convex).
- IPC: `chat-ipc`, `agent-ipc`, `notebook-agent-ipc`, `browser-chat-ipc`,
  `models-ipc`, `memory-ipc`, `knowledge-ipc`, `context-ipc`,
  `document-ipc`, `import-ipc`, `composio-ipc`, `subscription-ipc`,
  `app-api-ipc` and `app-api-security` (replaced by the bridge router).
- Renderer pages that have web equivalents: everything in
  `src/renderer/src/pages` except the transcription HUD, notification and
  onboarding permission screens. That includes the parity fixture windows.
- Vendored packages that only served the native renderer
  (`@overlay/shell-react`, `@overlay/ui`, `@overlay/modules-react`,
  `@overlay/api-client`, `@overlay/tools-core`, `@overlay/llm-gateway` and
  similar), unless the kept local renderer still needs one.
- Dependencies: `ai`, `@ai-sdk/*`, `@openrouter/*`, `openai`,
  `@anthropic-ai/sdk`, `@composio/core`, `convex`, tiptap, and probably
  `keytar` (safeStorage covers it).

## Bridge API v1

All methods return promises, and every event has a matching `off`. Names are
provisional.

| Capability | Methods and events | Used by (web) |
| --- | --- | --- |
| core | `handshake()`, `app.version()`, `app.platform()` | root layout |
| `window` | `openExternal(url)`, `setBadgeCount(n)`, `onFocusChange(cb)` | link helper, unread counts |
| `auth` | `signIn({ force })`, `signedOut()`, `onSessionRefreshed(cb)` | sign-in page, account menu |
| `hotkeys` | `list()`, `set(id, accelerator)`, `reset(id)`, `onTriggered(cb)` | Settings → Desktop |
| `panels` | `show(kind)`, `hide(kind)`, `toggle(kind)`, `setDocked(kind, edge)` | header button, panel routes |
| `transcription` | `status()`, `start(opts)`, `stop()`, `listModels()`, `downloadModel(id)`, `onPartial(cb)`, `onFinal(cb)` | Settings → Desktop, chat composer mic |
| `capture` | `screenshot({ display })` | chat composer camera button |
| `notifications` | `show({ title, body, route })`, `onClick(cb)` | activity feed |
| `agentHost` | `status()`, `start({ adapter, enrollmentCode })`, `stop()`, `logs()`, `onStatus(cb)` | Agents → connected agents, Settings |
| `updates` | `status()`, `check()`, `install()`, `onStatus(cb)` | Settings → Desktop, update banner |
| `contextMenu` | `show(items)` | optional, later |

Rules for adding a method:

1. Add it to the schema in `@overlay/desktop-bridge` with a capability name.
2. Implement and validate it in the desktop bridge router.
3. Write web code that checks the capability before calling it.
4. Add a test on both sides.

## Phases

Each phase ends in a working app and lands on main. The desktop app is not
live yet, so desktop work can land directly on desktop main after checks.
Web changes follow the repo's integration workflow (local owner pushes after
checks, or PR and merge queue).

### Phase 0: spike (desktop, 1–2 days)

State: code landed (`933e842`); flow checks open.


- Behind `OVERLAY_WEB_SHELL=1`, the main window loads `<serverOrigin>/app`
  in `persist:overlay` instead of the local renderer.
- Sign in with email and password inside the window to prove the session
  works. No Google yet; that's phase 1.
- Add the navigation policy and the system-browser fallback for external
  links.
- Temporary title bar fix: inject CSS that pads the sidebar header.

Done when: a chat sends and streams, an agent thread starts and replies,
files upload, the traffic lights clear the logo, and links open in the
system browser. Record which flows break; that list feeds phases 1–3.

### Phase 1: sign-in into the window (web + desktop)

State: code and end-to-end test landed; real Google sign-in open.

- Web: `/auth/desktop/complete` redeems the browser's transfer token into
  the window's cookie, with tests for a missing verifier, malformed or used
  tokens and rate limiting.
- Desktop: SSO clicks start the browser handoff, and the returned token is
  redeemed in the window with the verifier header.

Done when: Google sign-in works end to end from a fresh install, restarts
keep the session, and signing out on web signs the window out.

### Phase 2: bridge contract and desktop-aware shell (web + desktop)

- Create `packages/overlay-desktop-bridge` with the schemas, the
  `getDesktopBridge()` helper and the handshake.
- Desktop: preload exposure guarded by origin, a main-process router with
  zod validation and sender-frame checks, and a deny-by-default permission
  handler.
- Web: `data-desktop`, traffic-light padding and drag regions in the shell,
  the `openExternal` link helper, and an empty Settings → Desktop section.
- Add a new living doc, `internal/develop/desktop-web-shell.md` (bridge
  rules, security posture, how to add a capability), and list it in the
  AGENTS.md table.

Done when: the spike flag is gone, the bridge handshake works, and there is
no injected CSS.

### Phase 3: move native features onto the bridge (one capability per change)

Order, by user value:

1. `transcription`: dictation hotkey, HUD, cloud and local models, and the
   chat composer mic.
2. `hotkeys` and `panels`: the global hotkey opens the chat panel.
3. `notifications` and `window.setBadgeCount`.
4. `agentHost`: start or stop the local Agent Host from Agents and
   Settings.
5. `updates`: the update banner and the Settings controls.
6. `capture`: screenshots into the composer.
7. Decide each "maybe" module from the inventory, and delete the ones not
   kept.

Done when: every kept capability is reachable from the web UI on desktop
and absent (with no errors) in a normal browser.

### Phase 4: floating panels on web routes (web + desktop)

- Web: a `?surface=panel` layout for `/app/chat` and `/app/notes`: no
  sidebar, compact header, transparent-friendly background tokens.
- Desktop: panel windows load those routes in the same partition. Keep the
  existing docking, click-through and focus-yield behavior in
  `panel-manager`.

Done when: the chat panel opens over other apps with a hotkey, sends a
message, and the conversation appears in the main window's chat list.

### Phase 5: delete the duplicate app (desktop)

- Remove everything in the Delete list, the local renderer pages and the
  unused vendored packages and dependencies.
- Add a guard check (`check:no-provider-sdks`) that fails if a model-provider
  SDK or `convex` comes back into `package.json` or `src/main`.
- Update the desktop README and security docs.

Done when: `src/main` holds only kept modules, the dependency count drops
sharply, and `verify` passes.

### Phase 6: release readiness (desktop)

- Local data migration. List what the current app stores only locally
  (settings, recordings and transcripts, knowledge migration state, panel
  layout). Migrate what matters to Convex or to the kept native stores, and
  drop the rest with a one-time notice.
- Signed and notarized build, auto-update channel, crash reporting.
- Full QA checklist (below) on a clean Mac and on a Mac with the old app
  installed.

## QA checklist (per release)

- Fresh install: open the app, sign in with Google, land on `/app/work`, and
  restart. You should still be signed in.
- Chat: send a message, watch it stream, switch models, attach a file, and
  start an agent thread.
- External links (integration connect, billing) open in the system browser.
  Returning to the app reflects the change.
- Title bar: the traffic lights never overlap the logo, the window drags from
  the header, and buttons in the header still click.
- Dictation hotkey: speak, the text is inserted, and the HUD shows and hides.
  Try cloud and local models, with the network off for local.
- Chat panel: the hotkey opens it over another app, a message sends, and it
  appears in the main window.
- Agent Host: start it from Settings, see it online in Agents, and stop it.
- Notifications: an agent reply while the app is hidden shows a native
  notification, and clicking it opens the right route.
- Offline: turn off the network and the offline page shows. Turn it back on,
  click retry, and the app loads.
- Sign out on web: the native session is cleared too, and the app shows
  sign-in.
- In a normal browser: no `window.overlayDesktop`, no Desktop settings
  section, and no console errors.

## Risks

| Risk | Mitigation |
| --- | --- |
| Remote content plus a preload is a privileged surface. | Exact-origin checks in preload and main, top-frame only, zod on every call, deny-by-default permissions, no Node in the renderer, navigation lock. Security review before phase 2 lands. |
| Web deploys can break desktop. | Versioned bridge with capability checks. Desktop-aware code paths are covered by web tests with a mocked bridge. A desktop smoke run against preview URLs comes later. |
| Version skew (old desktop, new web). | Capabilities, not version numbers, decide behavior. Bridge methods are only added or deprecated, never changed in place, within v1. |
| Embedded sign-in is blocked by providers. | Sign-in always goes through the system browser (phase 1). |
| Panels need transparent backgrounds that the web app doesn't have. | The panel layout uses its own background tokens. The native window keeps the shadow and the rounded mask. |
| Startup feels slower than a local bundle. | Show a native splash until first paint, keep the partition cache, and preload panel windows (already done today). |
| Losing local-only data from the current app. | Phase 6 inventory and migration before the first public release. |

## Decisions for the web-shell migration

1. Retire the duplicate desktop-controlled browser and independent voice-agent
   pipeline. Web Computer/Agents own those workflows; native dictation and screen
   capture remain available to the web composer.
2. Open `/app/work` at startup. Panel windows open their shared chat/notes routes.
3. Keep self-hosted origin selection in the existing verified server-profile
   configuration; do not expose an arbitrary remote origin picker through v1.
4. Preserve local knowledge data for import rather than uploading it implicitly.
   Keep the release gates open until the real upgrade profile is accepted.
