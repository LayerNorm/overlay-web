# Chrome extension: full parity, and a browser agents can use

Status: Proposed (2026-11-27). Waiting for owner approval of this plan and its mockup; no production code written.

Mockup: `internal/plans/mockups/chrome-extension.html` (Chrome window, page consent bar, controlled-tab
pill, and the real app at side-panel width from `chrome-extension-app.html`, feature `chrome-extension`).

## Goal

1. The Chrome extension's side panel is Overlay: the same chats, agents, threads, model selector, files and
   sign-in as web and desktop, and it stays that way without a second UI to maintain.
2. An agent run started anywhere (web, desktop, mobile, the side panel) can use the person's own Chrome, in
   their signed-in profile, with per-site consent, a visible "agent is using this tab" state, a stop control,
   and no credential or payment entry.

## Where the extension is today

`apps/chrome` (≈9k lines) is a separate client: its own side panel UI, its own storage of conversations, its
own planner loop that calls `/api/v1/conversations/act/extension-plan` and runs browser tools locally, a token
handoff sign-in limited to `getoverlay.io`/`localhost:3000`, and a retired `/api/v1/browser-task` path. It does
not build: the side panel imports `MessageList`, which `@overlay/chat-react` no longer exports, so the required
check "Chrome extension typecheck, test and build" fails on main (Monorepo Phase 3).

What it has that is worth keeping: the content-script page actions (`src/content/index.ts`: inspect, find,
click, type, press, select, scroll, hover, wait, drag), tab and window operations, tab groups, the control HUD
and tab capture.

## Decision 1: the side panel loads the web app (recommended)

Desktop already works this way: it loads the web app and adds native integrations over a bridge. The
extension should do the same. The side panel page is a thin extension page that frames
`https://overlay.works/app?surface=chrome` full-bleed and adds browser integrations over a `postMessage`
bridge (the Chrome equivalent of `@overlay/desktop-bridge`).

Why: every row in the parity table below becomes "Yes" on day one and stays true with no port, no second
transcript, no second model selector, no second conversation store. The ≈4k lines of side panel UI, local
conversation storage, the extension planner loop and the `extension-plan` route are deleted. The side panel
matches web chat because it *is* web chat.

What it needs:

- A fixed extension id (manifest `key`) so the web app can allow exactly that origin:
  `frame-ancestors 'self' chrome-extension://<id>` in `src/proxy.ts` and an `X-Frame-Options` exception in
  `next.config.ts`, only for `/app` requests carrying `surface=chrome`. Preview origins
  (`*.preview.overlay.works`) and `localhost:3000` are allowed for QA.
- Session: the framed app uses the normal `overlay_session` cookie. Chrome treats a frame inside an extension
  page with host permission for that site as first-party, so the person's existing overlay.works sign-in
  works and sign-in opens in a normal tab (WorkOS does not run framed). **Spike first (Phase 1, day one):**
  confirm the Lax cookie and unpartitioned storage in the framed app on Chrome stable. If it fails, fall back to
  Decision 1b.
- Narrow layout: the side panel is 360–500 px wide, so the app uses its production narrow layout (drawer
  navigation, no 60 px rail), which already exists for small windows. `surface=chrome` only hides what makes no
  sense in a side panel (desktop download prompts) and shows Settings → Browser.
- The bridge (`packages/overlay-chrome-bridge`, typed like the desktop bridge): `page.context` (active tab
  URL, title, selection, for "Use this page" in the composer), `browser.status`, `browser.connect`,
  `browser.sites` (list, revoke), `browser.stop`. The framed origin is checked on both sides.

**Decision 1b (fallback, not recommended):** keep a native side panel and port it to `@overlay/chat-react`
(`ChatExchange`, `ModelSelector`, `@overlay/api-client`), then re-implement agents, threads, files and
settings there. This is the literal Monorepo Phase 3 and fixes CI, but it re-creates a third client that has to
chase every web change.

Either way, Phase 1 makes the required CI check green.

