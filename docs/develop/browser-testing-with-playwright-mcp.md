---
title: "Browser Testing with Playwright MCP"
description: "How coding agents use the Playwright MCP server to test code changes in a real browser — installation, workflow, and patterns."
---

# Browser Testing with Playwright MCP

This document explains how coding agents (Devin, Codex, Claude Code, Windsurf, etc.) use the
[Playwright MCP](https://github.com/anthropics/playwright-mcp) server to verify code changes
in a real browser. It covers installation for any agent, the workflow patterns that work well
for this repo, and the gotchas we have hit.

## Why a real browser?

`curl` only proves the server responded. It does not prove:

- The page actually rendered (React hydrated, no client crash).
- The static shell painted before the dynamic content streamed in (PPR / Cache Components).
- `<Activity>` UI state (sidebar collapse, theme, open panels) persisted across navigations.
- Console errors did not appear (CSP violations, hydration mismatches, 401 race conditions).
- Security headers are present on the response (CSP, X-Frame-Options, etc.).
- Redirects fired correctly for authenticated vs. unauthenticated users.

The Playwright MCP server gives the agent a headed Chromium instance it can drive through the
same tools a human tester would use: navigate, click, type, read the accessibility snapshot,
read console messages, and evaluate JavaScript in the page.

## Where to test: staging, not `npm run dev`

**Do not run `npm run dev` for browser QA.** The Next.js dev server is a single-process
Node instance that compiles routes on-demand. On this repo it consumes a large amount of
memory and will slow or freeze the user's machine when a headed Chromium is running
alongside it. This is not a theoretical concern — it has happened repeatedly in practice.

**Always test on staging instead.** The staging deployment at
`https://staging.getoverlay.io` is a production-equivalent Vercel build that uses the
shared dev Convex backend. It is the correct environment for agent-driven browser QA:

1. Merge your feature branch to `staging` and push.
2. Wait for the Vercel deployment to reach `READY`.
3. Run Playwright MCP tools against `https://staging.getoverlay.io`.

If you need to verify a route that has not been merged to staging yet, coordinate with the
user — do not spin up a local dev server without explicit permission. The user has
explicitly asked that agents never run `npm run dev` for testing because it freezes their
machine.

## Installation

### Prerequisites

- Node.js 20+ and `npx` available on the machine the agent runs on.
- The Playwright MCP server launches its own Chromium; you do not need a system Chrome.
  However, the user already has the **Playwright MCP Chrome extension** installed in their
  Chrome profile, which allows the MCP to reuse that profile's cookies (for SSO-protected
  staging environments). The extension token is in the env block below.

### Devin (already configured)

