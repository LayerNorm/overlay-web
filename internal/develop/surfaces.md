# Overlay surfaces in one repository

Every Overlay surface lives in this repository. The web app and its backend are
authoritative: `src/` and `convex/` define the product and its data, `packages/`
holds the code the surfaces share, and each other surface is a client of the same
backend.

| Surface | Folder | Stack | What it is |
| --- | --- | --- | --- |
| Web + backend | repository root (`src/`, `convex/`) | Next.js, Convex | The product, the `/api/v1` surface every client uses, and all durable state |
| Operator console | `apps/admin` | Next.js | `admin.overlay.works`; see `admin-console.md` |
| Desktop | `apps/desktop` | Electron | Mac app that loads the web app and adds OS integrations; see `desktop-web-shell.md` |
| Mobile | `apps/mobile` | Expo / React Native | iOS app with native screens over the same backend |
| Chrome extension | `apps/chrome` | Vite, MV3 side panel | Browser side panel chat with tab context and approvals |

## Rules

- **Shared code is imported, never copied.** A contract or component more than one
  surface needs goes in `packages/*` (or `src/shared/*` when it is web-isomorphic) and
  each app imports it. The desktop links `@overlay/desktop-bridge` from
  `packages/overlay-desktop-bridge`; mobile and Chrome import `packages/overlay-chat-*`,
  `packages/overlay-api-client` and friends by path. `scripts/ci/desktop-web-shell-boundary.mjs`
  fails if the desktop keeps its own copy of a shared package.
- **The backend changes first and once.** A feature lands in `convex/` and `/api/v1`, then
  each surface's UI uses it. Surfaces never talk to provider SDKs or Convex internals the web
  BFF owns (`check:no-direct-backend` in mobile, `check:no-provider-sdks` in desktop).
- **One change, every surface.** When a change alters a shared package, an API contract or
  a feature that exists on several surfaces, update the other surfaces in the same change or
  record the gap in the parity table below.
- **Paths from an app to the root go through `../../`.** Each app sits two levels below the
  repository root.

## Building, testing and releasing

| Surface | Install | Checks | CI workflow (runs when) | Release |
| --- | --- | --- | --- | --- |
| Web | `npm ci` at the root | `npm run lint`, `npm run typecheck`, `npm test` | `Security Checks` (every PR and merge group; required) | Native Vercel Git deployment from `main` |
| Desktop | `npm ci` in `apps/desktop` (self-contained) | `npm run lint && npm test && npm run build`, `npm run test:e2e` | `Desktop app` (`apps/desktop/**`, the bridge package) on macOS | `Desktop release (macOS)`: manual, from one full source SHA; publishes `desktop-v<version>` to this repository's Releases |
| Mobile | root `npm ci` + agent package builds, then `npm ci` in `apps/mobile` | `npm run check`, `node scripts/lint-mobile.cjs`, node tests, `npm run test:native-transcript`, `expo export` + asset verification | `Mobile app` (`apps/mobile/**`) | EAS Build from `apps/mobile`; its `eas-build-pre-install` hook installs the root workspace |
| Chrome | root `npm ci`, then `npm ci` in `apps/chrome` | `npm run check` | `Chrome extension` (`apps/chrome/**`) | Built `dist/` loaded unpacked; no store release yet |

- Root lint (`eslint.config.mjs` ignores `apps/**`), typecheck (`tsconfig.json` excludes
  `apps`), the test runner (`scripts/ci/run-all-tests.mjs` skips `apps/desktop|mobile|chrome`),
  Docker and Vercel uploads (`.vercelignore`) leave the other apps to their own workflows.
- Root `npm` workspaces are `packages/*` and `apps/admin`. Desktop, mobile and Chrome keep
  their own lockfiles; joining one root install is a planned later step.
- **Web deploys skip other-app commits.** `vercel.json` runs `scripts/vercel-ignore-build.sh` as the `web` service's `ignoreCommand` (a top-level one is rejected when `services` is set):
  a production commit that only changes `apps/desktop`, `apps/mobile`, `apps/chrome` or
  `CHANGELOG.md` skips the web build. Preview builds always run. Anything shared builds.
- **Desktop updates.** Installed Mac apps ask this repository's *latest* GitHub release for
  `latest-mac.yml`. Desktop releases are therefore the only releases marked latest here; any
  other release must be created as a prerelease or with `--latest=false`. The workflow needs
  the `mac-release` environment (Apple signing and notarization secrets, `SENTRY_DSN`) and the
  `release-publish` environment.
- **Mobile EAS builds** upload the repository from the root and build `apps/mobile`. Mobile's
  `scripts/prepare-eas-workspace.cjs` refuses to run outside the monorepo, so a mobile build
  always uses the same shared code as web at that commit.

## Known gaps

- Mobile's node and DOM transcript suites have failures against current web (20 and 18
  tests). They predate the monorepo: mobile's old repository tested against a pinned,
  older web commit. The mobile workflow therefore only runs on `apps/mobile/**` changes
  until the suite is green, then widens to `packages/**`, `src/shared/**` and `convex/**`.
- The Chrome side panel imports `MessageList`, which `@overlay/chat-react` no longer
  exports, and its React types are older than the root's, so the extension does not
  typecheck or build. Its workflow runs only on `apps/chrome/**` until it is ported.

## Feature parity

Update this table when a feature lands on, or is removed from, any surface. "Web" means
the desktop app too: it renders the web app, adding only the native rows marked below.

| Feature | Web / Desktop | Mobile | Chrome |
| --- | --- | --- | --- |
| Agents and agent threads | Yes | Yes | No |
| Chats (personal) | Yes | Yes | Side panel chat |
| Rooms, channels and DMs | Yes | Yes | No |
| Work (tasks) | Yes | Yes | No |
| Files, notes and memories | Yes | Yes | No |
| Automations | Yes | Yes | No |
| Extensions / tools and MCP | Yes | Yes (Tools) | No |
| Workspace and Personal modes | Yes | Yes | No |
| Voice input | Desktop dictation | Yes | No |
| Browser tab context and actions | No | No | Yes |
| This Mac (local computer), private threads, first-run setup | Desktop only | No | No |