## Parity: what the extension lacks today

| Feature | Web / Desktop | Mobile | Chrome today | Chrome after Phase 1 |
| --- | --- | --- | --- | --- |
| Chat transcript (`ChatExchange`, working orb, tool rows, approvals) | Yes | Yes | Own renderer; does not build | Yes (web app) |
| Agents and agent threads | Yes | Yes | No | Yes |
| Chats, rooms, channels, DMs | Yes | Yes | Side panel chat only | Yes |
| Model selector (`ModelSelector`, favorites, provider rail) | Yes | Yes | Own catalog (`models-catalog.ts`) | Yes |
| Files, notes, memories, attachments | Yes | Yes | Document ingest only | Yes |
| Work, Automations, Extensions | Yes | Yes | No | Yes |
| Workspace and Personal modes | Yes | Yes | No | Yes |
| Sign-in and onboarding | Web sign-in, first run | Native sign-in | Token handoff to `getoverlay.io` | Normal overlay.works session; first run adds "Let agents use this browser" |
| Use this page as context | No | No | Yes | Yes (bridge `page.context`, composer chip) |
| Agents can use this browser | No | No | Only the side panel's own planner | Any agent run of this person (Phases 2–3) |

## Decision 2: how an agent run reaches the extension

Reuse the This Mac channel. Nothing new on the wire except one request kind.

```
agent run (server, any surface)            Convex                         Chrome extension (service worker)
chrome_browser tool ──► BrowserService ──► agentLocalToolCalls ◄── GET  local-tool-calls (long-poll 20 s)
       ▲                (LocalComputerService                  ──► content script / chrome.* APIs
       └──── result ◄──  execute(), same table) ◄────────────── POST local-tool-calls/{callId}/result
```

- **Environment.** The extension enrolls as an agent environment with a new kind `browser`
  (`AGENT_ENVIRONMENT_KINDS`), name "Chrome on <OS>", and a `browserTools` capability
  (`version: 1`, `browser: 'chrome'`, `extensionVersion`, `features`). A new kind keeps it out of
  `LocalComputerService.findForUser`, which only takes `kind: 'local'`, so `computer_exec` never lands in a
  browser. It counts against the workspace's computer limit like a Mac, and is personal like a Mac: only the
  person who approved it can use it.
- **Request kind.** `localToolRequestSchema` gains `{ kind: 'browser', action, args }`, validated by the same
  action schema the tool uses (`chromeBrowserVariants` in `@layernorm/overlay-agent-bridge-protocol`). Results
  keep the 768 KiB cap; screenshots are JPEG, downscaled to fit.
- **Server.** `LocalComputerService` is generalised to take the environment kind (`findForUser({ kind })`);
  `BrowserService` is that service with `kind: 'browser'`. Same enqueue/claim/complete/expire mutations, same
  routes under `agent-environments/[environmentId]/local-tool-calls`, same one-hour row deletion.
- **Extension worker.** The MV3 service worker runs the long-poll while the environment is on. Chrome keeps a
  worker alive while a fetch is in flight; a `chrome.alarms` tick every 30 s restarts the loop if Chrome evicted
  the worker. Calls whose `deadlineAt` passed are answered `expired`, never started.
- **Several browsers.** Without a choice, the most recently seen online browser. Each is personal.

## Decision 3: enrollment and authentication

Same trust model as This Mac, with the approval step done in place because the person is already signed in
in the side panel:

1. Settings → Browser → "Let agents use this browser" (or the first-run card) calls the existing code endpoint
   as the signed-in person and hands the single-use code to the extension over the bridge.
2. The extension generates an Ed25519 key pair with WebCrypto (non-extractable, stored in IndexedDB; Chrome
   137+, so `minimum_chrome_version` becomes 137), enrolls with the code, and shows its three-word phrase.
3. The framed app matches the phrase to the pending enrollment (as desktop does) and approves it. No folders
   are involved; the grant is "browser".