The MCP is registered in `~/.config/devin/mcp_config.json`. It connects to a
**dedicated testing Chrome instance** via CDP (not the user's main Chrome), so
agent browser QA never interferes with the user's browsing or other agents:

```json
{
  "mcp-playwright": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
  }
}
```

The testing Chrome instance must be running before Playwright MCP tools can be
used. To launch it:

```bash
bash ~/.config/devin/launch-chrome-testing.sh
```

This script launches a separate Chrome process with:
- A cloned LayerNorm profile (cookies, auth sessions, localStorage copied from
  the user's `Profile 6` Chrome profile, renamed to "LayerNorm Testing")
- Background-tab throttling disabled (see [Background tab throttling](#background-tab-throttling))
- A CDP endpoint on port 9222 for Playwright MCP to connect to

If the script reports the instance is already running, it is safe to proceed —
the CDP port is already listening.

Devin agents can call `mcp-playwright` tools directly — no extra setup beyond
ensuring the testing Chrome is running.

### Claude Code

Add the same server to `~/.claude/claude_desktop_config.json` (or the project-level
`.mcp.json`). Use the CDP endpoint if the testing Chrome is running, otherwise
use `--extension` to connect to the user's main Chrome:

```json
{
  "mcpServers": {
    "mcp-playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
    }
  }
}
```

Restart Claude Code after editing the config. Verify with `mcp__list_tools` (or the
equivalent in the Claude Code UI).

### Windsurf

Windsurf reads MCP servers from `~/.codeium/windsurf/mcp_config.json`. Add the same
`mcp-playwright` block with the CDP endpoint. Windsurf's MCP panel (Settings → MCP
Servers) should show it as connected after restart.

### Codex (OpenAI)

Codex CLI reads MCP servers from `~/.codex/config.toml`. Add:

```toml
[mcp_servers.mcp-playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
```

### Generic / other agents

Any agent that speaks the Model Context Protocol can use this server. The minimal
config is:

- **Command:** `npx -y @playwright/mcp@latest --cdp-endpoint http://localhost:9222`
- **Prerequisite:** The testing Chrome instance must be running (launch with
  `bash ~/.config/devin/launch-chrome-testing.sh`).

If the testing Chrome is not available and the agent needs SSO cookies, it can fall
back to `--extension` mode to connect to the user's main Chrome (requires the
Playwright MCP Chrome extension and its token). However, this risks interfering
with other agents or the user's browsing — prefer the dedicated testing Chrome.

## The `--cdp-endpoint` flag and SSO-protected environments

`staging.getoverlay.io` and `www.getoverlay.io` are behind Vercel Deployment Protection
(SSO). A clean Chromium instance has no session cookie and will be redirected to the Vercel
auth page. The dedicated testing Chrome instance (launched by
`~/.config/devin/launch-chrome-testing.sh`) has a cloned LayerNorm profile with valid SSO
cookies, so Playwright MCP can access staging directly via the CDP endpoint on port 9222.

The previous `--extension` mode connected to the user's main Chrome profile via the
Playwright MCP browser extension. This worked but had two problems:
1. It shared tabs and session state with the user's browsing, causing interference.
2. Background tabs were throttled by Chrome (see [Background tab throttling](#background-tab-throttling)).

The CDP approach solves both: the testing Chrome is a separate process with its own
profile, and it launches with throttling disabled.

If the testing Chrome is not running, `browser_navigate` will fail with a connection
error. Launch it with `bash ~/.config/devin/launch-chrome-testing.sh` and retry.

## Background tab throttling

Chrome throttles JavaScript in background tabs to save CPU/battery: `setTimeout` is
clamped to 1000ms minimum, `requestAnimationFrame` is paused, and renderer processes
are deprioritized. This causes pages to appear "stuck on loading" when the Playwright
tab is not in the foreground — the app's hydration and data-fetching stall until the
tab becomes visible.

The testing Chrome is launched with these flags to disable all background throttling:

- `--disable-background-timer-throttling` — stops `setTimeout`/`setInterval` clamping
- `--disable-backgrounding-occluded-windows` — stops occluded windows from being deprioritized
- `--disable-renderer-backgrounding` — stops the renderer process from being throttled
- `--disable-features=CalculateNativeWinOcclusion` — disables occlusion detection

With these flags, pages load fully in background tabs without needing to be focused.
This is essential for agent-driven QA where the agent navigates to a URL and waits for
the page to render while the user is working in another tab.

**Note:** The JS-level Page Visibility API (`document.hidden`, `document.visibilityState`)
is not overridden in CDP mode. If the app or a library checks `document.hidden` and
pauses logic based on it, those code paths could still stall. The 4 Chrome flags cover
the vast majority of cases (timer clamping, rAF, renderer priority).

## Multi-agent isolation

If multiple coding agents run browser QA simultaneously, they must not share the same
Chrome instance — they would overwrite each other's tabs, cross-contaminate console
messages, and fight over session state.

The current setup solves this: the testing Chrome on port 9222 is dedicated to one
agent. Other agents should either:
- Use `--extension` mode to connect to the user's main Chrome (different instance).
- Launch their own testing Chrome on a different CDP port with a different profile.
- Stagger their QA runs so only one agent does browser testing at a time.

To create additional isolated testing Chrome instances, clone the profile to a new
directory and launch with a different `--remote-debugging-port`:

```bash
cp -R ~/Library/Application\ Support/Google/Chrome-LayerNorm-Testing \
  ~/Library/Application\ Support/Google/Chrome-LayerNorm-Testing-2
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome-LayerNorm-Testing-2" \
  --profile-directory="Default" \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-features=CalculateNativeWinOcclusion \
  --remote-debugging-port=9223 \
  --no-first-run \
  --no-default-browser-check &
```

## Tool reference

The server exposes these tools (names may vary slightly by version; always call the agent's
`mcp_list_tools` / equivalent first):

| Tool | What it does |
| --- | --- |
| `browser_navigate` | Go to a URL. Returns the page title, console state, and a snapshot. |
| `browser_snapshot` | Capture the full accessibility tree of the current page. Returns YAML. |
| `browser_take_screenshot` | Take a PNG/JPEG/WebP screenshot of the current page or a specific element. Use when the model supports vision. |
| `browser_find` | Search the accessibility snapshot for text or a regex. Cheaper than a full snapshot. |
| `browser_click` | Click an element by its `ref` from the snapshot. |
| `browser_type` | Type into an input by `ref`. |
| `browser_fill_form` | Fill multiple form fields in one call. |
| `browser_press_key` | Press a keyboard key. |
| `browser_evaluate` | Run JavaScript in the page. Use for header checks, HTML inspection, fetch calls. |
| `browser_console_messages` | Read console output. Pass `all: true` for the full session, `level: "error"` for errors only. |
| `browser_close` | Close the browser. |

## Workflow patterns

### 1. Staging QA (default — always use staging)

After merging your feature branch to `staging` and pushing:

1. Wait for the Vercel deployment to reach `READY` (use the Vercel MCP or poll the API).
2. `browser_navigate` to `https://staging.getoverlay.io/route`. The Chrome extension's SSO
   cookies let the browser through Vercel Deployment Protection.
3. `browser_snapshot` (or `browser_find` for a specific string) to confirm the page rendered.
4. `browser_console_messages` with `level: "error"` to check for new errors.
5. If testing interactivity, `browser_click` elements by their `ref` from the snapshot.
6. For authenticated routes, the user's session cookie is already present. For
   unauthenticated tests, use `browser_evaluate` to call `fetch('/api/auth/sign-out')` first.

**Never use `npm run dev` for browser QA.** It freezes the user's machine. Always test on
staging. If you need to verify a route before merging to staging, ask the user first.

Keep one Playwright MCP server/client connection alive for the entire QA run. Re-launching
extension-mode MCP for each browser command repeatedly connects to and disconnects from the
user's Chrome profile and can open extra welcome tabs. Reuse the same connection across
navigations and checks; when temporarily idle, park its page on `about:blank` instead of
closing and reconnecting it.

### 2. Verifying PPR static shells

Cache Components + Partial Prefetching means the static shell should be in the HTML before
the dynamic content streams in. To verify:

```javascript
// browser_evaluate
async () => {
  const res = await fetch('https://staging.getoverlay.io/app/chat', { credentials: 'include' });
  const html = await res.text();
  return {
    status: res.status,
    hasLoadingShell: html.includes('app-brand-loader'),  // AppShellLoadingFallback
    hasDynamicContent: html.includes('New conversation'), // streams in later
  };
}
```

If `hasLoadingShell` is `true` and `hasDynamicContent` is `false`, PPR is working — the
static shell is served from the CDN and the dynamic content streams in via Suspense.

### 3. Verifying `<Activity>` UI state preservation

Next.js `<Activity>` preserves UI state (sidebar collapse, open panels) across navigations
when Cache Components is enabled. To test:

1. `browser_navigate` to `/app/chat`.
2. `browser_snapshot` to find the "Collapse sidebar" button ref.
3. `browser_click` that ref.
4. `browser_click` a different nav item (e.g. "Files").
5. `browser_click` back to "Chats".
6. `browser_find` "Expand sidebar" — if found, the collapsed state was preserved.

### 4. Checking security headers

```javascript
// browser_evaluate
async () => {
  const res = await fetch(url, { credentials: 'include' });
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return {
    csp: headers['content-security-policy'] ? 'present' : 'missing',
    xContentType: headers['x-content-type-options'],
    xFrame: headers['x-frame-options'],
    referrerPolicy: headers['referrer-policy'],
  };
}
```

### 5. Vision-assisted QA

Playwright MCP works well with accessibility snapshots, but `browser_take_screenshot` returns a real image. If the model running the QA session supports vision, **absolutely include screenshots in tool calls for visual analysis as well** — do not rely on the accessibility tree alone. Vision analysis catches layout shifts, broken images, loading states, theme problems, and visual regressions that text snapshots cannot.

Use `browser_take_screenshot` after `browser_navigate` and after interactions that change the visible state, so the vision model can verify the rendered page in the same tool-call flow. Continue to use `browser_snapshot` for finding click targets; screenshots are for verification and analysis, not for driving actions.

## Gotchas

- **Use staging as the canonical QA target.** Browser testing for this repo should run against `https://staging.getoverlay.io`, after the `staging` Vercel deployment is ready and the matching Convex dev deployment has been pushed. Do not treat a direct Vercel deployment URL as the normal test environment; use one only when diagnosing a staging cache or deployment issue.
- **Backgrounded tabs no longer stall.** The testing Chrome is launched with
  `--disable-background-timer-throttling` and related flags (see
  [Background tab throttling](#background-tab-throttling)). Pages load fully in
  background tabs without needing to be focused. If you see a page stuck on the
  loading shell, check that the testing Chrome was launched via
  `~/.config/devin/launch-chrome-testing.sh` (not a normal Chrome launch).
- **Snapshot refs are ephemeral.** Every `browser_navigate` or `browser_click` invalidates
  previous refs. Call `browser_snapshot` again before clicking.
- **Console errors persist across navigations.** Use `browser_console_messages` with
  `all: false` to get only errors since the last navigation, or `all: true` for the full
  session. The `vercel.live` CSP error is pre-existing and expected on staging — filter it
  out when checking for new errors.
- **Dev server validation insights are dev-only.** Next.js Cache Components shows
  instant-navigation validation warnings in the dev overlay and console. These do not appear
  in production (staging). Since agents should not run `npm run dev`, this is informational
  only — staging is the source of truth for real behavior.
- **`browser_click` requires a `target` ref.** The `element` parameter is a human-readable
  description for permission; the `target` must be the exact ref string from the snapshot
  (e.g. `f12e10`).
- **Killed dev servers leave stale console errors.** If a localhost dev server was
  previously running and has been killed, the browser console may still show WebSocket
  connection failures from the dead localhost. These are not staging errors — filter by URL.
  (This should not happen if agents follow the rule of only testing on staging.)
- **SSO cookies expire.** If `browser_navigate` to staging redirects to a Vercel auth page,
  the testing Chrome's cloned session has expired. Re-clone the profile from the user's
  main Chrome (`Profile 6`) or ask the user to log in to staging in the testing Chrome
  window directly.
- **Chrome-extension IndexedDB noise.** Errors like `InvalidStateError: Failed to execute
  'transaction' on 'IDBDatabase'` from `chrome-extension://…` (often volume / password
  managers) are not Overlay bugs. Filter console noise to app origins before treating them
  as regressions.
- **Convex query auth cannot `fetch()` JWKS.** Browser→Convex room subscriptions must use
  HS256 tokens from `/api/auth/convex-token`. If console shows
  `Can't use fetch() in queries and mutations` from `watchRoomMessages`, the browser is
  still sending a WorkOS JWT or an old client bundle is cached — hard-refresh after deploy.
- **PPR/edge cache can serve a stale app shell after a Vercel redeploy.** If the page stays
  on "Loading overlay" and console shows API calls to a previous `overlay-web-staging-*.vercel.app`
  deployment URL, the shell is pinned to an old build. A hard-refresh (`location.reload(true)`) or
  a query-string cache-bust (`?cb=<random>`) may not clear it. In that case, open the direct
  deployment URL in the same Chrome profile and sign in, or wait for the CDN/edge cache to expire.
