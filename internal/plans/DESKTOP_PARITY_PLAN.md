# Desktop parity plan

Goal: Overlay Desktop does everything the web app does on the cloud, plus the native things only a Mac can do, and the voice agent becomes the workspace's real Overlay agent: personalized, tool-using, and able to act on the Mac.

Mockup: [`mockups/desktop-parity-mockup.html`](mockups/desktop-parity-mockup.html) (every surface, home to settings subpages, plus the voice pill states).

Audited: `LayerNorm/overlay-web` at `46b47678f`, `LayerNorm/overlay-desktop` at `d5bedcd` (same as the web submodule pin).

## 1. Audit summary

### 1.1 What already bridges well

- Desktop cloud chat goes through the web server: `POST /api/v1/conversations/act` (`renderer/src/services/cloud-chat-service.ts`). Models, billing, policy and usage stay server-authoritative.
- Auth handoff (`/api/auth/native/{authorize,token,refresh,subscription}`), workspaces (`/api/v1/workspaces`, `/workspaces/active`), agents and bindings, agent environments (enroll, approve, roots, revoke), files, notes, memory, skills, MCPs, integrations, automations, transcription and media generation all call `/api/v1`.
- Shared UI is vendored: `@overlay/{api-client, app-core, auth-contracts, billing, chat-core, chat-react, llm-gateway, modules-react, storage-contracts, tools-core, ui}`, guarded by `ensure-shared-*` scripts.
- "Run on this Mac" already spawns the pinned `@layernorm/overlay-agent-host` (`main/services/embedded-host-service.ts`) and enrolls the Mac as an agent environment.
- Native layer is strong: global hotkeys (transcription, push-to-talk, agent, chat/notes/browser panels), warm mic, local Parakeet/WhisperKit, smart transcription modes, dictionary and phrase replacements, AX helper, selected-text and screenshot context, floating pill, panel windows, built-in browser, Ask for approval / Full access host policy.

### 1.2 The core gap: two different agents

| | Web Overlay agent | Desktop voice agent |
| --- | --- | --- |
| Where it runs | Server (`ActTurnOrchestrationService`, agent runs) | Electron main (`main/services/agent/unified-voice-agent.ts`) |
| Identity | Workspace default agent (`WorkspaceAgentService.ensureDefaultAgent`, `isDefault`) | Hard-coded prompt "You are Overlay, a precise macOS AI agent" |
| Model | Workspace model policy, free router, subscriptions | `anthropic/claude-haiku-4-5` default |
| Credentials | Server-held | `AI_GATEWAY_API_KEY` from the local env only (`key-cache-service.ts`), so hosted users have no key and the agent cannot run |
| Memory / profile | Workspace + Personal memories, profile, instructions | Local memory extractor, not the agent's |
| Tools | Tool groups (memory, knowledge, files, web, integrations, MCP, notes, skills, automations, tasks, image, video, computer, agents) | Composio direct + local AX/browser/notebook tools |
| History | Agent thread, visible everywhere | Pill summary only |
| Local Mac access | None. `act/instructions.ts` tells the model it has no OS control, terminal or filesystem | Full (with approval policy) |

There are also parallel local stacks (`chat-agent-v2`, `unified-browser-agent`, `unified-notebook-agent`, `openrouter-*`) that duplicate server behavior and bypass server metering.

### 1.3 Surface gaps

| Area | Web | Desktop today | Gap |
| --- | --- | --- | --- |
| Navigation | Work, Agents, Chats, Files, Extensions, Automations | Home, Projects, Chats, Agents, Files, Extensions, Automations, Voice, Browser | No Work; Projects still present (removed on web) |
| Shell | shadcn Sidebar, workspace switcher, breadcrumbs, right sidebar | Custom inline-styled rail, serif labels | Rebuild on the shared shell |
| Agents | Threads, right sidebar (Details, Library, Computer), Reachable on (Slack), agent asks | Directory, read-only detail, editor | Threads, right sidebar, surfaces, asks |
| Chats | Personal, DMs, Channels, Activity, archive, share, search, saved | Same subviews (SUBNAV 3) | Share, search, saved, channel management |
| Work | List, board, timeline, peek | None | Whole page |
| Account | `/app/account`: identity, workspaces, delete | Account dialog | Account page |
| Onboarding | Conversational, Overlay agent, real shell | 18-step slideshow | Replace; keep Mac permission steps inline |
| Settings | General, Profile, Workspace, Customization, Shortcuts, Memories, Providers, Webhooks, Environments, Agents, Connected apps, Computers, Archived, Contact | general, shortcuts, transcription, agent, memories, output, models, chat, notes, browser, workspace, account | Missing 10 web sections; desktop-only ones need a home |
| Billing | Usage meters, upgrade, top-ups | Usage in account | Shared billing panels |

