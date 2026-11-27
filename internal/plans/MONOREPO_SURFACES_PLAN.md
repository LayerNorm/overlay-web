# One repository for every Overlay surface

Status: Phase 1 implemented on `codex/monorepo-surfaces`; Phases 2–5 not started.

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
| 1. Import | Bring desktop, mobile and Chrome into `apps/` with history; remove submodules; one bridge copy; per-app CI; desktop releases from this repo; web deploy skips app-only commits | Implemented and checked locally; not yet merged or deployed |
| 2. Mobile green | Fix the 20 node and 18 DOM transcript test failures against current web; widen the mobile workflow to `packages/**`, `src/shared/**`, `convex/**` | Not started |
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

Not yet verified: the new workflows on GitHub, an EAS cloud build, a signed desktop release
(needs the `mac-release` environment secrets re-entered in this repository), and the
Vercel ignore step on a real production commit.

## Operations after merge

1. Rename the GitHub repository `LayerNorm/overlay-web` → `LayerNorm/overlay`; confirm the
   Vercel Git connections for the web and admin projects still deploy `main`.
2. Create the `mac-release` and `release-publish` environments here and re-enter the Apple
   signing, notarization and `SENTRY_DSN` secrets (values cannot be copied between repos).
3. Archive `LayerNorm/overlay-desktop`, `LayerNorm/overlay-mobile` and
   `DevelopedByDev/overlay-chrome` after adding a pointer to this repository.
4. Move the local checkout to `~/Downloads/overlay` and repair worktrees.