4. Later requests use the existing 15-minute bearer credential plus device signature; scopes are heartbeat,
   capabilities, `commands:poll`, `events:write`, credential refresh. The 30-day refresh after sleep applies.
5. Turning the switch off, removing the extension, or "Remove" in Settings revokes the environment and its
   credentials. Signing out of overlay.works in the browser does not revoke it (it is a device credential);
   the side panel shows it as connected until revoked.

The old token handoff (`extension-auth.ts`, `onMessageExternal`, `getoverlay.io` origins) is deleted.

## Decision 4: tools and tool groups

One tool, `chrome_browser`, in a new group **Your browser** (`id: 'browser'`, label "Your browser",
description "Use your own Chrome, with your sign-ins, when you allow it."). One tool with an `action` field
matches `computer_browser`, keeps the model's tool list short, and reuses snapshot refs.

| Action | What it does | Approval in Ask |
| --- | --- | --- |
| `tabs`, `switch_tab`, `new_tab`, `close_tab` | Tabs the agent opened or the person shared (below) | No |
| `navigate`, `back`, `forward`, `reload` | In the agent's tab | No |
| `snapshot` | URL, title, visible text and interactive elements with refs (the `browserActionText` format); password values and payment fields are masked | No |
| `read_text` | The page's readable text (up to 20k characters) | No |
| `click` | By ref; `confirm: true` for consequential clicks | When `confirm` |
| `type`, `fill_form`, `select`, `press` | Type into one field, several fields at once, choose an option, press a key | Yes |
| `hover`, `scroll`, `wait_for` | Pointer and waits | No |
| `screenshot` | JPEG of the agent's tab | No |
| `console` | Console messages since the agent took the tab (level, text, source), capped | No |
| `network` | Requests since the agent took the tab (method, URL, status, type, timing); no bodies or headers | No |
| `download` | Download a link or URL to the person's Downloads folder, after the in-browser confirmation | Yes |

- `chrome_browser` joins `OVERLAY_TOOL_IDS` (`packages/overlay-tools-core/src/policy.ts`), `build.ts`,
  `toolRequiresApproval`, `describeToolCall` ("Opened northwind.example/orders", "Clicked “Export CSV”",
  "Typed in “Search orders”", "Downloaded orders-november.csv") and the tool catalog.
- **Groups.** It is a new group, not a new id in an existing group, so no `LATER_GROUP_MEMBERS` entry is
  required for correctness. One is still added so saved full-toolbox agents gain it, keyed like Tasks:
  `{ grantedBy: ['create_automation', 'generate_video', 'interactive_browser_session'], adds: ['chrome_browser'] }`.
  New agents get the group by default (it does nothing until the person connects a browser).
- **Who gets it.** Personal chat (when the request is about a website, per `exposure-policy.ts`), the
  person's agent threads and asks they start. Never: shared rooms and workspace automations (it is a personal
  device, like a Mac), any automation (nobody is there to consent), outside apps over MCP
  (`MCP_EXTERNAL_WITHHELD_TOOL_IDS`), private threads. Not paid-gated: it runs on the person's own machine.
- **Unavailable.** When no browser is online the result says why (not set up, off, or offline since a time)
  and what to turn on, like the Mac's `unavailableReason`.
- Retired ids `browser_run_task` and `interactive_browser_session` stay retired.

## Decision 5: permission and consent

Two independent layers. The server's Ask/Auto approvals (above) are unchanged; the browser adds its own,
which no server setting can skip.

- **Agent tabs, not your tabs.** An agent works in tabs it opened, in its own tab group named and coloured for
  the agent ("Atlas"), in a separate unfocused window by default so it never takes the person's current tab.
  It sees other tabs only when the person shares one (side panel "Share this tab with agents", or the tab's
  context menu). `tabs` never lists unshared tabs.
- **Per-site approval.** The first action on a new site (registrable domain) pauses and shows a bar at the top
  of that tab and in the side panel: "Atlas wants to use northwind.example — Allow once · Always allow · Don't
  allow". The call waits (within its deadline); no answer is "Don't allow". "Always" is stored per browser and
  listed in Settings → Browser → Sites with Remove. A site the person blocks stays blocked.
