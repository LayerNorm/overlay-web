# Docs restructure: User help, Self-hosting, Developer

Status: phases 1 (disable desktop and mobile) and 2 (restructure into tabs) implemented 2026-10-22; phases 3–6 in progress.

## Why

The public docs at `getoverlay.io/docs` (Mintlify, `docs/`) have drifted from the product:

- **Wrong front door.** The home page shows the web/server source, the Desktop source, the Desktop download and the Desktop docs. A user looking for help on chats or agents gets developer and desktop material first.
- **Unavailable apps.** The Desktop section is 18 pages, last touched 2026-07-25, built around "Gate B". The landing page, footer, `/download`, the account page and the profile menu also offer macOS, Windows, iOS and Android, and none of them ships.
- **Help is behind the product.**
  - `help/projects` documents Projects, which were removed on 2026-09-17.
  - `help/files` and `help/memory` send people to a Knowledge panel and a Memory panel that no longer exist; memories now live in Settings → Memories.
  - `help/chat` describes Ask and Act modes and "open a project".
  - **Work**, the first item in the app's navigation, has no page at all, and neither do Extensions, channels and DMs, or plans and credit.
- **Self-hosting contradicts itself.** `deploy-operate/self-hosting.mdx` (554 lines) still describes a "Postgres mode" and pgvector, but the Convex-only decision (2026-09-18) deleted that path. Setup is spread across Configure, Deploy & Operate, Legal and Start, so there is no single path from zero to a running instance.
- **Internal process is published.** `develop/` puts our own release process, merge queue, preview QA, Convex deploy lanes and admin console on the public site, next to `deploy-operate/overlay-free` (free-model quarantine internals) and `docs-hosting`. These are maintainer notes rather than docs for customers, and AGENTS.md says the repo should hold no infrastructure internals.
- **No real developer docs.** MCP, our most usable integration surface, is only half-covered in a user help page that points at `internal/develop/mcp-access.md`. Personal tokens and webhooks are not documented, and the API reference is an unfiltered dump of every `/api/v1` route.
- **Visuals don't match the site.** The docs use a serif heading face, an `#09090b` near-black and a stock Mintlify chrome. The landing page uses Geist at weight 500 with tight tracking, `#111111` in dark mode, hairlines and mono eyebrows.

## The new shape

Use three top-level Mintlify **tabs**, each with its own sidebar. Search spans all three. The docs home becomes a short page with one card per tab.

### 1. Help (default tab, for people using Overlay)

Write it from the current app (`DEFAULT_OVERLAY_NAVIGATION` and `DEFAULT_OVERLAY_SETTINGS_SECTIONS`), in plain language with no repo paths.

| Group | Pages |
| --- | --- |
| Get started | What Overlay is · Sign up and your first workspace · Personal vs team workspace · Invite people |
| Work | Tasks, board and timeline · Assigning work to agents · Approvals ("Needs you") |
| Agents | Overlay agents · Claude Code and Codex agents · Agents asking agents · Agent computers |
| Chats | DMs, channels and group chats · Models and the model picker · Attachments · Tool calls and approvals |
| Files and notes | Upload and search · Notes · Sharing |
| Extensions | Connected apps · Skills · Your own MCP servers |
| Automations | Create, test, history |
| Account | Memories · Plans, credit and top-ups · Settings tour · Connect ChatGPT, Claude and others (user side of MCP) |
| Trust | Privacy and your data · Troubleshooting · FAQ |

### 2. Self-hosting (for operators running their own instance)

| Group | Pages |
| --- | --- |
| Overview | When to self-host vs managed · What you run (Next app + Convex backend + auth) · Requirements |
| Install | One-command install (`overlayctl`) · Docker on one host · AWS reference architecture · Self-hosted Convex |
| Configure | `overlay.config.json` · Environment variables · Model providers · Authentication (overview, OIDC, Google Workspace, Auth0, generic OIDC, Better Auth) · Search and embeddings |
| Operate | Upgrades and rollback · Backups and restore · Security checklist · Release verification |
| Enterprise | Managed single-tenant · Tenancy · Compliance · Admin onboarding |
| Licensing | License · Self-hosting obligations |

Split the 554-line `self-hosting.mdx` across Overview and Configure, and delete every Postgres-mode and pgvector passage. Fold `release-gates` (the operator-facing half) into Release verification.

### 3. Developer (for people building on Overlay)

| Group | Pages |
| --- | --- |
| Overview | Ways to build: MCP, REST API, webhooks, your own agent |
| Authentication | Personal tokens · API keys · OAuth for MCP clients |
| MCP | Connect a client · Access levels · Tools and skills · Limits and approvals |
| REST API | Overview and errors · Guides (conversations, files, automations, billing) · Reference (generated, **stable routes only**) |
| Webhooks | Events, signing, retries |
| Bring your own agent | Agent Host (`@layernorm/overlay-agent-host`) and the bridge protocol, once published |
| Contribute | Run Overlay locally · Repository map · Architecture (short public version) |
| Security | Reporting a vulnerability |

Changelog stays as one top-level page, written for users. It should also feed the marketing `/changelog` placeholder rather than living in two places.

## Page-by-page disposition (87 files today)