### 1.4 Shared package drift

Files that differ between desktop's vendored copy and web `packages/*/src`: `chat-react` 78, `modules-react` 60, `ui` 52 (desktop has 34 files, web 100), `app-core` 44, `api-client` 34, `chat-core` 24. Not vendored at all: `agent-runtime`, `agent-host`, `agent-bridge-protocol`, `authz-contracts`, `workspace-contracts`, `extension-sdk`, `sandbox-runtime`.

### 1.5 Web APIs desktop does not call yet

`work`, `onboarding`, `surfaces`, `computers`, `providers` / `provider-accounts`, `subscription`, `webhooks`, `agent-asks`, `agent-profiles`, `shares`, `search`, `mention-search`, `model-catalog`, `workspace-invitations`, `chat-suggestions`, `extensions`, `account`, `api-keys`, `imports`, and conversation `channels`, `direct-messages`, `events`, `run`, `stop`, `saved-messages`, `search`, `agent-greeting`.

## 2. Target architecture

**One agent, many surfaces.** The voice agent is the workspace's default Overlay agent. Desktop becomes (a) a client of the same pages and (b) a surface plus a local computer for that agent.

```
 voice / hotkey / pill / panels
            |
     Overlay Desktop (Electron)
   |                        |
 /api/v1 (pages, threads)   Mac Host (Agent Host + desktop tools)
   |                        ^
 Overlay server: agent loop, memory, billing, policy
   |
 tool call "computer.*" routed to: Boat (cloud) | E2B (self-host) | This Mac
```

- **Agent loop stays on the server.** Voice turns post to the Overlay agent thread with `surface: "desktop"` and a context envelope (front app, window title, selected text, optional screenshot, clipboard on request). Same models, memories, tools, billing and history as web.
- **The Mac is a computer.** Product already unifies terminal + browser + desktop as "computer" (Boat cloud, E2B self-host). Add **This Mac** as a third computer target, served by the embedded Agent Host over the existing bridge protocol. Server-emitted `computer.*` calls (screen, click/type via AX, apps, files, terminal, local browser) execute locally under Ask for approval / Full access. No new tool vocabulary, no Mac-only model tools.
- **Desktop renders the same pages from shared packages.** Every page in the mockup is a shared `@overlay/modules-react` / `@overlay/chat-react` surface with a thin desktop host adapter, not a fork. Native-only pages (Voice, Mac permissions, pill, local models) are desktop modules registered through `app-core` settings/navigation registries.
- **Retire local agent stacks** once the server path covers them. Keep only on-device transcription and context capture local.

## 3. Personalization and agentification

1. **Voice profile.** Per user: wake word, push-to-talk, voice replies on/off and voice, dictionary, phrase replacements, smart modes. Synced through `/api/v1/settings` so it follows the user to a new Mac.
2. **Context awareness.** Each voice turn carries front app, selection and (opt-in) screenshot. Per-app rules: "In Mail, draft replies in my tone", "Never read 1Password".
3. **Memory everywhere.** Voice turns write and read the same Personal and Workspace memories as web (Settings, Memories). Dictation corrections become dictionary entries.
4. **Agent instructions.** The default Overlay agent's instructions, model and tools (right sidebar Details) apply to voice too. Users can pick which agent the hotkey talks to.
5. **Proactive.** Automations can target the desktop surface: notification, pill prompt, or a spoken briefing ("Morning brief at 9").
6. **Approvals that feel native.** Agent asks and computer approvals appear in the pill and as macOS notifications, approvable by voice ("yes, send it").
7. **Hand-off.** A voice command can continue in the main window (same thread), in a panel, or on the web and mobile.

## 4. Phased plan

Effort is in Devin sessions (about one human-week each). Numbers are stable so items can be referenced.

### Phase 0: Foundations (2 to 3 sessions)

- **#1 Decide the shared-code strategy.** Recommendation: move desktop into the overlay-web monorepo as `apps/desktop` (keeps the public export flow), removing vendoring drift for good. Fallback: automated vendor sync on every web release with the `--check` gate in CI.
- **#2 Resync vendored packages** to web HEAD and add the missing ones (`agent-bridge-protocol`, `agent-host`, `authz-contracts`, `workspace-contracts`, `extension-sdk`).
- **#3 Desktop API client parity.** Generate the desktop route allowlist (`app-api-security.ts`) from `@overlay/api-client` so new web endpoints are reachable without hand edits.
- **#4 Capability discovery.** Desktop reads `/api/v1/bootstrap` + `/api/v1/capabilities` and gates navigation and settings with the same `app-core` feature flags as web.

