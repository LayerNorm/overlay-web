# One repository for every Overlay surface

Status: Phases 1 and 2 merged (2026-11-27); Phases 3–5 not started.

## Goal

Agents and people develop every Overlay surface in one place, with the web app and
its backend authoritative, so a feature or contract change reaches web, desktop,
mobile and the Chrome extension in one change and CI shows when a surface breaks.

Layout (the living reference is `internal/develop/surfaces.md`):

```
overlay/              ← this repository (GitHub LayerNorm/overlay, local folder ~/Downloads/overlay)
  src/, convex/       ← web app and backend (authoritative)
  packages/           ← code the surfaces share
  apps/admin          ← operator console
  apps/desktop        ← Electron Mac app       (was LayerNorm/overlay-desktop, a submodule)
  apps/mobile         ← Expo iOS app           (was LayerNorm/overlay-mobile, a submodule)
  apps/chrome         ← Chrome extension       (was DevelopedByDev/overlay-chrome, untracked)
```

## Progress

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Import | Bring desktop, mobile and Chrome into `apps/` with history; remove submodules; one bridge copy; per-app CI; desktop releases from this repo; web deploy skips app-only commits | Merged to main and deployed; web production verified |
| 2. Mobile green | Fix the 20 node and 18 DOM transcript test failures against current web; widen the mobile workflow to `packages/**`, `src/shared/**`, `convex/**`; turn on server push | Merged to main; mobile suites green locally (node 282/282, transcript 96 + 55); server push on; device push QA pending (see Phase 2 record) |
| 3. Chrome port | Port the side panel from the removed `MessageList` to the current `@overlay/chat-react` transcript; align React types; widen its workflow to the shared chat packages | Not started |
| 4. One install | Make desktop, mobile and Chrome root npm workspaces with one lockfile; replace path imports with package imports | Not started |
| 5. Web in apps/web | Move the web app into `apps/web` (Vercel root directory, CI, docs) | Not started |

## Phase 1 record

- Histories rewritten with `git filter-repo --to-subdirectory-filter apps/<name>`, tags
  dropped (desktop `v*` tags would collide with web tags), `.DS_Store` removed and desktop
  blobs over 50 MB stripped. Chrome history was secret-scanned before becoming public.
- 128 relative paths that left an app's folder gained one `../`; app-root-based joins in
  mobile scripts were fixed by hand; test mock IDs that mirror in-app imports were kept.
- `packages/overlay-desktop-bridge` is now the only bridge copy; the vendoring fingerprint
  check is replaced by a boundary rule that the desktop links the shared package.
- Mobile EAS builds and the shared Markdown CSS no longer clone or diff a pinned web commit.
- Removed a dead web fallback that loaded Composio from the desktop's `node_modules`.

Verified locally on the import branch: web boundary, legacy-import and architecture guards,
secret scan, lockfile sync with npm 11.11.0; desktop lint, 99 unit tests, build, 10
Electron e2e tests and unsigned packaging without the root install; mobile typecheck, lint
and iOS export with asset and transcript-reachability verification; Chrome legacy-API guard
and 21 tests. Mobile test results match or improve on the old layout run against the same
web commit (node 262/20 vs 261/21; DOM 37/18 vs 36/19).

On GitHub: the Desktop app workflow passes on macOS (its Electron recorder and migration
e2e tests flaked once and passed on rerun); the Mobile app workflow passes install,
typecheck, lint and both native exports and fails only in the pre-existing test drift; the
Chrome workflow fails with the two known type errors. Its first run caught a real `@/` import
in `src/shared/schemas/misc.ts`, fixed on main. Production web deployed and answers on
overlay.works, /app and admin.overlay.works.

Not yet verified: an EAS cloud build, a signed desktop release, the Vercel ignore step
skipping an apps-only production commit, and Security Checks on the final commits (queued
behind a GitHub runner backlog when this was written).

## Phase 2 record

- Node tests (13 failing on main, 282 total) were stale mocks: the Workspace | Personal
  `modeState` module, new imports in the agent details sheet, the Chat route moved to
  `app/chat/index.tsx`, the agent composer renamed to `MessageCapsule`, and integrations
  reading the mode. Mocks now supply the mode, and tests assert that new chats, notes,
  automations and personal turns send it. Push tests passed once the service imported the
  typed `api.notifications.tokens` references instead of `makeFunctionReference`.
- 15 of 17 transcript failures were real: mobile had dropped the never-merged
  `@overlay/ui/platform-actions` hook and patched `navigator.clipboard` instead, which lost
  the copied message and ignored Download. The hook now lives in `packages/overlay-ui`
  (ported from the unmerged `devin/1794417267-mobile-transcript-web-dependency` branch) and
  the generated-UI card, draft review and code blocks use it.
- The last two were test races with the web's word-by-word stream pacing: pointer targets
  and scroll baselines were read while the transcript was still moving. The tests now wait
  for a settled viewport; their assertions are unchanged.
- Server push registration is on (`SERVER_PUSH_TOKENS_AVAILABLE` removed rather than set to
  true). Verified: `push.test.cjs` and `convex/mobilePush.convex.test.ts`. Not verified: a
  real device registering and receiving a mention push. The owner's iPhone and iPad were not
  connected, and the simulator gets no Expo token (`Device.isDevice`), so this needs one run
  of the `PUSH_QA.md` device checklist on a dev or EAS build.
- Verified locally: mobile `npm run check`, lint, iOS and Android exports with asset,
  reachability and bundle inspection; node 282/282; transcript 96/96 and 55/55 (twice);
  shared package tests 16/16. The widened workflow first runs on this push.

## Operations after merge

- Done: GitHub repository renamed to `LayerNorm/overlay`. Vercel still reports the old name
  in the project link until it refreshes, so release scripts identify the repository by its
  numeric ID (`1133644268`).
- Done: `LayerNorm/overlay-desktop`, `LayerNorm/overlay-mobile` and
  `DevelopedByDev/overlay-chrome` point here and are archived (`overlay-mono` no longer existed).
- Done: canonical local checkout is `~/Downloads/overlay`; new worktrees go in
  `~/Downloads/overlay-worktrees/`. The old `~/Downloads/overlay-mono` stays only until its
  open sessions and older worktrees finish.
- Owner action: create the `mac-release` and `release-publish` environments in this repository
  and re-enter the Apple signing, notarization and `SENTRY_DSN` secrets before the next desktop
  release.