| Today | Action |
| --- | --- |
| `desktop/*` (18) | Delete. Redirect `/docs/desktop/*` to the Help home. |
| `introduction`, `start/quickstart`, `start/repository-map` | Rewrite the introduction as the three-card home. Move the other two to Developer → Contribute. |
| `help/*` (12) | Rewrite against the current app. Delete `projects`. Split `connect-other-apps` into a user page and Developer → MCP. |
| `configure/*` (10) | Move to Self-hosting → Configure. Rename `knowledge-bases` to "Search and embeddings". |
| `deploy-operate/*` (17) | Move to Self-hosting. Move `overlay-free` and `docs-hosting` to `internal/develop/`. Split `self-hosting.mdx`. |
| `develop/release-workflow`, `agentic-development`, `worktree-staging-qa`, `convex-workflow`, `admin-console`, `api-source-of-truth`, `customization`, `feature-modules`, both route catalogs | Move to `internal/develop/` (maintainer docs). Update the AGENTS.md living-doc table and `check-docs-health.ts` paths in the same change. |
| `develop/architecture`, `develop/local-integrations` | Trim to a public Contribute version. The full version moves to `internal/develop/`. |
| `api-reference/*` | Move under Developer. Filter the OpenAPI output to stable routes, and exclude admin, extension proxy, internal and auth-callback routes. |
| `legal/*` | Licensing goes to Self-hosting. Security reporting goes to Developer. Terms and privacy stay on the marketing site only. |

Add `redirects` in `docs.json` for every moved or deleted path, because links in the app, emails and search results point at them.

## Disable desktop and mobile

Hide them without deleting the auth plumbing, so existing builds and the App Store deletion flow keep working.

| Surface | Change |
| --- | --- |
| `docs/desktop/*`, intro cards | Removed (above). |
| Landing "Accessible from anywhere" (`LandingSections.tsx`) | Platform chips become Web, Slack, Microsoft Teams, ChatGPT, Claude, Cursor. Copy changes to "the web and the apps you already use". |
| Landing "Get Overlay" columns | Drop the Desktop and Mobile columns. Keep Web, and Developer (MCP, API) with real docs links. |
| `MarketingFooter` "Download" link, `sitemap.ts` `/download` | Remove. |
| `/download` page | Redirect to `/home`. Keep `DesktopDownloadPage` and the release policy code behind the existing `downloadsEnabled` flag for when desktop returns. |
| Account page `DesktopAppSection` | Hide. |
| Profile menu `PROFILE_APP_LINKS` (Desktop App, Mobile App, Chrome Extension) | Remove. They have no links today. |
| Keep as-is | `/api/auth/desktop-link`, `/auth/mobile-complete`, `mobile-auth-client`, `?delete=1` deep link in `DeleteAccountSection`. |

## Visual refresh

Mintlify keeps search, the OpenAPI playground and `llms.txt`, so retheme it rather than rebuilding the docs in Next. The change is `docs.json` plus `style.css`:

- **Type:** Geist for headings and body via `fonts`, headings at weight 500 with tight tracking (`-0.025em`), and no serif headings. The serif stays only inside the `BrandLockup` SVG logo.
- **Colors:**
  - Background `#ffffff` light and `#111111` dark.
  - `primary` `#171717`, with dark-mode buttons `#2a2a2a` and light text.
  - Links `#2563eb` light and `#60a5fa` dark.
  - Hairlines `#ebebeb` light and `#232323` dark.
- **Sidebar:** panel background `#f7f7f7` light and `#171717` dark, matching the app sidebar. Group titles use the landing `.eyebrow` style (mono, uppercase, small, muted). The active item gets a soft panel fill instead of a colored bar.
- **Content:** cards, callouts and code blocks become hairline panels with no shadows. Tables get hairline rows only. Use Lucide icons on cards, and no emoji.
- **Navbar:** Pricing, Blog, a GitHub icon (the svgl mark) and an "Open app" button, matching the landing nav. The logo stays the `OverlayMark` + wordmark lockup.
- **Home:** an `.h1`-scale title, one sentence, and three cards (Help, Self-hosting, Developer), like the landing page head.

Before rolling the theme out, check it in `npm run docs:dev` at desktop and phone widths in both themes, and compare it with `/home`.

## Phases

1. **Disable desktop and mobile.** Do the web-app changes and delete `docs/desktop` with redirects. This step is small, can ship alone, and fixes the false promises right away.
2. **Restructure.** Move files into `docs/help`, `docs/self-hosting` and `docs/developer`, set up the tabs and redirects, move the internal docs to `internal/develop`, and update AGENTS.md and `check-docs-health.ts`. Content stays as-is in this step.
3. **Visual refresh.** Change `docs.json` and `style.css`, and build the new home page.
4. **Rewrite Help** against the current app, with screenshots from the PR preview.
5. **Write Developer:** MCP, auth tokens, webhooks, and the filtered OpenAPI.
6. **Clean up Self-hosting:** split `self-hosting.mdx`, remove the Postgres passages, and add backups and upgrades.

Each phase is its own PR with `npm run docs:check` passing.

## Open decisions

- Tabs vs Mintlify's product switcher for the three docs. Tabs are the safe default.
- Whether the Chrome extension also counts as unavailable. The plan assumes yes and removes it from the profile menu.
- Whether Contribute stays public or moves entirely to the GitHub README.