### Phase 1: Shell and pages (4 to 6 sessions)

- **#5 Shared shell.** Replace `MainWindow` chrome with the shadcn Sidebar from `@overlay/ui` (workspace switcher, navigation from `DEFAULT_OVERLAY_NAVIGATION`, breadcrumbs, right sidebar). macOS title bar with traffic lights, collapsible sidebar.
- **#6 Home.** The Overlay agent's main thread with a voice-first composer (see mockup).
- **#7 Work** page (list, board, timeline, peek) from shared modules.
- **#8 Agents** parity: threads, right sidebar (Details, Library, Computer), Reachable on, agent asks, new agent dialog with free-workspace model rules.
- **#9 Chats** parity: share, search, saved messages, channel management, notifications.
- **#10 Files, Extensions, Automations** on shared modules (drop desktop forks).
- **#11 Remove Projects** from desktop, preserving historical data.
- **#12 Account page** with identity and workspaces (replaces the account dialog).
- **#13 Settings registry.** Render web sections from `DEFAULT_OVERLAY_SETTINGS_SECTIONS` and add a desktop group: Voice, Overlay pill, Mac permissions, Local models, Browser, Updates. Fold `output`, `chat`, `notes`, `models` tabs into Voice, Customization and Providers.
- **#14 Conversational onboarding** using `/api/v1/onboarding`, with Mac permission and hotkey steps asked by the agent in the same chat.

### Phase 2: One Overlay agent (4 to 5 sessions)

- **#15 Desktop surface.** Server: add `desktop` to agent surfaces; voice turns post to the agent thread with a typed context envelope (`@overlay/agent-bridge-protocol`). Metered and policy-checked like web.
- **#16 Voice pipeline.** Hotkey, transcribe locally (fallback `/api/v1/transcribe`), stream the agent reply into the pill; optional spoken reply (server TTS, metered).
- **#17 Pill v2.** States: listening, thinking, answer card, approval, error. Expand to the thread with one click.
- **#18 Agent picker for the hotkey** (default Overlay agent).
- **#19 Retire local agent stacks** (`unified-voice-agent`, `chat-agent-v2`, `openrouter-*` paths) after #15 to #17 ship. Keep BYOK only as a server-side provider connection.

### Phase 3: The Mac as a computer (4 to 6 sessions)

- **#20 This Mac computer target.** Extend Agent Host with desktop capabilities (screen read, AX actions, app control, files under approved roots, terminal, local browser). Register as a computer in Settings, Computers.
- **#21 Route `computer.*` calls** to This Mac when the run originates from desktop or the user picks it; otherwise Boat/E2B. Update `act/instructions.ts` so the model knows when local control is available.
- **#22 Approvals.** Ask for approval / Full access stay main-process owned; approvals surface in the pill, notifications and agent asks, with per-app allow rules.
- **#23 Computer tab** in the right sidebar streams This Mac activity the same way it streams cloud computers.

### Phase 4: Personalization (3 to 4 sessions)

- **#24 Synced voice profile** (dictionary, replacements, modes, wake word) via settings API.
- **#25 Context rules per app** and privacy list (never capture).
- **#26 Desktop-targeted automations** (notify, pill prompt, spoken brief).
- **#27 Memory from voice** (corrections, preferences) into Personal memories with the existing save protocol.

### Phase 5: Release (2 sessions plus owner steps)

- **#28 macOS E2E suite** on macOS child sessions: sign-in, voice turn, approval, This Mac computer call, workspace switch.
- **#29 Gate B** signed build and downloads (owner steps in `overlay-desktop/docs/GATE_B_BINARY_RELEASE_CHECKLIST.md`).

Total: roughly 19 to 26 sessions, parallelizable to about 3 to 4 calendar weeks with phases 1 and 2 running side by side.

## 5. Decisions needed

1. **#1 monorepo vs vendored packages.** Recommendation: monorepo.
2. **Spoken replies** in v1, or text in the pill only first.
3. **This Mac for free workspaces.** Cloud computers are paid only; a local computer costs nothing to host. Recommendation: allow This Mac on free, metered tokens only.
4. **Wake word** (always listening) in v1, or hotkey only.

## 6. Risks

- Local control is unsandboxed under Full access; keep it main-process owned and per-app scoped (Gate A security review still open).
- Latency: server round trip on voice. Mitigate with streaming, warm mic, and on-device transcription.
- Vendoring drift reappears unless #1 lands first.
