# Chrome extension

The Overlay Chrome extension (`apps/chrome`) is a side panel that frames the web app, the way
the desktop app loads it. Everything in the panel (sign-in, chats, agents, files, settings,
models) is the web app; the extension adds only what a web page cannot do on its own, over a
small `postMessage` bridge. Plan and remaining phases: `internal/plans/CHROME_EXTENSION_PARITY_PLAN.md`.

## Pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Side panel page | `apps/chrome/sidepanel.html`, `src/sidepanel/main.ts` | Frames `<APP_ORIGIN>/app` full-bleed and answers bridge requests from that frame only |
| Bridge answers | `apps/chrome/src/sidepanel/bridge.ts` | Reads the tab next to the panel, only when the app asks |
| Service worker | `apps/chrome/src/background/index.ts` | Opens the panel from the toolbar button |
| Bridge contract | `packages/overlay-chrome-bridge` (`@overlay/chrome-bridge`) | Extension id and origin, message types and parsers, page-text limit, the attached file's format |
| Web side | `src/components/chrome/chrome-extension.ts` | `isChromeExtensionFrame`, bridge requests, `navigateToExternalFlow`, `CHROME_HOME_PATH` |
| Signed-out home | `src/app/auth/chrome/` | Sign-in opens in a normal tab; the panel polls the session and opens the app |
| Add this page | `ChromePageAttachItem` in `src/features/chat/components/ChatComposerAttachMenuItems.tsx` | + menu row that attaches the current tab as a Markdown file |

## Decisions

- **Frame the web app instead of porting it.** A native side panel had to chase every web
  change (it stopped building when `MessageList` was removed). Framing gives parity for free.
- **Fixed extension id.** The manifest `key` pins the id `hcbjdhncedoncldgcodomajeogigipml`
  (`CHROME_EXTENSION_ID`, checked by `apps/chrome/tests/manifest.test.ts`). Only the public
  key is committed; unpacked builds need no private key. The Chrome Web Store id (Phase 5)
  must be added to `CHROME_EXTENSION_FRAME_ANCESTORS`.
- **Framing.** `src/proxy.ts` sends `frame-ancestors 'self' chrome-extension://<id>`. When the
  full policy is report-only (development), a separate enforced policy carries just that
  directive, because CSP `frame-ancestors` is what makes browsers ignore the static
  `X-Frame-Options: SAMEORIGIN` header from `next.config.ts`.
- **Session.** The framed app uses the normal `overlay_session` cookie. Chrome treats a frame
  inside an extension page as first-party when the extension has host permission for that
  site: the `SameSite=Lax` cookie is sent and storage is not partitioned. Without host
  permission the cookie is dropped, which is why the manifest keeps `https://*/*` and
  `http://*/*` (verified in Chromium on 2026-11-28). Sign-in cannot run framed (WorkOS
  refuses framing), so `/auth/chrome` opens it in a tab.
- **Leaving Overlay.** Stripe Checkout and the billing portal, the GitHub App and Slack install
  refuse framing. Call sites use `navigateToExternalFlow(url)`, which opens a new tab inside
  the panel and navigates normally elsewhere. Use it for any new full-page redirect to another
  site.
- **The app asks; the extension never pushes.** The bridge only answers `page.current` and
  `page.context` from the framed app's exact origin and window, so the app never sees the
  person's browsing unless they open the + menu or choose "Add this page". Page text is capped
  at `PAGE_TEXT_LIMIT` (60,000 characters); Chrome's own pages are never read.
- **Minimal permissions.** `sidePanel`, `scripting` and host access. No content scripts, no
  `externally_connectable`, no `tabs`, `storage` or `debugger`. Later phases add only what
  they use.

## Building and testing

- `bun run check` in `apps/chrome` (typecheck, Vitest, Vite build to `dist/`), plus
  `bun run --cwd packages/overlay-chrome-bridge test`. CI: the `Chrome extension` workflow.
- The build frames `https://overlay.works` by default. For preview QA or local work build with
  `VITE_OVERLAY_APP_ORIGIN=https://pr-<n>.preview.overlay.works bun run build` (or
  `http://localhost:3000`), then load `apps/chrome/dist` unpacked from `chrome://extensions`.
  Any other `http:` origin is refused.
- Branded Chrome no longer accepts `--load-extension`; automated checks use Playwright's
  Chromium with `launchPersistentContext` and `--load-extension=apps/chrome/dist`. An extension
  page opened as a tab (`chrome-extension://<id>/sidepanel.html`) behaves like the panel.
