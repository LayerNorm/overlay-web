---
title: "Browser Testing with agent-browser"
description: "How coding agents use agent-browser to test code changes in a real browser — installation, workflow, and patterns."
---

# Browser Testing with agent-browser

This document explains how coding agents (Devin, Codex, Claude Code, Windsurf, etc.) use
[agent-browser](https://github.com/vercel-labs/agent-browser) to verify code changes in a
real browser. It covers installation, authentication, workflow patterns, and gotchas.

## Why a real browser?

`curl` only proves the server responded. It does not prove:

- The page actually rendered (React hydrated, no client crash).
- The static shell painted before the dynamic content streamed in (PPR / Cache Components).
- `<Activity>` UI state (sidebar collapse, theme, open panels) persisted across navigations.
- Console errors did not appear (CSP violations, hydration mismatches, 401 race conditions).
- The user can actually click the thing and see the right result.

A real browser driven by the agent closes that gap.

## Why agent-browser (not Playwright MCP)

We previously used Playwright MCP with the user's main Chrome. This caused problems:

1. **Background tab throttling**: Chrome throttles JS in background tabs. Pages appeared
   "stuck on loading" because the agent's tab was not focused. Extension mode had no way
   to disable this. CDP mode with a separate Chrome instance caused dock icon conflicts
   and profile corruption.
2. **Profile interference**: Connecting to the user's main Chrome risked interfering with
   their browsing session and required complex profile cloning procedures.
3. **Connection dialogs**: Extension mode showed connection approval dialogs on every
   session unless a token was configured.

agent-browser solves all of these:
- Runs its own headless Chrome (Chrome for Testing) — no dock conflicts, no profile
  interference, no background throttling.
- Uses CDP directly — fast, reliable, no extension dependency.
- Sessions are isolated and stateful — each session has its own cookies and tabs.
- Auth state can be saved and restored across runs.

## Installation

```bash
npm i -g agent-browser
agent-browser install   # downloads Chrome for Testing (~180MB, one-time)
```

The skill is also installed via `npx skills add vercel-labs/agent-browser`.

## Authentication

### PR preview QA login

For the release-workflow migration, use the canonical
`https://pr-<number>.preview.getoverlay.io` URL after verifying that its assigned
deployment SHA matches the current PR head. The preview-only
`POST /api/auth/preview-login` route accepts an `x-overlay-preview-secret` header
from the agent secret store and creates a normal sandbox session. Do not send
the secret in a URL, write it into the PR, or save cookies/auth state in tracked
files. Long-running API smoke clients refresh cookies through `GET /api/auth/session`
and retry a rejected unauthenticated request once, matching normal browser session
refresh. Validate the session and `/api/auth/convex-token`, then use a real browser
to check the rendered workspace, sample conversation, note, and text file.

The long-horizon API smoke polls every five seconds to leave history-read capacity for
concurrent browser QA. Honor 429 cooldowns without resending the task; rate-limited gaps
do not prove a visible stall or uninterrupted streaming. Record the gap and fail smoke acceptance
even if the task later completes. An observation deadline is not a run deadline: keep the
created agent and machine until terminal state is confirmed, and retain their identifiers
in the private report. Cleanup must check successful responses before claiming deletion.

The server chooses the seeded QA identity; callers cannot supply an arbitrary
user ID. This route returns 404 outside Preview. Real human OAuth uses
the same canonical preview origin with the WorkOS sandbox wildcard callback.

For long connected-agent timing checks, the Preview-only branch build setting
`OVERLAY_AGENT_UI_TRACE=1` and conversation query `agentUiTrace=1` enable a local
recorder. Hover the assistant toolbar and use **Export timing trace** to download its
JSONL through the actual QA browser. The recorder continues across automation tool-turn
interruptions; reload starts a new segment. It stores text hashes and DOM/layout timing,
not chat text or credentials, and never uploads the trace. Start before native output,
retain every source checkpoint, validate hashes against canonical rendered text, include
clock intervals/gaps and require final coverage before accepting a latency result.
For an in-app browser whose tabs can become hidden, measure one foreground conversation
at a time. Inspecting a tab may activate it: sequential visibility spot checks cannot
establish continuous visibility. Preserve hidden samples in the final analysis.
An error icon, hidden tab or missing segment is incomplete measurement, not a passing
result. Export before clearing site storage; Production builds disable the recorder.

### Deployment protection

PR previews run in the `overlay-landing` project's Preview environment. Use the
caller's existing Vercel authentication to access a protected preview. For HTTP
checks, use `vercel curl` with an explicit deployment URL. For a supported browser
runner, use the same project's short-lived development OIDC token as an
origin-scoped `x-vercel-trusted-oidc-idp-token` header. Keep tokens and cookies
outside tracked files. Authenticate to the app separately using sandbox QA
credentials or the preview-only login route above.

Do not copy a Production app session into a Preview environment. Each preview
uses sandbox WorkOS and its own Convex backend.

### Cloud agents without a Vercel login

**First choice: Vercel MCP, independent of agent platform.** Connect the agent
to `https://mcp.vercel.com` and authorize the Divyansh account that has access to
`overlay-landing`. Call `get_access_to_vercel_url` with the current canonical PR
URL and team `team_VT3uNspuyAOwicxedhtG4SMe`. Open the returned shareable URL in
the actual QA browser; its redirect establishes that browser's access cookie.
Continue using the ordinary canonical PR URL in the same browser session, then
sign into Overlay separately. A terminal fetch does not authenticate a separate
browser. For HTTP-only checks, `web_fetch_vercel_url` handles protected fetches.

New MCP links expire after 23 hours; existing links retain their own expiry.
Request access again if it expires. Treat `_vercel_share` links as credentials:
keep them out of PR text, logs, screenshots and recordings; return to the clean
canonical URL before capturing evidence. MCP must be connected and authorized
in each agent platform; adding instructions to this repo cannot install it into
an arbitrary VM. Agents without MCP need the fallback below. Never post a shared
access link in a public PR to give every agent access.

**Fallback for runners without Vercel MCP:**

Provision `VERCEL_AUTOMATION_BYPASS_SECRET` once in the cloud platform's private
runtime secret store for this repository, using the existing `overlay-landing`
automation bypass secret. GitHub Actions secrets and Vercel app variables do not
automatically reach a Builder's VM. The secret must be available during browser
QA, not just environment setup. Reuse it for every requested PR preview; do not
create a per-PR bypass token or disable Deployment Protection.

Send `x-vercel-protection-bypass` only to the exact verified PR preview origin.
For Playwright, bootstrap a host-scoped bypass cookie through the browser
context's request client, then navigate normally in that same context:

```js
const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
if (!secret) throw new Error('Missing cloud preview bypass credential')
const origin = new URL(process.env.PREVIEW_URL).origin
if (!/^https:\/\/pr-[1-9]\d*\.preview\.getoverlay\.io$/.test(origin)) {
  throw new Error('Expected the canonical PR preview origin')
}
// context.request shares its cookie jar with pages in this browser context.
const response = await context.request.get(origin, {
  headers: {
    'x-vercel-protection-bypass': secret,
    'x-vercel-set-bypass-cookie': 'true',
  },
  maxRedirects: 0,
})
if (response.status() < 200 || response.status() >= 400) {
  throw new Error('Preview protection bootstrap failed')
}
await page.goto(origin)
```

For another browser runner, use its origin-scoped request headers or import the
bypass cookie into its own session. A terminal cookie jar does not authenticate
an unrelated browser. Never put the secret in a URL, global browser headers,
screenshots, network traces, logs, PR descriptions or tracked storage-state
files. The Vercel automation secret is project-scoped, not PR-scoped; restrict
its distribution to trusted repository agents. It bypasses Vercel's hosting
gate only; Overlay sandbox login and exact-head/backend verification still apply.

Server-side workspace-tool calls into the same isolated Preview also need hosting
authentication. The internal tool transport reuses Vercel's runtime
`VERCEL_AUTOMATION_BYPASS_SECRET` only for `/api/` requests to the verified canonical
PR origin, retains Overlay's bearer/service authentication, and refuses redirects.
Never forward that header to another origin, another PR or Production.

An owned Cloud QA machine may use a private loopback MCP relay when a provider cannot
attach the hosting header. Bind it only to loopback, accept only the exact MCP path,
preserve the original run bearer, and forward only to the verified PR origin through
the host's private transport. Keep the hosting secret out of provider child environments
and record this QA intervention separately from unattended Cloud/image acceptance.

For unattended Agent Host acceptance on a protected Preview, use a disposable
QA image with a transport wrapper that attaches an existing access cookie only
to that exact PR origin. Keep the cookie in a mode-0600 file under the machine's
private persistent home, never in a snapshot, provider-child environment or
global request headers. Boat clears `/tmp` during stop/resume, so a temporary
access file cannot establish unattended wake acceptance. Keep the signed host
authentication intact, record the wrapper as a QA fixture, and delete the owned
machine after settlement; this is not the production image bootstrap.

For candidate-host regression QA, `scripts/smoke/cloud-agent-long-horizon/byo-host-box.mts`
can pack the current checkout and enroll it into the PR's backend. Require the
existing scoped Preview Boat key with `BOAT_ENVIRONMENT=overlay-preview`; never
substitute the production key. This is a disposable VPS-style fixture, so record
cloud-provisioning acceptance separately. The host-only preload removes its
`NODE_OPTIONS` before provider launch. It does not authenticate the provider's MCP
traffic through Vercel protection; record that limitation when testing app tools.

Native managed-Cloud QA may bootstrap an owned disposable machine during its pending
provisioning attempt. Verify its provider identity and expected enrollment name, confirm that
no original host/provider task is running, install checksum-verified candidate packages and
exact adapter pins, then enroll with that same expected name. Let the existing provisioner
approve the environment, create its lease and bind the provider account. Use the exact-origin
private transport for both initial enrollment and later host wake; keep its preload out of
provider children. Record this manual intervention separately from unattended image/startup
acceptance. A successful shell-only provider probe does not prove protected Overlay MCP tools.

See [Vercel's automation bypass documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).
See also [Vercel MCP access tools](https://vercel.com/docs/agent-resources/vercel-mcp/tools).

## Clearing controlled search inputs

For cmdk search, `agent-browser fill <selector> ""` can clear the displayed DOM
value without firing the React state change. Focus the input, select its text
and press `Backspace`, then assert both the input value and returned rows.
CDP may omit the native Select All editing command even when the modifier/key
events fire; verify `selectionStart`/`selectionEnd`, or call the input's native
`select()` before a trusted Backspace. This changes selection only, not React
state. A screenshot of an empty input alone does not prove the query cleared.
Use sanitized network summaries; raw request inventories can include
deployment-protection bypass URLs.

## Core workflow

```bash
# Open a page
agent-browser open "https://pr-123.preview.getoverlay.io/app/w/<workspace-id>/chat?view=channels"

# Wait for it to load
agent-browser wait --load networkidle

# See what's on the page (interactive elements only)
agent-browser snapshot -i -c

# Click an element by ref
agent-browser click @e3

# Read page text
agent-browser get text "body"

# Take a screenshot
agent-browser screenshot /tmp/page.png

# Close when done
agent-browser close --all
```

### Multi-session testing (owner + member)

Use `--session` to run isolated browser sessions for different accounts:

```bash
# Owner session
agent-browser --session owner --state ~/.config/devin/agent-browser-overlay-auth.json open "https://pr-123.preview.getoverlay.io/app/w/<id>/chat?view=channels"
agent-browser --session owner wait --load networkidle
agent-browser --session owner get text "body"

# Member session
agent-browser --session member --state ~/.config/devin/agent-browser-overlay-member-auth.json open "https://pr-123.preview.getoverlay.io/app/w/<id>/chat?view=channels"
agent-browser --session member wait --load networkidle
agent-browser --session member get text "body"

# Clean up
agent-browser close --all
```

## Gotchas

- **No background throttling.** agent-browser uses Chrome for Testing with CDP, which does
  not throttle background tabs. This was the primary reason we switched from Playwright MCP
  extension mode.
- **Cookies expire.** The extracted SSO cookies have an expiration date. If the page
  redirects to an auth page, re-extract cookies from the Chrome profile.
- **Chrome must be quit before reading Cookies DB.** SQLite may hold a lock if Chrome is
  running. If you get a database lock error, ask the user to quit Chrome first, or copy
  the Cookies file to a temp location before reading.
- **Refs are ephemeral.** `@eN` refs from `snapshot` are only valid until the page changes.
  Always re-snapshot after clicks, navigation, or dynamic re-renders.
- **Use `--session` for multi-account testing.** Each session is an isolated browser with
  its own cookies. Never mix accounts in the same session.
- **Use the PR preview for final acceptance.** Run local smoke with `npm run dev`,
  then verify affected behavior on the current-head hosted preview.

## Work UI harness (no backend needed)

`npm run test:work:ui` (`scripts/qa/work-ui-qa.mjs`) drives the real Work page, task panel, Board, Timeline and the
Cmd+K entry in Chromium against an in-page fake of `/api/v1/work` and `/api/v1/scope`
(`scripts/qa/work-ui/fake-work-api.ts`). It bundles the actual components with esbuild, compiles the app's Tailwind CSS,
and swaps only what needs Next.js, a session or a workspace for small shims (`scripts/qa/work-ui/shims/`). Use it for fast
UI iteration and regression checks; it does not replace the preview-URL pass, because the fake is not Convex.

```bash
WORK_QA_CHROMIUM=/opt/pw-browsers/chromium npm run test:work:ui          # when Playwright's own browser is not installed
WORK_QA_SHOTS=artifacts/work-qa npm run test:work:ui                      # also write light and dark screenshots
WORK_QA_ONLY="board" WORK_QA_VERBOSE=1 npm run test:work:ui               # one group, with progress
```

Query parameters pick the situation: `scope=`, `view=`, `filter=`, `task=`, `theme=dark`, `solo=1` (a workspace of one),
`role=member&policy=admins` (a member who may not edit others' tasks), `failList=1`. In a check, `window.__work` exposes the
fake (`dump`, `patchWhere`, `add`, `clear`, `state.failNext`, `state.calls`).

Gotchas found building it, which apply to real-browser QA too:

- **A drag is cancelled if its source node leaves the DOM during `dragstart`.** Keep the dragged card rendered (dimmed) and
  only remove it after the drop. Playwright's `dragTo` then hangs rather than failing, so give each check a default timeout.
- **Moving a keyed node drops its focus.** A bar or card that changes position after a keyboard move must be re-focused.
- **`@overlay/api-client` binds `fetch` when the client is created.** Install a `fetch` fake before the app modules load
  (dynamic `import()` after setup), or requests go to the original.
- **`page.goto` restarts an in-page fake.** Move between URLs inside a check with `history.pushState` plus a `popstate`
  event to keep its state.
- **Assert on the list after the refresh finished, not after the event was dispatched.** A check that edits the fake and
  then clicks can race the reload.

## Previous approach: Playwright MCP (deprecated)

We previously used Playwright MCP with the user's main Chrome. This is no longer used.
The old approach had three modes, all with issues:

1. **CDP mode with separate Chrome** — dock conflicts, singleton merging, profile
   corruption risk.
2. **Extension mode** — background tab throttling, connection dialogs, no throttling
   flags available.
3. **In-main-Chrome Testing profile** — still throttled in background tabs.

The Playwright MCP config has been removed from `~/.config/devin/mcp_config.json`. All
browser QA should use agent-browser instead.

## Chat readiness before a smoke send

The composer and requested heading can appear before chat hydration finishes.
Wait for the chat root with both `data-overlay-chat-id` equal to the requested
conversation and `data-overlay-chat-hydrated="true"`. These attributes reflect
the existing active runtime state after messages/meta have been applied. A
finished network response alone is insufficient. Select Chat, send the real
model request, verify the visible reply and reload persistence, then clean the
synthetic conversation. Keep failed diagnostics separate from trusted CI proof.

Release smoke awaits chat navigation and its transcript response together so a failed navigation cannot leave an unhandled response wait during browser cleanup. Production regressions assert deletion of the exact temporary chat even when chat verification or note cleanup fails.

## Floating-surface regression checks

`node scripts/qa/menu-interactions.mjs` bundles the real UI wrappers and model/
workspace picker components into a backend-free Chromium fixture. It checks
action-menu navigation/typeahead/disabled selection, rich controls and scrolling,
legacy external anchors, workspace create-dialog focus, popovers inside dialogs,
model details following their row during animation/scroll, CSS-variable themes
and mobile touch. Screenshots are explicitly fixture evidence; authenticated
current-head preview QA and real presets remain separate requirements.

The script uses installed Playwright Chromium by default. A restricted cloud
runner may set `CHROMIUM_EXECUTABLE_PATH` to an installed Chromium executable or
`CHROMIUM_RUNTIME_MODULE` to an npm-packaged Chromium runtime module exposing
`executablePath()` and `args`. No browser dependency is added to the application.
Never put credentials or auth-state files in the fixture or its screenshots.

The menu fixture also renders the actual mobile account fallback and verifies
Apps/Usage/Storage disclosure taps, content clicks, Escape and outside dismissal.
Unused Next/sidebar dependencies are stubbed; it does not render the complete
sidebar state hook. The hook must not add a second wrapper-ref dismissal listener
for portalled account content. Nested reasoning-select Tab must leave its
non-modal popover, while actual modal dialogs retain boundary wrapping.

---

## Alternative: driving the real signed-in Chrome (playwright-cli)

A different tool for a different job: agent-browser above is for QA passes;
playwright-cli + a Chrome extension drives the user's **real, signed-in
Chrome** (the LayerNorm profile, `Profile 6`) — the supported path when a task
needs live browser state: Slack app consoles, staging QA with real sessions,
third-party admin UIs.

Do NOT try `--remote-debugging-port` on the default user-data dir — Chrome 136+
silently ignores it (a non-default dir works; see background mode below). Do NOT use the `mcp-playwright` MCP server — it runs the
same extension underneath but adds a fragile server layer (stdio truncation on
long payloads, stale connections, hung `browser_tabs` calls). The CLI path is
stateless and restartable.

### Pick a mode: background (default) or live

| | Background — `pw-bg.sh` | Live — `pw-chrome.sh` |
| --- | --- | --- |
| Browser | Headless Chrome on a **clone** of Profile 6's logins, CDP on `:9224` | The user's real Chrome via the extension |
| Window / focus | None. Never touches the user's windows, tabs, cursor, or keyboard | `tab-new` takes the foreground tab; hidden tabs stall |
| Rendering | Always `visibilityState: visible`; `requestAnimationFrame` runs (the app shell, Suspense reveals, and screenshots all work) | Only the active tab of a visible window renders |
| Logins | Snapshot of Profile 6 cookies and site storage; re-sync when they go stale | Live — always current |
| Use for | Default for QA, scraping, staging checks, admin consoles | Sessions you can't clone (device-bound or fresh logins), or when the user wants to watch |

**Default to `pw-bg.sh`.** Same commands as below, just a different script:

```bash
~/.config/devin/pw-bg.sh goto <url>      # starts the headless browser on first use
~/.config/devin/pw-bg.sh snapshot
~/.config/devin/sync-chrome-p6.sh        # refresh logins from the live Profile 6, restart
```

How it works and why it's built this way:

- `--remote-debugging-port` is blocked on the *default* user-data dir (Chrome
  136+) but allowed on any other dir. `launch-chrome-p6.sh` starts headless
  Chrome on `~/Chrome-Automation-P6`, seeded from Profile 6.
- Headless has no window to be hidden or occluded, so tabs always render. This
  was tested: in the live browser a non-active tab reported `hidden` with zero
  rAF frames, and the extension rejects raw CDP (`Target.attachToBrowserTarget:
  Not allowed`), so you can't force-unhide a tab there.
- The clone must keep the folder name `Profile 6`: it carries `Local State`,
  whose last-used profile makes Chrome open that folder. Putting files in
  `Default/` silently yields a logged-out browser.
- This Profile 6 keeps `Cookies` at the profile root (not `Network/Cookies`).
  Copy with `sqlite3 … .backup`, not `cp`, since the live DB is being written.
- macOS cookie encryption uses the shared "Chrome Safe Storage" keychain
  entry, so cookies decrypt in the clone with no extra setup.
- Verified signed in to GitHub and Slack; the sites' own re-auth rules still
  apply, so a device-bound or short-lived session may need a re-sync or a
  live-mode login.

**Security:** `~/Chrome-Automation-P6` is a copy of signed-in session data
(`chmod go-rwx`). Treat it like the token file: never commit it, never copy it
elsewhere, and the debug port is bound to localhost only. Delete the directory
to revoke the clone. Changes made in the clone (new logins, cookies) do not
flow back to the real profile.

### Pieces

| Piece | Location |
| --- | --- |
| Chrome profile | `~/Library/Application Support/Google/Chrome/Profile 6` |
| Playwright extension | installed in that profile, id `mmlmfjhmonkocbjadbfplnigmagldckm` |
| Extension token | `~/.config/devin/playwright-mcp-extension-token` |
| Wrapper (live) | `~/.config/devin/pw-chrome.sh` |
| Wrapper (background) | `~/.config/devin/pw-bg.sh`, `launch-chrome-p6.sh`, `sync-chrome-p6.sh` |
| Background clone | `~/Chrome-Automation-P6/` (CDP `localhost:9224`) |

The token auto-approves the extension connection — no "Allow & select" dialog.
Never print or commit it; it grants access to a fully signed-in browser profile.

### Usage

```bash
## Any playwright-cli command — auto-attaches on first call:
~/.config/devin/pw-chrome.sh goto <url>
~/.config/devin/pw-chrome.sh snapshot          # aria snapshot → element refs
~/.config/devin/pw-chrome.sh eval '() => location.href'
~/.config/devin/pw-chrome.sh tab-list | tab-new <url> | tab-select <i>
~/.config/devin/pw-chrome.sh run-code "$(cat script.js)"
```

`run-code` scripts receive a `page` object and run inside an async function —
`return` a value to print it, `await page.evaluate(...)` for page JS,
`await page.screenshot()` for PNGs (base64 the result back).

### The tab-group consent model

The extension only exposes tabs in a Chrome **tab group** titled
`Playwright · playwright-cli`. This is a deliberate security boundary, not a
missing feature:

- `tab-new` opens a tab already inside the group — shares Profile 6 cookies
  and login state. For most work this is all you need.
- To drive an existing user tab, open the extension connect page
  (`chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html`), which
  lists every tab with "Allow & select" — one click enrolls it. Or drag the
  tab into the Playwright group manually.
- `tab-list` only ever shows group tabs.

### Gotchas (learned the hard way)

0. **Live mode only: `tab-new` takes the foreground and hidden tabs stall.**
   Switching away leaves `visibilityState: hidden` and no rAF, so React
   Suspense never reveals. Prefer `pw-bg.sh`; otherwise `page.bringToFront()`.
   Root cause (checked 2026-10-11, not an app bug): React's streaming inline
   scripts (`$RC`/`$RV`/`$RT`) batch Suspense reveals in `requestAnimationFrame`.
   The queued callbacks run the moment the tab becomes visible and the shell
   fills in, so real users only see a delayed first paint. Sentry's rAF wrapper
   in the stack is a pass-through. We chose to leave this alone.

1. **Instant `mouse.click` is too fast for Slack's legacy widgets.** The
   `.ts_toggle` switches and the add-event button ignore `page.mouse.click()`.
   Use the slow pattern:
   ```js
   await page.mouse.move(x, y); await page.mouse.down();
   await page.waitForTimeout(110); await page.mouse.up();
   ```
2. **OneTrust cookie overlay** eats clicks on `api.slack.com`. Strip it:
   `document.querySelectorAll('[id*="onetrust"],[class*="onetrust"]').forEach(e=>e.remove())`
3. **Input dispatch can silently die.** If `page.mouse`/`page.keyboard` events
   stop reaching the page (probe with a capture listener on `document`), the
   extension's debugger channel detached — `page.evaluate` still works.
   Detach + re-attach, or open a fresh tab with `tab-new` (new tab = fresh
   debugger attach).
4. **`app.slack.com/app-settings/*` renders blank on direct navigation.**
   Bootstrap via `app.slack.com/app-settings/<team>/<app>` root first, or
   prefer the old console at `api.slack.com/apps/<appId>/<page>` which renders
   reliably: `event-subscriptions`, `general`, `interactive-messages`,
   `oauth` (redirects to the new console, see below).
5. **Session drift**: the CLI session can get hijacked back to the extension
   connect page or a dead tab. Check `page.url()` before operating; re-navigate.
6. **The Slack event picker** (`#add_bot_event` widget): backing element is a
   hidden `<select multiple>`; visible rows are `.lfs_item` (`.hidden` =
   filtered out, `.selected` = already added). The `.lfs_input` needs a real
   click to focus before `keyboard.type` filters. Clear residual text first —
   failed adds leave text in the input.
7. **Save Changes stays disabled**: Slack's dirty-flag doesn't track the
   event widget or programmatic fills. The button's click handler fires
   anyway — remove `disabled` and `el.click()` submits the form.

### The nuclear option: Slack's internal `developer.apps.*` API

When the console UI fights back, skip it entirely. Every old-console page
carries `window.boot_data.api_token` (the `xoxc-` session token). Call the
console's own endpoints with `fetch` from `page.evaluate`:

```js
const fd = new FormData();
fd.append('token', window.boot_data.api_token);
fd.append('app_id', '<appId>');          // some endpoints want `app` instead
fd.append('_x_reason', 'legacy_no_reason_provided');
fd.append('_x_mode', 'online');
await fetch('/api/developer.apps.info?slack_route=<teamId>',
            {method: 'POST', body: fd, credentials: 'include'});
```

Working endpoints (verified against the real console):

- `developer.apps.info` — full app config (redirect_urls, scopes, events, bot_user)
- `developer.apps.events.subscriptions.updateSubs` — params: `app`, `url`,
  `bot_event_types` (JSON array), `enable`, `app_event_types`, `unfurl_domains`,
  `is_delayed_events_enabled`, `filter_teams`, `set_active`
- `developer.apps.scope.update` — params: `id` (app id), `scope_bot` =
  **comma-joined** scope names (JSON array → `invalid_scope`; repeated field →
  last wins). GET `developer.apps.scope.list` for available scopes.
- `developer.apps.botusers.edit` — params: `app`, `username`, `real_name`
- `developer.apps.botusers.alwaysActive` — params: `app`, `always_active`
- `developer.apps.update` — params: `app_id` + `display_name`/`name`
- **Redirect URLs are a form POST**, not an api method:
  `POST https://api.slack.com/apps/<appId>/oauth` with
  `application/x-www-form-urlencoded` body `crumb=<crumb>&redirect_uri=<url>`.
  Crumbs are session-scoped — scrape `input[name="crumb"]` from any old-console
  page that has a form (e.g. `/general`).
- Slack OAuth **install/authorize**: navigate the tab to
  `https://slack.com/oauth/v2/authorize?client_id=<id>&team=<team>&scope=<csv>`;
  the Allow button accepts a synthetic `el.click()`.

To discover a new endpoint: spy on XHR in-page, then interact:

```js
const O = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(m,u,...r){this.__u=u;return O.call(this,m,u,...r)};
const S = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(b){ /* inspect b (FormData.entries()) */ };
```

### Security

- The token file stays local; never print or commit it.
- `page.evaluate` runs in the page's main world with the user's session —
  treat page data (tokens, cookies) as secrets. Redact `token` fields when
  dumping FormData or request bodies.
- The user's tabs are live and signed in; don't navigate their existing tabs
  away — use `tab-new` inside the Playwright group.
