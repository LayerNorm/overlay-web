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
| Chrome extension | `apps/chrome` | Vite, MV3 side panel | Side panel that frames the web app, as desktop loads it, and adds "Add this page"; see `chrome-extension.md` |

## Rules

- **Shared code is imported, never copied.** A contract or component more than one
  surface needs goes in `packages/*` (or `src/shared/*` when it is web-isomorphic) and
  each app depends on it as a workspace package (`"@overlay/…": "workspace:*"`).
  `scripts/ci/desktop-web-shell-boundary.mjs` fails if the desktop keeps its own copy of the
  bridge package.
- **The backend changes first and once.** A feature lands in `convex/` and `/api/v1`, then
  each surface's UI uses it. Surfaces never talk to provider SDKs or Convex internals the web
  BFF owns (`check:no-direct-backend` in mobile, `check:no-provider-sdks` in desktop).
- **One change, every surface.** When a change alters a shared package, an API contract or
  a feature that exists on several surfaces, update the other surfaces in the same change or
  record the gap in the parity table below.
- **Paths from an app to the root go through `../../`.** Each app sits two levels below the
  repository root.

## One install: Bun workspaces

The repository has one install and one lockfile. Bun (`packageManager` in `package.json`,
currently 1.4.5) is the package manager and script runner; every app still runs on its own
runtime (Node.js for Next.js and scripts, Convex's runtime, Electron, Hermes).

- `bun install` at the root installs web, `packages/*` and every app from `bun.lock`.
  Workspaces: `packages/*`, `apps/admin`, `apps/chrome`,
  `apps/desktop`, `apps/mobile`. No app has a lockfile of its own; `apps/desktop/agent-host-bundle`
  keeps an npm lockfile because it pins the published Agent Host the app ships, and
  `examples/` are standalone.
- **Isolated layout** (`bunfig.toml` `linker = "isolated"`): each package sees only the
  dependencies it declares, so mobile keeps Expo's pinned React (19.2.0) beside web's.
  Importing a package you have not declared fails; add it to that workspace's
  `package.json` instead of relying on another workspace's copy.
- The native typechecker (`scripts/ci/typecheck-native.mjs`) is the same Bun, read from `packageManager`.
- **Supply chain:** `minimumReleaseAge` (7 days) in `bunfig.toml`; install scripts run only
  for `trustedDependencies` in `package.json`; CI installs with `--frozen-lockfile`.
  Overrides are top-level only (Bun has no nested or range-keyed overrides): pin a
  vulnerable transitive by overriding the package that depends on it, or by an override of
  the package itself when one version fits everyone.
- **Production audit and licenses** walk `bun.lock` from a workspace's production
  dependencies (`scripts/ci/bun-lock.mjs`): `bun run security:audit` (web),
  `bun scripts/ci/security-audit.mjs --workspace apps/desktop` (desktop),
  `bun run license:check` at the root and in `apps/desktop`. The desktop SBOM comes from the
  same walk.
- npm still publishes `@layernorm/overlay-agent-*` (trusted publishing with provenance);
  `npm pack` and `npm publish` work in the Bun workspace.

## Building, testing and releasing

| Surface | Checks | CI workflow (runs when) | Release |
| --- | --- | --- | --- |
| Web | `bun run lint`, `bun run typecheck`, `node scripts/ci/run-all-tests.mjs` | `Security Checks` (every PR and merge group; required) | Native Vercel Git deployment from `main` (Vercel installs with Bun from `bun.lock`) |
| Desktop | in `apps/desktop`: `bun run lint && bun run test && bun run build`, `bun run test:e2e` | `Desktop app` (`apps/desktop/**`, the bridge package, `bun.lock`) on macOS | `Desktop release (macOS)`: manual, from one full source SHA; publishes `desktop-v<version>` to this repository's Releases |
| Mobile | `bun run --filter '@layernorm/overlay-agent-*' build` once, then in `apps/mobile`: `bun run check`, `node scripts/lint-mobile.cjs`, node tests, `bun run test:native-transcript`, `bunx expo export` + asset verification | `Mobile app` (`apps/mobile/**`, `packages/**`, `src/shared/**`, `src/features/automations/**`, `convex/**`, `bun.lock`) | EAS Build from `apps/mobile`: EAS installs the workspace with Bun (`bun` in `eas.json`); `eas-build-post-install` builds the agent packages and shared Markdown CSS |
| Chrome | in `apps/chrome`: `bun run check`; bridge contract: `bun run --cwd packages/overlay-chrome-bridge test` | `Chrome extension` (`apps/chrome/**`, `packages/overlay-chrome-bridge/**`, `bun.lock`) | Built `dist/` loaded unpacked (frames overlay.works; `VITE_OVERLAY_APP_ORIGIN` selects a preview or localhost); no store release yet |

Every workflow installs through `.github/actions/ci-dependencies` (pinned Node.js, Bun from
`package.json`, Bun's download cache, `bun install --frozen-lockfile`); signed desktop
releases install without a restored cache.

- Root lint (`eslint.config.mjs` ignores `apps/**`), typecheck (`tsconfig.json` excludes
  `apps`), the test runner (`scripts/ci/run-all-tests.mjs` skips `apps/desktop|mobile|chrome`),
  Docker and Vercel uploads (`.vercelignore`) leave the other apps to their own workflows.
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
- **Mobile's Shiki chunks.** The shared Markdown DOM bundle lazy-loads Shiki as
  `./node_modules/...` chunks; Metro resolves them from `apps/mobile/node_modules`, so mobile
  declares `shiki` and `@shikijs/*` with the same range as `@overlay/ui`. Before the single
  install these chunks came from an unrelated hoisted Shiki 3 while the UI used Shiki 4.
- **Shared transcript actions.** Copy and download buttons in `@overlay/chat-react` and
  `@overlay/ui` go through `usePlatformActions` from `@overlay/ui/platform-actions`
  (browser clipboard and Blob download by default). Mobile's DOM transcript wraps each
  message in a `PlatformActionsProvider` so the native app performs the copy or download
  for exactly that message; never patch `navigator.clipboard` instead.
- **Mobile transcript tests and streamed text.** Shared Markdown paces streamed text word
  by word, so mounted transcript tests that grow a response must wait for the viewport to
  settle (`waitForSettledViewport`) before reading pointer targets or scroll baselines.

## Feature parity

Mobile is a companion for workspaces that already exist (owner decision, 2026-11-27). It
does not create workspaces, run the setup conversation or offer paid features: no plan
picker, prices or checkout. A paid workspace keeps its entitlements on mobile, and people
set up and pay on web or desktop. Accepting an invitation to an existing workspace is fine.

Update this table when a feature lands on, or is removed from, any surface. "Web" means
the desktop app too: it renders the web app, adding only the native rows marked below. The
Chrome side panel also renders the web app (`chrome-extension.md`), so it has every web row
except the desktop-only ones; flows that leave Overlay (checkout, GitHub and Slack installs)
open in a new tab there.

| Feature | Web / Desktop | Mobile | Chrome |
| --- | --- | --- | --- |
| Agents and agent threads | Yes | Yes | Yes |
| Chats (personal) | Yes | Yes | Yes |
| Rooms, channels and DMs | Yes | Yes | Yes |
| Work (tasks) | Yes | Yes | Yes |
| Files, notes and memories | Yes | Yes | Yes |
| Automations | Yes | Yes | Yes |
| Extensions / tools and MCP | Yes | Yes (Tools) | Yes |
| Workspace and Personal modes | Yes | Yes | Yes |
| Voice input | Desktop dictation | Yes | No |
| Push notifications while closed (mentions, DMs, approvals) | No | Yes (`mobile-push.md`) | No |
| Attach the current browser tab ("Add this page") | No | No | Yes |
| Agents use this browser | No | No | Planned (`CHROME_EXTENSION_PARITY_PLAN.md`) |
| This Mac (local computer), private threads, first-run setup | Desktop only | No | No |
| Create a workspace, first-run setup conversation, plans and checkout | Yes | No (companion) | Yes (checkout in a new tab) |
