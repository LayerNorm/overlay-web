# Desktop/web chat parity baselines

These deterministic artifacts capture fixture version `2026-07-17.3` after the
shared transcript cutover. They are the Phase 8 visual reference set.

## Harnesses

- Web: `http://127.0.0.1:3000/__fixtures/chat-parity`
- Desktop renderer: `http://localhost:5173/?window=chat-parity-fixture`
- Electron fixture mode: `npm --prefix overlay-desktop run chat-parity:dev`

Both harnesses accept:

- `theme=light|dark`
- `width=390|640|896`
- `scenario=gallery|<fixture-id>`
- `perf=1` to publish `window.__CHAT_PARITY_BASELINE__`

The web route returns 404 in production unless the server-only
`CHAT_PARITY_FIXTURES=1` flag is explicitly set. Packaged Electron builds reject
fixture mode. Neither harness requires authentication, analytics, Convex, or a
live model call.

## Required matrix

The 66 screenshots recorded by `baseline-manifest.json` cover:

- Web and desktop gallery states in light/dark at 390, 640, and 896 pixels.
- Default, real pointer hover, and real keyboard focus action states on both
  platforms at every theme and width.
- Streaming with `prefers-reduced-motion: reduce` on both platforms at every
  theme and width.
- Desktop browser/notebook embedded consumers in light/dark at every width.

The gallery includes rich Markdown, reasoning, sequential tools, generated UI,
multi-model text, loading, streaming, interruption/error, completed and loading
images, and completed/failed videos.

## Performance evidence

`render-counts.json` records the current `ChatTranscript`, `ChatExchange`, and
`MarkdownMessage` Strict Mode mount counts for fixture version `2026-07-17.3`.
It also records the executable 100-exchange stress gate: the first 99 completed
exchanges retain identity while the final exchange receives 100 stream chunks.
The web and desktop adapter tests enforce zero completed-exchange identity
changes and 100 active-exchange updates.

## Capture rules

- Capture with Chromium through the bundled Playwright CLI.
- Wait for `data-parity-ready="true"`, fonts, images, and video metadata.
- Pause fixture videos at time zero and remove Next development chrome.
- Use actual Playwright hover/focus operations for interaction baselines.
- Use Playwright media emulation for reduced-motion baselines.
- Disable animations during the screenshot operation to eliminate timing noise.
- Run `npm run chat-parity:manifest` after capture. It rejects missing or stale
  PNGs and records a SHA-256 hash for every expected artifact.

## Approved Class B web differences

- `exchange-actions-hover-focus`
- `status-driven-loading`
- `intent-preserving-autoscroll`

The executable allowlist is `APPROVED_CLASS_B_WEB_DIFFERENCES` in
`@overlay/chat-react/transcript`.
