# Desktop web shell

The macOS desktop loads the current server's `/app/work` in an Electron window.
Web owns routes, chat/agent execution, uploads, billing and authentication. Native
code owns only OS integrations. There is no desktop chat pipeline or provider SDK.

## Contract and trust boundary

`packages/overlay-desktop-bridge` defines v1 schemas, result/event types,
`getDesktopBridge()` and `openExternal()`. Desktop vendors that package; keep both
copies byte-for-byte synchronized. The package's fingerprint check detects local
schema drift. To add a method, define its input schema and typed result, implement
it in the native router, gate callers on its advertised capability, and test both
sides. Additive v1 methods must preserve existing method semantics.

Only the pinned server origin's top frame receives `window.overlayDesktop`.
Main checks both the registered WebContents and the sender frame on every call,
rejects unknown methods/extra arguments, validates inputs and bounds concurrent
calls. Remote windows have sandbox/context isolation/web security enabled, no Node
integration, a dedicated preload and the shared `persist:overlay` cookie partition.
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
Agent Host starts and online panels verify the actual server session; sign-out
stops the host, closes panels, cancels dictation (including microphone tracks and stale paste results) and clears the badge.

`DesktopProvider` negotiates the handshake and marks the root `data-desktop`.
Regular browsers receive neither Desktop settings nor native composer controls.
Titlebar CSS reserves traffic-light space and makes interactive header children
non-draggable. Chat and notes support `?surface=panel` only with the bridge;
the compact surface keeps app providers and authorization boundaries. Native panel
bounds leave other apps clickable outside the panel, and close/toggle actions use
the retained focus-yield helper. Transparent corners and display-change clamping
are native window behavior; no full-screen renderer mask is needed.

Settings → Desktop exposes model downloads, dictation preferences, recorded key combinations,
panels, Agent Host controls and updates. Composer controls use native local/cloud
dictation and screenshot attachments. Agent enrollment starts the local host from
the existing Agents connection flow. Notifications use the existing activity feed;
desktop keeps its subscription active while hidden and applies the native badge.

Local transcription runs without a network connection. Cloud transcription uses
the web transcription API and the same plan/budget checks. The dictation shortcut keeps the existing tap-to-toggle / hold-to-talk manager
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

For protected Preview QA, discovery uses the web partition's hosting cookie.
Native Agent Host QA can receive `OVERLAY_DESKTOP_HOSTING_AUTH_FILE`, pointing to a
fresh private bootstrap file for the existing CLI `--hosting-auth-file` option.
The CLI verifies owner-only permissions and exact server origin, consumes the file
before networking and keeps hosting access out of provider environments. Provision
it from existing project access; never create a per-feature key or commit the file.

Release builds embed only the configured public crash-reporting DSN. The native
crash-reporting toggle is opt-in, stored per device and checked again before each
event is sent; diagnostics controls are omitted when the build has no DSN.