- **Visible control.** While an agent acts: the tab group, a thin accent edge around the page, a pill at the
  bottom of the page "Atlas is using this tab · Stop", the toolbar badge, and a row in the side panel. A page
  cannot hide or click the pill (closed shadow root, events checked as trusted).
- **Stop.** The pill, the side panel and the toolbar all stop. Stop answers the pending call with
  `stopped_by_user`, refuses further calls from that run until the person allows again, and tells the agent
  not to retry. "Let agents use this browser" off stops everything at once. Stopping the run in the thread
  (web or desktop) also ends it.
- **No credentials or payments.** The extension refuses, whatever the server sent: typing or filling into
  `type=password` fields, one-time-code fields, `autocomplete` `cc-*`/`current-password`/`new-password`/
  `one-time-code`, fields whose label or name says card number, CVC, IBAN, routing or account number; and any
  action on browser and store pages (`chrome://`, `chromewebstore.google.com`). Snapshots mask those values.
  The agent is told to ask the person to do that step. The server's own payment and credential rules apply too.
- **Downloads.** Each download shows a confirmation in the tab bar (file name, site, size when known) before it
  starts.
- **Console and network** are read with the `webRequest` permission (metadata only) and a console hook
  injected when the agent takes the tab, so the browser never shows the debugger infobar and no `debugger`
  permission is requested. Typing uses page events, not trusted OS input; sites that reject synthetic input
  are a known limit (Decision: no `debugger` until a real need appears).

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Web app in the side panel | Cookie/framing spike; fixed extension id; side panel frames `overlay.works/app?surface=chrome`; `frame-ancestors`/`X-Frame-Options` for that origin; chrome bridge package with `page.context`; delete the old side panel, local conversation store, planner loop, token handoff and `extension-plan` route; workflow widened to `packages/overlay-chat-*`, `packages/overlay-ui`, the bridge package and `bun.lock`; required check green (closes Monorepo Phase 3) | Not started |
| 2. Browser channel | `browser` environment kind and `browserTools` capability; `browser` request kind; `LocalComputerService` by kind; enrollment from Settings → Browser and first run; extension key, poller, heartbeat, revoke; Settings → Browser (switch, Sites, Remove) | Not started |
| 3. Tool and consent | `chrome_browser` tool, group, approvals, tool rows, exposure; executor actions on top of the existing content-script actions; agent tab groups and window; site approval bar; control pill and Stop; credential and payment refusal; downloads confirmation; console and network | Not started |
| 4. End-to-end QA and docs | Preview QA with the unpacked extension in Chrome: an agent run started on web and on desktop drives a real tab (consent, Stop, refusal, download); Playwright extension e2e in CI; docs below | Not started |
| 5. Distribution | Chrome Web Store listing and review, store id in `frame-ancestors`, update channel | Not started |

Each phase lands as its own PR to main with preview QA.

## Docs kept current

`internal/develop/surfaces.md` (parity table, Chrome row, CI row, Known gaps), `internal/develop/tool-catalog.md`
(`chrome_browser`, the group, who gets it), `internal/develop/local-computer.md` (browser environments on the
same channel), `internal/plans/MONOREPO_SURFACES_PLAN.md` (Phase 3), a new living doc
`internal/develop/chrome-extension.md` (bridge, enrollment, consent model, QA) added to the AGENTS.md table,
and `CHANGELOG.md`.

## Risks and open questions

- Framing and the session cookie in an extension page (spiked first; Decision 1b if it fails).
- MV3 worker eviction during long-polls (alarm restart; measured in Phase 2 QA).
- Synthetic input on sites that need trusted events (known limit; revisit with `debugger` only if needed).
- Chrome Web Store review of `<all_urls>` host access plus `webRequest` and `downloads` (Phase 5).
- Mobile has no browser to offer; mobile-started runs still use the person's Chrome when it is online.
