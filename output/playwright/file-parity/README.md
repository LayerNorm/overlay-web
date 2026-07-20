# Desktop/web file parity baselines

These deterministic artifacts establish the PR 1 and PR 2 baseline for fixture
version `2026-07-20.1`. They do not use authentication, Convex, the filesystem,
or live media URLs.

## Harnesses

- Web: `http://127.0.0.1:3000/__fixtures/file-parity`
- Desktop renderer: `http://localhost:5173/?window=file-parity-fixture`
- Isolated Electron mode: `npm --prefix overlay-desktop run file-parity:dev`

Both harnesses accept `theme=light|dark`, `width=1024|1280|1440`, and
`scenario=gallery|states|inventory|viewers|notebook|sync`. The web route returns
404 in production unless `FILE_PARITY_FIXTURES=1` is explicitly enabled, and
packaged Electron builds cannot enter fixture mode.

Fixture-only loading and sync animations are paused at a fixed frame, and the
video fixture uses deterministic controls over a real video element. Repeated
web and desktop gallery captures are therefore byte-identical without changing
production loading or media behavior.

## Coverage

The 20 committed PNGs cover both platforms in light and dark at desktop-relevant
widths. Dedicated 1280px captures preserve full viewer and notebook detail.
The gallery includes loading/error states, nested and duplicate files, Unicode,
selection and menus, every required viewer type, rich note formatting, offline
sync, conflicts, and migration.

`render-counts.json` records actual fixture fetch, mount, render, hydration, and
save counters. The web development harness intentionally records React's double
render while effects, fetches, hydration, and save commits remain single-run.

## CSS extraction gate

Before the canonical stylesheet extraction, the ten web matrix screenshots were
captured to a temporary reference set. After moving the editor rules out of
`src/app/globals.css` and importing the three shared stylesheets, all ten files
were byte-identical (`webScreenshotDiff: 0`). The final hashes are recorded in
`baseline-manifest.json`.

Run `npm run file-parity:manifest` after refreshing screenshots. The script
rejects missing/stale images, wrong widths, incomplete fixture coverage, and
render-count evidence from an older fixture version.
