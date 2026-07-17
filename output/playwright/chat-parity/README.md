# Desktop/web chat parity baselines

These artifacts capture fixture version `2026-07-17.1` before the desktop parity refactor. They are characterization evidence, not assertions that the two surfaces already match.

## Harnesses

- Web: `http://127.0.0.1:3000/__fixtures/chat-parity`
- Desktop renderer: `http://localhost:5173/?window=chat-parity-fixture`
- Electron fixture mode: `npm --prefix overlay-desktop run chat-parity:dev`

Both harnesses accept:

- `theme=light|dark`
- `width=390|640|896`
- `scenario=gallery|<fixture-id>`
- `perf=1` to publish `window.__CHAT_PARITY_BASELINE__`

The web route returns 404 in production unless the server-only `CHAT_PARITY_FIXTURES=1` flag is explicitly set. Electron fixture mode is rejected by packaged builds and bypasses auth providers, analytics initialization, and live Convex renderer initialization.

## Baseline set

- `rich-markdown`: web and desktop at 390, 640, and 896 pixels in light and dark mode.
- `gallery`: web and desktop at 896 pixels in light mode, covering rich text, reasoning/tools, loading, streaming, interruption/error, generated UI, image states, and video states.
- `render-counts.json`: Strict Mode mount counts for the static `rich-markdown` fixture at 896 pixels.

`baseline-manifest.json` records SHA-256 hashes for every screenshot. Timing values are deliberately not treated as a baseline because they vary by hardware; only render counts are characterized.

## Capture notes

The screenshots were captured with the repository Playwright CLI workflow against Next dev and Electron Vite dev on macOS. The Next development indicator was removed from the page before capture because it is framework chrome, not product UI. No network, auth, conversation, or generation data is used by the fixtures.
