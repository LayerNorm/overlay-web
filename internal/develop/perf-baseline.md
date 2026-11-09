# UI perf baseline

Phase 0 of the UI snappiness plan. It records numbers before any fix lands, so every later perf PR can show before and after.

## What it measures

| Scenario | Metrics |
|---|---|
| `cold-start` | TTFB, FCP, LCP, navigation start → composer usable, navigation start → transcript painted |
| `thread-switch` | Sidebar click → active row (feedback) and → thread content visible, for a cold and a warm (already opened) thread |
| `typing-while-streaming` | Keystroke → next frame while a reply streams, plus per-component render counts during the stream |
| `dm-scroll` | Frame rate, p75 frame time and dropped frames while scrolling up through older DM pages, DOM growth per loaded page |

Targets (from the plan): warm thread switch ≤100 ms, cold ≤500 ms, keystroke ≤50 ms while streaming, 60 fps DM scroll. Field INP and LCP come from Vercel Speed Insights, not this suite.

## In-app instruments

Both are off for normal users.

- **User Timing marks** (`src/features/chat/lib/realtime-baseline.ts`), written only when the harness sets the `overlay:baseline:enabled` mark: `composer-ready`, `personal-query-ready`, `transcript-painted`. They contain no content or ids.
- **Render counters** (`@overlay/chat-react/lib/perf-debug`), enabled with `?perf=1` or `localStorage.overlay_perf = '1'`. This PR adds counters for `ChatComposer`, `AppSidebar`, `RoomMessageItem` and `RoomComposer`, next to the existing `ChatExchange`, `ChatTranscript` and `MarkdownMessage` ones. When enabled, `window.__overlayPerfDebug.snapshot()` and `.reset()` let the harness read them.

## Running it

1. Build and start production: `npm run build && npm run start` (or use a PR Preview origin).
2. Save a signed-in storage state for a QA account, then `chmod 600` it. Never use a personal account with real data.
3. Prepare fixtures in that account:
   - Two agent threads (A and B) visible in the sidebar, each with a unique sentinel line of text. Thread B should be long (500+ exchanges) to show transcript cost.
   - A start page where neither thread is open (for example `/app/agents`).
   - A chat where sending a long prompt is fine (it sends one message per run).
   - A DM with 1,000+ messages.
4. Run:

```sh
PERF_ORIGIN=http://localhost:3000 \
PERF_STORAGE_STATE=.perf/state.json \
PERF_CHAT_PATH=/app/chat \
PERF_THREAD_START_PATH=/app/agents \
PERF_THREAD_A="Perf QA thread A" PERF_THREAD_A_SENTINEL="perf-sentinel-a" \
PERF_THREAD_B="Perf QA thread B" PERF_THREAD_B_SENTINEL="perf-sentinel-b" \
PERF_STREAM_PATH="/app/chat?id=..." \
PERF_DM_PATH="/app/chat?..." \
npm run perf:baseline
```

Optional: `PERF_SCENARIOS=cold-start,thread-switch`, `PERF_RUNS=5` (default), `PERF_THROTTLE=fast-4g-cpu4x` (default, Chrome Fast 4G plus 4x CPU slowdown) or `none`, `PERF_OUT_DIR=.perf`.

Results go to `.perf/perf-baseline-<timestamp>.{json,md}` (git-ignored). Paste the Markdown table into the PR or the baseline note.

## Bundle baseline

```sh
npm run analyze        # existing: analyzer build + /app/chat budget check
npm run perf:bundle    # initial JS for /app/chat, /app/files, /app/agents, /app/notes
```

`perf:bundle` only reports and never fails. Budgets stay in `scripts/ci/bundle-budgets.json`.

## React Profiler traces

Record these three by hand in a production build with profiling (`next build --profile`) and save the exports next to the baseline note:

1. Switch between threads A and B.
2. Type in the composer while a reply streams.
3. Scroll up through the long DM.

## Safety

- The origin must be a canonical PR Preview (`https://pr-N.preview.getoverlay.io`) or loopback `http://localhost`/`127.0.0.1`. Production is rejected.
- The storage state must be private (mode 600).
- Errors are reported without page content, URLs or credentials.
