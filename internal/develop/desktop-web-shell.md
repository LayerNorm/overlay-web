# Desktop web shell

The macOS desktop loads the current server's `/app/work` in an Electron window.
Web owns routes, chat/agent execution, uploads, billing and authentication. Native
code owns only OS integrations. There is no desktop chat pipeline or provider SDK.

## Contract and trust boundary

`packages/overlay-desktop-bridge` defines v1 schemas, result/event types,
`getDesktopBridge()` and `openExternal()`. Desktop vendors that package; keep both
copies byte-for-byte synchronized. The package's fingerprint check detects local
schema drift. App-shell runtime callers load the package through
`src/components/desktop/desktop-bridge-loader.ts`, which imports it when
`window.overlayDesktop` exists, so ordinary browser shell traffic does not load
the shell's bridge contract or zod schemas. This guarantee covers app-shell
imports, not route-specific settings code; type-only imports are fine anywhere.
To add a method, define its input schema and typed result, implement it in the
native router, gate callers on its advertised capability, and test both sides.
Additive v1 methods must preserve existing method semantics.

Only the pinned server origin's top frame receives `window.overlayDesktop`.
Main checks both the registered WebContents and the sender frame on every call,
rejects unknown methods/extra arguments, validates inputs and bounds concurrent
calls. Remote windows have sandbox/context isolation/web security enabled, no Node
integration, a dedicated preload and the shared `persist:overlay` cookie partition.
The preload builds as one self-contained sandbox-compatible bundle. Web and
recorder entry modules keep separate origin gates; a window carrying the remote
origin argument never receives the private file-recorder API, including offline fallback.
Default-session native pages have no remote bridge. Permission checks deny unknown
origins, frames and permissions. External URLs allow HTTP(S)/mailto only. Same-origin
SSO navigations use the PKCE browser handoff; no third-party auth host loads in a
privileged desktop window. No CSP relaxation or injected layout CSS is needed.

## Authentication and native features

The web window owns its normal httpOnly cookie session. Main redeems transfer links
by attaching the pending PKCE verifier to `/auth/desktop/complete`; it neither stores
nor refreshes a second WorkOS session. Old encrypted native credentials are cleared
on upgrade. Native server calls use the window partition's authenticated fetch. Account sign-out
and session loss notify native cleanup through AuthContext too, so leaving the
workspace shell cannot keep a host or microphone active.
The sidebar's direct sign-out action also awaits the bounded native cleanup
before deleting its web session and navigating away.
Agent Host starts and online panels verify the actual server session; sign-out
stops the host, closes panels, cancels dictation (including microphone tracks and stale paste results) and clears the badge.
Signed out, the main window shows the desktop home at `/auth/desktop`, never the
website: sign-out navigates there when `window.overlayDesktop` exists, `DesktopProvider`
sends a signed-out main window there instead of the guest app (panels stay), and the
proxy redirects a signed-out `/w/…` request from the app's user agent
(`Overlay/<v> … Electron/<v>`) there instead of to `/auth/sign-in`. The user agent only
picks the page; it grants nothing. The home is the loading screen's wordmark and line
with **Sign in** (and "Create an account"), both calling `auth.signIn`, which opens the
browser handoff; it shows a waiting state with "Open browser again" until the transfer
link replaces the page. Opened in a plain browser, or by an app without the `auth`
capability, it goes to `/auth/sign-in`; with a live session it opens `/app`.
The app shell publishes its background as `<meta name="theme-color">` (normalized
to `#rrggbb`). The desktop main window listens for `did-change-theme-color` and sets
`nativeTheme.themeSource` to light or dark from it, so the window frame follows the
app theme rather than the macOS appearance; without the tag it falls back to system.

`DesktopProvider` negotiates the handshake and marks the root `data-desktop`.
Regular browsers do not receive Desktop settings. Composers are identical on web and
desktop: there is no composer microphone or screenshot button; desktop dictation runs
through the global shortcut and recorder HUD.
Titlebar CSS reserves traffic-light space and makes interactive header children
non-draggable. Chat and notes support `?surface=panel` only with the bridge;
the compact surface keeps app providers and authorization boundaries. The optional
handshake `surface` comes from native window registration and survives chat URL
replacement or reload; the query flag remains an older-client fallback. Native panel
bounds leave other apps clickable outside the panel, and close/toggle actions use
the retained focus-yield helper. Transparent corners and display-change clamping
are native window behavior; no full-screen renderer mask is needed.

