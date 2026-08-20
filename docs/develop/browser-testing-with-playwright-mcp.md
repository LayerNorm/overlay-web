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
- A dedicated testing Chrome instance with a cloned LayerNorm profile (see
  [Creating a testing Chrome profile](#creating-a-testing-chrome-profile) below).
  This profile has the SSO cookies needed to access `staging.getoverlay.io` without
  manual login.

### MCP configuration (all agents)

The Playwright MCP server connects to a dedicated testing Chrome instance via CDP
(not the user's main Chrome), so agent browser QA never interferes with the user's
browsing. Each agent connects to a specific CDP port that corresponds to its own
testing Chrome instance:

```json
{
  "mcp-playwright": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
  }
}
```

For a second concurrent agent, use port `9223` and launch a second testing Chrome
(see [Multi-agent isolation](#multi-agent-isolation)).

The testing Chrome instance must be running before Playwright MCP tools can be
used. To launch it:

```bash
bash ~/.config/devin/launch-chrome-testing.sh
```

If the script reports the instance is already running, it is safe to proceed —
the CDP port is already listening.

Agent-specific config locations:

| Agent | Config file |
| --- | --- |
| Devin | `~/.config/devin/mcp_config.json` |
| Claude Code | `~/.claude/claude_desktop_config.json` or project `.mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Codex | `~/.codex/config.toml` |

For Codex (TOML format):

```toml
[mcp_servers.mcp-playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
```

Restart the agent after editing the config.

## Creating a testing Chrome profile

A testing Chrome profile is a regular Chrome profile that lives inside the
user's main Chrome user-data-dir alongside their other profiles. It has the
LayerNorm SSO cookies copied into it so the agent can access staging without
needing a separate Chrome instance.

This approach avoids all the problems with separate `--user-data-dir` instances:
no dock icon conflicts, no singleton lock issues, no profile merging, and all
profiles are visible in one Chrome window.

### Setup procedure

1. **Create a new profile in Chrome.** Open the profile switcher (top-right),
   click "Add", choose "Continue without an account", and name it "Testing".
2. **Quit Chrome entirely.** All Chrome windows must be closed. Verify with
   `pgrep -f "Google Chrome"` — it should return nothing.
3. **Copy auth/session files from the LayerNorm profile** (e.g., `Profile 6`)
   into the new Testing profile directory (e.g., `Profile 12`):
   ```bash
   SRC="~/Library/Application Support/Google/Chrome/Profile 6"
   DST="~/Library/Application Support/Google/Chrome/Profile 12"
   for file in "Cookies" "Login Data" "Login Data For Account" "Web Data" \
               "Local Storage" "Session Storage" "Network" "TransportSecurity"; do
     cp -R "$SRC/$file" "$DST/$file" 2>/dev/null
   done
   ```
   Do NOT copy `Preferences`, `Secure Preferences`, `Extensions/`, `History`,
   or `Local State` — those are profile-specific settings that should stay
   unique to the Testing profile.
4. **Reopen Chrome.** The Testing profile now has valid SSO cookies for
   staging and production.

### When SSO cookies expire

If `browser_navigate` to staging redirects to a Vercel auth page, the Testing
profile's cloned session has expired. Either:
- Re-copy the auth files from the LayerNorm profile (steps 2-3 above), or
- Ask the user to log in to staging in the Testing profile directly.

## Playwright MCP configuration

Playwright MCP connects to the user's main Chrome via the browser extension
(`--extension` mode). This reuses the Testing profile's SSO cookies. No
separate Chrome instance or CDP port is needed.

```json
{
  "mcp-playwright": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@latest", "--extension"]
  }
}
```

For QA, switch to the Testing profile in Chrome before running
`browser_navigate`. The agent will drive the active tab in that profile.

### Previous approach: separate Chrome instances (deprecated)

An earlier approach used separate `--user-data-dir` Chrome instances with CDP
endpoints. This caused repeated problems:
- Chrome singleton behavior merged the user's main Chrome into testing instances
- Dock icon activated testing Chrome instead of the user's main Chrome
- Profile cloning risked corrupting extensions across all profiles
- Multiple running Chrome processes confused the user's workflow

The in-main-Chrome profile approach above avoids all of these issues. The old
launch scripts (`launch-chrome-testing.sh`, `launch-chrome-testing-2.sh`) and
testing directories (`Chrome-Testing`, `Chrome-Testing-2`) have been removed.

**Important:** Each profile copy is a snapshot at clone time. SSO cookies and
session state diverge over time. If one instance's session expires, re-clone
from the user's main Chrome profile (`Profile 6`) following the safe procedure
(quit Chrome first, copy only the profile directory, do not copy `Local State`).

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

- **NEVER copy a Chrome profile while Chrome is running.** Chrome has anti-cloning
  protections that will disable all extensions across all profiles in the original
  Chrome. Always quit Chrome entirely before cloning a profile. See
  [Creating a testing Chrome profile](#creating-a-testing-chrome-profile) for the
  safe procedure.
- **NEVER copy the main Chrome's `Local State` file into a testing user-data-dir.**
  This is the specific trigger for the anti-cloning protection that wipes extensions.
  Let the testing Chrome generate its own `Local State` on first launch.
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
  main Chrome (`Profile 6`) following the safe procedure in
  [Creating a testing Chrome profile](#creating-a-testing-chrome-profile), or ask the user
  to log in to staging in the testing Chrome window directly.
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
