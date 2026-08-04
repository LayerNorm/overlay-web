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

Local `npm run dev` + `curl` only proves the server responded. It does not prove:

- The page actually rendered (React hydrated, no client crash).
- The static shell painted before the dynamic content streamed in (PPR / Cache Components).
- `<Activity>` UI state (sidebar collapse, theme, open panels) persisted across navigations.
- Console errors did not appear (CSP violations, hydration mismatches, 401 race conditions).
- Security headers are present on the response (CSP, X-Frame-Options, etc.).
- Redirects fired correctly for authenticated vs. unauthenticated users.

The Playwright MCP server gives the agent a headed Chromium instance it can drive through the
same tools a human tester would use: navigate, click, type, read the accessibility snapshot,
read console messages, and evaluate JavaScript in the page.

## Installation

### Prerequisites

- Node.js 20+ and `npx` available on the machine the agent runs on.
- The Playwright MCP server launches its own Chromium; you do not need a system Chrome.
  However, the user already has the **Playwright MCP Chrome extension** installed in their
  Chrome profile, which allows the MCP to reuse that profile's cookies (for SSO-protected
  staging environments). The extension token is in the env block below.

### Devin (already configured)

The MCP is already registered in `~/.config/devin/mcp_config.json`:

```json
{
  "mcp-playwright": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@latest", "--extension"],
    "env": {
      "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "<token from Chrome extension>"
    }
  }
}
```

Devin agents can call `mcp-playwright` tools directly — no extra setup.

### Claude Code

Add the same server to `~/.claude/claude_desktop_config.json` (or the project-level
`.mcp.json`):

```json
{
  "mcpServers": {
    "mcp-playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--extension"],
      "env": {
        "PLAYWRIGHT_MCP_EXTENSION_TOKEN": "<token from Chrome extension>"
      }
    }
  }
}
```

Restart Claude Code after editing the config. Verify with `mcp__list_tools` (or the
equivalent in the Claude Code UI).

### Windsurf

Windsurf reads MCP servers from `~/.codeium/windsurf/mcp_config.json`. Add the same
`mcp-playwright` block. Windsurf's MCP panel (Settings → MCP Servers) should show it as
connected after restart.

### Codex (OpenAI)

Codex CLI reads MCP servers from `~/.codex/config.toml`. Add:

```toml
[mcp_servers.mcp-playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--extension"]

[mcp_servers.mcp-playwright.env]
PLAYWRIGHT_MCP_EXTENSION_TOKEN = "<token from Chrome extension>"
```

### Generic / other agents

Any agent that speaks the Model Context Protocol can use this server. The minimal config is:

- **Command:** `npx -y @playwright/mcp@latest --extension`
- **Env:** `PLAYWRIGHT_MCP_EXTENSION_TOKEN` set to the token shown in the Playwright MCP
  Chrome extension popup.

If the agent does not support the `--extension` mode (no Chrome profile to reuse), drop
`--extension` and the server will launch a clean Chromium instead. You will then need to
handle SSO auth manually (see below).

## The `--extension` flag and SSO-protected environments

`staging.getoverlay.io` and `www.getoverlay.io` are behind Vercel Deployment Protection
(SSO). A clean Chromium instance has no session cookie and will be redirected to the Vercel
auth page. The `--extension` flag tells the MCP to connect to the user's existing Chrome
profile via the Playwright MCP browser extension, reusing their SSO cookies. This is why
the extension token is required in the env block.

If you are testing a local dev server (`http://localhost:PORT`), the extension flag is not
needed — there is no SSO. But it does not hurt to leave it on.

## Tool reference

The server exposes these tools (names may vary slightly by version; always call the agent's
`mcp_list_tools` / equivalent first):

| Tool | What it does |
| --- | --- |
| `browser_navigate` | Go to a URL. Returns the page title, console state, and a snapshot. |
| `browser_snapshot` | Capture the full accessibility tree of the current page. Returns YAML. |
| `browser_find` | Search the accessibility snapshot for text or a regex. Cheaper than a full snapshot. |
| `browser_click` | Click an element by its `ref` from the snapshot. |
| `browser_type` | Type into an input by `ref`. |
| `browser_fill_form` | Fill multiple form fields in one call. |
| `browser_press_key` | Press a keyboard key. |
| `browser_evaluate` | Run JavaScript in the page. Use for header checks, HTML inspection, fetch calls. |
| `browser_console_messages` | Read console output. Pass `all: true` for the full session, `level: "error"` for errors only. |
| `browser_close` | Close the browser. |

## Workflow patterns

### 1. Local dev server QA

After starting `npm run dev` (or `./scripts/dev-setup.sh <port>`) in a background shell:

1. `browser_navigate` to `http://localhost:PORT/route-under-test`.
2. `browser_snapshot` (or `browser_find` for a specific string) to confirm the page rendered.
3. `browser_console_messages` with `level: "error"` to check for new errors.
4. If testing interactivity, `browser_click` elements by their `ref` from the snapshot.
5. For PPR / Cache Components: use `browser_evaluate` to `fetch()` the route and check
   whether the static shell text is present in the raw HTML before hydration.

### 2. Staging QA after a push

After merging to `staging` and pushing:

1. Wait for the Vercel deployment to reach `READY` (use the Vercel MCP or poll the API).
2. `browser_navigate` to `https://staging.getoverlay.io/route`. The Chrome extension's SSO
   cookies let the browser through Vercel Deployment Protection.
3. Verify rendering, console, headers, and interactivity as above.
4. For authenticated routes, the user's session cookie is already present. For
   unauthenticated tests, use `browser_evaluate` to call `fetch('/api/auth/sign-out')` first.

### 3. Verifying PPR static shells

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

### 4. Verifying `<Activity>` UI state preservation

Next.js `<Activity>` preserves UI state (sidebar collapse, open panels) across navigations
when Cache Components is enabled. To test:

1. `browser_navigate` to `/app/chat`.
2. `browser_snapshot` to find the "Collapse sidebar" button ref.
3. `browser_click` that ref.
4. `browser_click` a different nav item (e.g. "Files").
5. `browser_click` back to "Chats".
6. `browser_find` "Expand sidebar" — if found, the collapsed state was preserved.

### 5. Checking security headers

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

## Gotchas

- **Snapshot refs are ephemeral.** Every `browser_navigate` or `browser_click` invalidates
  previous refs. Call `browser_snapshot` again before clicking.
- **Console errors persist across navigations.** Use `browser_console_messages` with
  `all: false` to get only errors since the last navigation, or `all: true` for the full
  session. The `vercel.live` CSP error is pre-existing and expected on staging — filter it
  out when checking for new errors.
- **Dev server validation insights are dev-only.** Next.js Cache Components shows
  instant-navigation validation warnings in the dev overlay and console. These do not appear
  in production (staging). Check both environments — dev for insights, staging for real
  behavior.
- **`browser_click` requires a `target` ref.** The `element` parameter is a human-readable
  description for permission; the `target` must be the exact ref string from the snapshot
  (e.g. `f12e10`).
- **Killed dev servers leave stale console errors.** If you kill a localhost dev server and
  then navigate to staging, the browser console still shows WebSocket connection failures
  from the dead localhost. These are not staging errors — filter by URL.
- **SSO cookies expire.** If `browser_navigate` to staging redirects to a Vercel auth page,
  the Chrome extension's session has expired. Ask the user to refresh the extension by
  opening Chrome and visiting `staging.getoverlay.io` once.