Settings → Desktop (Lucide `Laptop` in the settings sidebar) groups its controls into Dictation,
Local models, Floating panels, This computer and About sections, matching the Shortcuts page layout.
This computer (bridge capability `localComputer`, macOS only for now) lets agent threads run on the computer
the app is open on; `internal/develop/thread-folders.md` has the product rules. Connecting takes no code: the web
app creates an enrollment, starts the embedded host with `agentHost.start({localTools: true})` and no harness,
matches the phrase the host printed (`localComputer.status`) to its pending enrollment and approves it for the
work folder `~/Overlay Files`, which the app creates. `localComputer.status` also reports the computer's own
name, the environment it connected as (read from the host's `config.json`) and the work folder, so the web app
knows which threads are this computer's. `localComputer.chooseFolder` opens the system's folder dialog and
returns the chosen path; the web app adds it to the computer's approved folders. The same code
(`src/components/desktop/this-computer.ts`) serves the thread controls and the Settings section.
`localComputer.requestPermission` shows the macOS prompt and opens the Screen Recording or Accessibility pane;
the host's access is this app's permission. The switch (`localComputer.setKeepAvailable`) restarts the saved
local-tools host from its `config.json` at launch once the session is verified; sign-out turns it off and stops
the host. Unpackaged builds may set `OVERLAY_DESKTOP_DEV_HOST_PACKAGE` to a packed host tarball for QA; packaged
builds always use the pin.
Private threads (bridge capability `localThreads`, macOS only for now) run a thread's agent on this computer with
the person's own model keys: the app starts the bundled host as `overlay-agent-host private` over Node.js IPC, keeps
the keys in the keychain and relays the reply stream as `localThreads.chunk` events. Settings → Desktop gains a Model
keys section. `internal/develop/private-threads.md` has the contract and rules.
First-run setup (bridge capability `localSetup`, macOS only for now) runs before the onboarding conversation for a
new account: the server sets `desktopSetup` on `GET /api/v1/onboarding/session` when setup has not started and the
person's only workspace is their own personal one. `DesktopOnboarding` (`src/app/_components/onboarding/desktop/`)
shows who the workspace is for, about you, what other AI tools bring, model keys, this computer and a plan, keeps its
progress in this computer's local storage, and starts the conversation with `{ action: 'start', prefill }`.
`localSetup.scan` lists Claude Code, Codex, Claude Desktop, Cursor and Gemini CLI instructions, skills, subagents and
MCP servers by name, plus model keys in the login shell (variable and last four characters) and plan sign-ins.
`localSetup.import` reads the ticked items again in the main process and adds them through Overlay's own API with the
app's session (memories, personal skills, creator-only agents, personal MCP servers); contents, header tokens and keys
never reach the page. `localSetup.useShellKey` checks a shell key and keeps it in the keychain. Local (command) MCP
servers are listed but not imported. Each import request's idempotency key is a hash of what it sends, so retries never
duplicate and an edited file imports again. Unpackaged builds may set `OVERLAY_DESKTOP_DEV_SETUP_HOME` to scan a fixture
folder for QA. Desktop `src/main/services/local-setup*.ts`;
`internal/plans/DESKTOP_ONBOARDING_PLAN.md` has the plan.
Each shortcut shows as key caps inside the feature it opens (dictation, chat, notes); click it, then
press a new combination (Escape cancels). Panels open from one button with docking in a row menu.
The Agent host row shows its state and keeps the harness, connection code and Start controls in the
same row, with the log behind Show log. The model picker lists only downloaded local models. Visible dictation settings refresh device
choices with capture status and on focus, so connected inputs and disconnected
preferences update without reopening settings. Shared audio-context cleanup is
owned by the current take; cancellation settles pending flushes and stale work
cannot suspend a newer recording. Agent enrollment starts the local host from
the existing Agents connection flow. Notifications use the existing activity feed;
desktop keeps its subscription active while hidden and applies the native badge.
Default dictation is Control+Space (tap to toggle, hold to talk); saved custom
shortcuts remain per-device. Notification delivery reports native permission
failures through the bridge. macOS notification acceptance must use the signed
Overlay bundle, since development Electron has a separate notification identity.
Desktop settings includes a test-notification action and surfaces its permission
error so a missing macOS alert is diagnosable. Native retains up to 50 delivered
notification objects until interaction, closes them on sign-out/quit and restores
a minimized main window before click routing.

Local transcription runs without a network connection. Cloud transcription uses
the web transcription API and the same plan/budget checks. Native code maps the API's refusal codes (paid plan, allowance, `workspace_billing_required`, `workspace_wallet_forbidden`, `insufficient_budget`) to actionable messages in `cloud-dictation-errors.ts` and keeps the bare status only for unknown failures. The dictation shortcut keeps the existing tap-to-toggle / hold-to-talk manager
and recovers after sleep/unlock. The local HUD captures audio; main validates bounded audio bytes, invokes a pinned native model helper or
the cookie-authenticated cloud endpoint, then pastes into the prior app. Screen and
microphone permissions remain OS-controlled. Downloaded updates install only after
an explicit restart action and stable increasing-version validation.

## Local data and feature decisions

The first web-shell launch exports the old file-origin transcripts and allowed
native preferences to a private local folder, retains recordings, knowledge files
and migration journals, and presents a one-time notice. Native preferences and
chat/notes panel geometry migrate to the kept stores. No local content is uploaded
or deleted implicitly. Desktop settings opens the preserved-data folder.

The duplicate desktop-controlled browser, local terminal/runtime, local knowledge
sync and independent voice-agent pipeline are retired. Web Files, connected Agent
Hosts and cloud Computer surfaces own those product flows. Dictation remains native;
voice commands can be entered into the web agent composer. Old browser bookmarks,
chat-tab state and assistant preferences remain in the old store but are unused.
Self-hosted origin selection remains through the verified server-profile config;
startup opens Work. No new arbitrary-origin picker is exposed remotely.
Register the main window's visibility listener before starting navigation so a
fast initial render cannot leave the launched app hidden.

## Verification and release

The chat/files/knowledge CI boundaries retain canonical web renderer checks and
share a native-shell guard: duplicate desktop renderers/provider clients remain
retired and both bridge copies must match the canonical source and fingerprint.

Run bridge package tests, web type/lint checks and desktop `npm test`, `npm run
build`, `npm run check:no-provider-sdks`, and `npm run test:e2e`. Electron Playwright
uses throwaway profiles. The macOS clean-clone CI runs the Electron boundary
fixture and unsigned packaging; heavy compilation and exhaustive tests belong in
CI when laptop responsiveness is a concern. Run local checks sequentially. Its boundary fixture tests the actual sandboxed preload,
invalid calls, frame/origin isolation, shared panel cookies and sign-out cleanup.
The configured-server test exercises signed-out web rendering and the PKCE handoff;
it does not substitute for real-provider sign-in.

Acceptance also requires rendered web/desktop QA of chat streaming, agents, file
attachments, compact panels and titlebar interaction; real browser Google sign-in,
restart persistence, local/cloud dictation, notifications, Agent Host start/stop,
offline retry and an upgrade profile. Run a signed/notarized artifact on a clean Mac
and an existing install before binary publication. Desktop's existing release gates,
protected environments and publish freeze stay in force until their recorded
acceptance is complete. A successful source build is not signed-release acceptance.

Protected Preview hosting-auth files and the CLI `--hosting-auth-file` option were
specific to the retired managed-runtime launcher. Do not create or distribute them.
Agent Host connects only with its user-owned enrollment credential and signed requests.

Release builds embed only the configured public crash-reporting DSN. The native
crash-reporting toggle is opt-in, stored per device and checked again before each
event is sent; diagnostics controls are omitted when the build has no DSN.

Signing CI uses an ephemeral keychain with a random password distinct from the
certificate password and removes both its certificate file and keychain. Account
handoffs must never log their one-time transfer links.

Agent smoke acceptance covers the web-owned execution path too. When admission
falls back from a configured model, the native harness candidate chain must begin
with that admitted model and exclude candidates already rejected by admission.

The desktop clean-clone workflow also tests a real throwaway legacy file-origin
profile. Its opt-in `local_transcription` dispatch synthesizes speech and exercises
a downloaded pinned local model through the real Electron bridge on the macOS
runner, avoiding local model downloads/inference during laptop-sensitive QA.
For an unpublished Agent Host, dispatch BYO Agent Host compatibility with
`candidate_artifacts=true`. CI install-smokes and packs the exact source revision;
use that candidate only in an isolated QA profile/workspace and record its SHA.
This verifies the native lifecycle before package publication without changing
the production rollout or the public package pin.

Native cloud dictation forwards the trusted calling frame’s workspace route as
its Referer; hotkey dictation uses the main window route. Web billing admission
remains authoritative, including membership, paid-plan and workspace-credit checks.
Hosted Preview cloud transcription uses its own non-expiring Groq credential in
Preview-only secret settings. Production credentials must not be copied into
Preview; rebuild the current Preview after adding or replacing its provider key.
Whisper downloads include pinned tokenizer files; older downloads can repair the
missing offline dependencies without replacing model weights.
The recorder HUD keeps its state in a private script scope so it cannot collide
with the non-configurable preload bridge. CI captures synthetic audio through the
actual HUD, in addition to testing direct transcription and downloaded models.
The bridge's `transcription.transcribe` and `capture.screenshot` methods (and the
preload WebM/MP4 decode) no longer have a web caller; the native HUD captures PCM directly.
The HUD carries a native capture epoch through decoding and transcription so
sign-out/cancel rejects late audio and never clears a newer recording's state.

