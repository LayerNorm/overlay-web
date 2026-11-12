# Shared Markdown DOM verification

## Bundled styles and fonts

`npm run build:shared-markdown-css` reads web revision `1db4b5e346c89676d205862d6974792dfebf056f` (the `scripts/prepare-eas-workspace.cjs` pin) and embeds local Geist, Libre Baskerville, and KaTeX fonts into generated CSS data URLs. It verifies every CSS URL, rejects remote imports, checks the installed KaTeX version against the pinned web lockfile, and fails if a local target is missing. Metro maps the shared renderer's KaTeX stylesheet import to that generated, self-contained CSS.

CI builds this CSS before tests and exports. It exports Android and iOS with `EXPO_NO_BUNDLE_SPLITTING=1` and verifies each platform's generated DOM CSS, font payloads, local URL targets, and native bundle metadata before running the existing bundle inspection.

The standalone synthetic transcript component is retained for its focused test and is not wired to an Expo Router route.

## Native transcript tests

Run `npm run test:native-transcript` for the action-controller suite and the mounted React/Chromium transcript suite. Mobile locks `tsx`, `esbuild`, and Playwright; React, React DOM, and `react-test-renderer` resolve from the pinned parent Web checkout and are version-checked by the test preload. Install Chromium locally with `npx playwright install chromium`; CI installs Chromium and its Linux dependencies.

## Metro and export behavior

Metro's web lazy-bundle requests can be rooted at the mobile app's `./node_modules/` even when their packages are in the pinned parent web workspace. The resolver tries the app-local request first, then falls back to the parent workspace only for safe Metro-generated `./node_modules/...` paths. It does not redirect ordinary relative source imports or unresolved bare imports. Restart Metro after changing this resolver.

EAS profiles and CI exports set `EXPO_NO_BUNDLE_SPLITTING=1`; the Expo setting is marked unstable. The default split DOM export previously failed with a missing `__common` bundle. Disabling splitting packages the dynamic DOM module graph into the export and may increase bundle size. The exported CSS/fonts and Shiki modules are local, but a successful export does not replace Metro development-runtime or on-device acceptance. Signed-release app startup remains unverified.

Shared external Markdown links may display a Google S2 favicon via `WebSourceTooltip`. This is optional remote imagery: offline or blocked requests may leave the favicon absent, but do not affect the link, Markdown content, bundled fonts, math, or code highlighting. No shared renderer fork or favicon behavior change is part of this proof.

## Checks

Run `npm run build:shared-markdown-css`, `npm run check`, the remaining CJS tests, `npm run test:native-transcript`, and `node scripts/lint-mobile.cjs`. The Markdown and transcript tests register their TypeScript, React, and style hooks locally. CI exports both platforms and invokes the CSS asset verifier, the transcript source-map reachability verifier, and the credential-safe bundle inspection.
