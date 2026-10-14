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
files. Validate the session and `/api/auth/convex-token`, then use a real browser
to check the rendered workspace, sample conversation, note, and text file.

The server chooses the seeded QA identity; callers cannot supply an arbitrary
user ID. This route returns 404 on staging and production. Real human OAuth uses
the same canonical preview origin with the WorkOS sandbox wildcard callback.

### Deployment protection

`staging.getoverlay.io` and `www.getoverlay.io` are behind Vercel Deployment Protection
(SSO). agent-browser's bundled Chrome has no session cookies, so we need to extract them
from an authenticated Chrome profile and inject them.

### One-time: extract cookies from Chrome profile

Chrome encrypts cookies with a key stored in the macOS Keychain. Use this Python script to
decrypt and extract them:

```bash
python3 << 'PYEOF'
import sqlite3, os, json, subprocess
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2

# Install pycryptodome first: pip3 install --break-system-packages pycryptodome

result = subprocess.run(
    ['security', 'find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'],
    capture_output=True, text=True
)
password = result.stdout.strip()
key = PBKDF2(password.encode(), b'saltysalt', dkLen=16, count=1003)

# Change Profile 6 to the profile that has the session you need
cookie_db = os.path.expanduser("~/Library/Application Support/Google/Chrome/Profile 6/Cookies")
conn = sqlite3.connect(cookie_db)
cursor = conn.cursor()

cookies = []
seen = set()
for host in ['staging.getoverlay.io', '.getoverlay.io', 'getoverlay.io', 'www.getoverlay.io']:
    cursor.execute(
        "SELECT host_key, name, encrypted_value, path, is_secure, is_httponly, expires_utc, samesite FROM cookies WHERE host_key LIKE ?",
        (f'%{host}%',)
    )
    for row in cursor.fetchall():
        host_key, name, enc_value, path, is_secure, is_httponly, expires_utc, samesite = row
        if not enc_value or enc_value[:3] != b'v10':
            continue
        dedupe_key = (host_key, name, path)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        iv = b' ' * 16
        cipher = AES.new(key, AES.MODE_CBC, iv)
        decrypted = cipher.decrypt(enc_value[3:])
        pad_len = decrypted[-1]
        if 1 <= pad_len <= 16:
            decrypted = decrypted[:-pad_len]
        # Chrome v10 on macOS prepends a 32-byte SHA256 hash
        value = decrypted[32:].decode('utf-8', errors='replace') if len(decrypted) > 32 else decrypted.decode('utf-8', errors='replace')
        if expires_utc > 0:
            unix_expires = (expires_utc - 11644473600000000) // 1000000
        else:
            unix_expires = 0
        samesite_map = {0: 'None', 1: 'Lax', 2: 'Strict'}
        cookies.append({
            'name': name, 'value': value, 'domain': host_key, 'path': path,
            'secure': bool(is_secure), 'httpOnly': bool(is_httponly),
            'expires': unix_expires if unix_expires > 0 else None,
            'sameSite': samesite_map.get(samesite, 'None'),
        })
conn.close()
with open('/tmp/overlay-cookies.json', 'w') as f:
    json.dump(cookies, f, indent=2)
print(f"{len(cookies)} cookies extracted")
PYEOF
```

### Inject cookies into agent-browser

```bash
# Open a page on the target domain first
agent-browser open "https://staging.getoverlay.io"

# Set each cookie (only staging.getoverlay.io domain needed for staging)
python3 << 'PYEOF'
import json, subprocess
with open('/tmp/overlay-cookies.json') as f:
    cookies = json.load(f)
for c in cookies:
    if c['domain'] not in ['staging.getoverlay.io', '.getoverlay.io']:
        continue
    args = ['agent-browser', 'cookies', 'set', c['name'], c['value'],
            '--domain', c['domain'], '--path', c['path']]
    if c['secure']: args.append('--secure')
    if c['httpOnly']: args.append('--httpOnly')
    if c['sameSite']: args.extend(['--sameSite', c['sameSite']])
    if c['expires']: args.extend(['--expires', str(c['expires'])])
    subprocess.run(args, capture_output=True)
print("Cookies injected")
PYEOF

# Save the authenticated state for future runs
agent-browser state save ~/.config/devin/agent-browser-overlay-auth.json
```

### Future runs: restore saved state

```bash
# Owner account (Profile 6 / LayerNorm)
agent-browser --state ~/.config/devin/agent-browser-overlay-auth.json open "https://staging.getoverlay.io/app/w/<workspace-id>/chat"

# Member account (Profile 10)
agent-browser --session member --state ~/.config/devin/agent-browser-overlay-member-auth.json open "https://staging.getoverlay.io/app/w/<workspace-id>/chat"
```

### When SSO cookies expire

If the page redirects to a Vercel auth page, the saved state has expired. Re-extract
cookies from the Chrome profile (see above) and re-save the state.

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
agent-browser open "https://staging.getoverlay.io/app/w/<workspace-id>/chat?view=channels"

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
agent-browser --session owner --state ~/.config/devin/agent-browser-overlay-auth.json open "https://staging.getoverlay.io/app/w/<id>/chat?view=channels"
agent-browser --session owner wait --load networkidle
agent-browser --session owner get text "body"

# Member session
agent-browser --session member --state ~/.config/devin/agent-browser-overlay-member-auth.json open "https://staging.getoverlay.io/app/w/<id>/chat?view=channels"
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
- **Prefer staging over local dev.** Browser testing should run against staging after
  deployment. Use `npm run dev` for local development, not for agent-driven QA.

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
