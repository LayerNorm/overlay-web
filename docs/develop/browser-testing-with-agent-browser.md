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