Agent reply acceptance includes answer-only milestones. Their empty evidence-tool
arrays are normalized to omission before persistence; action milestones retain
the required execution-evidence checks.

Desktop settings subscribes to native host/update events and
rejects older status reads that arrive after an event.

Reply notifications capture their workspace and chat view when a stream starts.
Scope is retained from canonical chat paths even without a view query.
First replies wait for the persisted conversation ID; temporary replies do not
produce saved-chat links. A later workspace switch cannot retarget a notification.

### Dictation capture and delivery

The isolated HUD initializes the 16 kHz AudioWorklet thread at launch using a
silent output sink, then suspends the graph without opening a microphone. A native shortcut starts device acquisition immediately;
cloud session admission runs independently and must pass before any upload. A
failed admission stops and discards capture immediately.
The AudioWorklet batches mono PCM every 256 samples and flushes a bounded WAV at
release, avoiding a whole-recording decode. Groq still transcribes completed
recordings; this path does not claim streaming recognition. Local helpers and
cloud requests accept cancellation, with session epochs fencing late delivery.

The bottom-centered, non-focusable capsule renders nine audio-driven bars with
fast attack and slower release, reduced-motion support and explicit finish,
dismiss, retry and copy controls. Automatic device selection prefers the built-in
microphone when labels are available; disconnected selections fall back to the
system default. Settings persists device IDs locally and refreshes status while
visible. `firstAudioMs` measures HUD-start to first captured PCM, not shortcut
latency or provider inference; use physical-device QA for the full latency path.

Delivery checks the original frontmost application PID before paste. A changed
or unknown destination, unsupported clipboard format or failed injection retains
the result for explicit copy. The PID guard cannot detect movement between fields
inside one app. Supported clipboard content is restored after insertion unless
the user has copied something else. No speech or result history is persisted:
retry audio and results are memory-only, bounded to 25 MiB, cleared on a new take,
sign-out/dismiss/quit, and expire after 60 seconds. Retry requires an explicit
click and can incur another cloud transcription charge.

The bundled Whisper helper and upstream revision are pinned in
`native-artifacts.json`. Keep its build script, notices and artifact digest
synchronized. Run actual offline transcription in the clean-clone CI job with
isolated app data and model/tokenizer integrity verification. Its opt-in model
lane uses macOS 26; ordinary checks retain macOS 15. When runner behavior differs,
verify actual words on a physical Mac with helper networking denied rather than
treating a successful process exit as recognition acceptance. Native transcription
normalizes provider padding before delivery while preserving internal formatting.
