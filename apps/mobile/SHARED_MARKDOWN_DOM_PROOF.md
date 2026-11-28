# Shared Markdown DOM verification

## Bundled styles and fonts

`bun run build:shared-markdown-css` reads web revision `1db4b5e346c89676d205862d6974792dfebf056f` (the `scripts/prepare-eas-workspace.cjs` pin) and embeds local Geist, Libre Baskerville, and KaTeX fonts into generated CSS data URLs. It verifies every CSS URL, rejects remote imports, checks the installed KaTeX version against the pinned web lockfile, and fails if a local target is missing. Metro maps the shared renderer's KaTeX stylesheet import to that generated, self-contained CSS.

CI builds this CSS before tests and exports. It exports Android and iOS with `EXPO_NO_BUNDLE_SPLITTING=1` and verifies each platform's generated DOM CSS, font payloads, local URL targets, and native bundle metadata before running the existing bundle inspection.

The standalone synthetic transcript component is retained for its focused test and is not wired to an Expo Router route.

## Native transcript tests

Run `bun run test:native-transcript` for the action-controller suite and the mounted React/Chromium transcript suite. Mounted focus-resume assertions wait with a bounded timeout for the scheduled readiness callback instead of treating one event-loop turn as completion. Mobile locks `tsx`, `esbuild`, and Playwright; React, React DOM, and `react-test-renderer` resolve from the pinned parent Web checkout and are version-checked by the test preload. Install Chromium locally with `npx playwright install chromium`; CI installs Chromium and its Linux dependencies.

## Jump-to-latest control

The Mobile transcript follows the Web Chat control pattern: an accessible ghost icon button with shared semantic surface colors and a Lucide chevron, shown when the shared scroller reports more than 24px below the viewport. Native transcript mutations also remeasure the bottom gap, so streaming growth while selection has paused follow exposes and retains Jump even without a scroll event. Initial-end and submission intents follow the latest response; an away restore remains at its saved position. Activating Jump to latest uses the shared scroller's smooth end-scroll and enables follow for later streamed or rendered growth, including when it is activated during a pending text hold. Scroll-away gestures pause follow; returning to the bottom re-arms it. Horizontal and endward input at the bottom do not pause follow. A potential text-selection hold on selectable transcript text pauses follow immediately at pointer/touch start, keeping the glyph and reading position stable while streaming content changes before a non-collapsed selection exists. A short tap restores the prior follow state; lifecycle-cleaned document pointer-up/cancel and window-blur listeners finish outside releases without pointer capture. Duplicate pointer/touch delivery resolves only after both channels end, and cancellation, real scrolling, established selection, and scope cleanup do not leave a stale hold. Mounted glyph regressions wait for fonts and finite entrance animations before trusted input, verify the intended word `stood`, and require its range rectangle to remain within 1 CSS px during preselection growth. The remaining Chromium regressions exercise settled and streaming responses, actual pointer/touch, button and wheel gestures, selection preservation and dismissal, growth-created Jump visibility, theme/accessibility semantics, scroll-away and manual-bottom behavior, and scope remount cleanup.

## Search-source projection boundary

The personal transcript host uses the pinned shared `collectWebSourcesFromBlocks` collector on completed allowlisted search and browser tools before raw tool output is removed. It merges bounded, response-scoped URL/title sources into canonical `response.sources`, while provider sources and document citations stay intact. The DOM projection revalidates URLs with the existing native link boundary and emits tool source metadata only when its URL is in that response's capped canonical source list. A response-wide dedupe and 200-source budget keep inline chips aligned with native open-source targets. Raw tool input and raw tool output never cross the projection boundary; the only tool-output exception is synthesized `toolOutput: { sources: [{ url, title }] }` metadata for completed allowlisted source tools whose URLs are in canonical `response.sources`. Snippets, credentials, and all other raw payload remain excluded.

## Metro and export behavior

Metro's web lazy-bundle requests can be rooted at the mobile app's `./node_modules/` even when their packages are in the pinned parent web workspace. The resolver tries the app-local request first, then falls back to the parent workspace only for safe Metro-generated `./node_modules/...` paths. It does not redirect ordinary relative source imports or unresolved bare imports. Restart Metro after changing this resolver.

EAS profiles and CI exports set `EXPO_NO_BUNDLE_SPLITTING=1`; the Expo setting is marked unstable. The default split DOM export previously failed with a missing `__common` bundle. Disabling splitting packages the dynamic DOM module graph into the export and may increase bundle size. The exported CSS/fonts and Shiki modules are local, but a successful export does not replace Metro development-runtime or on-device acceptance. Signed-release app startup remains unverified.

Shared external Markdown links may display a Google S2 favicon via `WebSourceTooltip`. This is optional remote imagery: offline or blocked requests may leave the favicon absent, but do not affect the link, Markdown content, bundled fonts, math, or code highlighting. No shared renderer fork or favicon behavior change is part of this proof.

## Checks

Run `bun run build:shared-markdown-css`, `bun run check`, the remaining CJS tests, `bun run test:native-transcript`, and `node scripts/lint-mobile.cjs`. The Markdown and transcript tests register their TypeScript, React, and style hooks locally. CI exports both platforms and invokes the CSS asset verifier, the transcript source-map reachability verifier, and the credential-safe bundle inspection.
