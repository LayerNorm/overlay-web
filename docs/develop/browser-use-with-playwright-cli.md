# Browser use: playwright-cli + Chrome extension (LayerNorm Profile 6)

How agents drive the user's **real, signed-in Chrome** — the LayerNorm profile
(`Profile 6`). This is the supported path for any task that needs live browser
state: Slack app consoles, staging QA with real sessions, third-party admin UIs.

Do NOT try `--remote-debugging-port` on the default profile — Chrome 136+
silently ignores it. Do NOT use the `mcp-playwright` MCP server — it runs the
same extension underneath but adds a fragile server layer (stdio truncation on
long payloads, stale connections, hung `browser_tabs` calls). The CLI path is
stateless and restartable.

## Pieces

| Piece | Location |
| --- | --- |
| Chrome profile | `~/Library/Application Support/Google/Chrome/Profile 6` |
| Playwright extension | installed in that profile, id `mmlmfjhmonkocbjadbfplnigmagldckm` |
| Extension token | `~/.config/devin/playwright-mcp-extension-token` |
| Wrapper | `~/.config/devin/pw-chrome.sh` |

The token auto-approves the extension connection — no "Allow & select" dialog.
Never print or commit it; it grants access to a fully signed-in browser profile.

## Usage

```bash
# Any playwright-cli command — auto-attaches on first call:
~/.config/devin/pw-chrome.sh goto <url>
~/.config/devin/pw-chrome.sh snapshot          # aria snapshot → element refs
~/.config/devin/pw-chrome.sh eval '() => location.href'
~/.config/devin/pw-chrome.sh tab-list | tab-new <url> | tab-select <i>
~/.config/devin/pw-chrome.sh run-code "$(cat script.js)"
```

`run-code` scripts receive a `page` object and run inside an async function —
`return` a value to print it, `await page.evaluate(...)` for page JS,
`await page.screenshot()` for PNGs (base64 the result back).

## The tab-group consent model

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

## Gotchas (learned the hard way)

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

## The nuclear option: Slack's internal `developer.apps.*` API

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

## Security

- The token file stays local; never print or commit it.
- `page.evaluate` runs in the page's main world with the user's session —
  treat page data (tokens, cookies) as secrets. Redact `token` fields when
  dumping FormData or request bodies.
- The user's tabs are live and signed in; don't navigate their existing tabs
  away — use `tab-new` inside the Playwright group.
