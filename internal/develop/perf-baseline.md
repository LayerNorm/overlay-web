# UI perf baseline

Phase 0 of the [UI responsiveness plan](../plans/UI_RESPONSIVENESS_PLAN.md). Tooling is available; an accepted live baseline is still outstanding. Compare identical synthetic fixtures, production builds and network/CPU profiles before and after changes.

## What it measures

| Scenario | Metrics |
|---|---|
| `cold-start` | TTFB, FCP, LCP sampled at readiness, navigation start → unblocked editable composer, optional transcript sentinel visibility |
| `thread-switch` | Sidebar click → active row (feedback) and → thread content visible, for a cold and a warm (already opened) thread |
| `typing-while-streaming` | Keystroke → next frame while a reply streams, plus per-component render counts during the stream |
| `dm-scroll` | Frame rate, p75 frame time and >34 ms hitch intervals during fixed scrolling after explicit pagination, transcript DOM growth per loaded page |

Targets (from the plan): warm thread switch ≤100 ms, cold ≤500 ms, keystroke ≤50 ms while streaming, 60 fps DM scroll. Field INP and LCP come from Vercel Speed Insights, not this suite.

## In-app instruments

Both are off for normal users.

- **User Timing marks** (`src/features/chat/lib/realtime-baseline.ts`), written only when the harness sets the `overlay:baseline:enabled` mark: `composer-ready`, `personal-query-ready`. They contain no content or ids. Query readiness is not a paint timestamp. Composer readiness requires a mounted input card that is not send-blocked; the runner also checks a visible editable input.
- **Render counters** (`@overlay/chat-react/lib/perf-debug`), enabled with `?perf=1` or `localStorage.overlay_perf = '1'`. This PR adds counters for `ChatComposer`, `AppSidebar`, `RoomMessageItem` and `RoomComposer`, next to the existing `ChatExchange`, `ChatTranscript` and `MarkdownMessage` ones. When enabled, `window.__overlayPerfDebug.snapshot()` and `.reset()` let the harness read them.

## Running it

1. Build and start production: `npm run build && npm run start` (or use an isolated exact-head PR Preview origin). Independently verify its deployed SHA before setting `PERF_TARGET_REVISION`; the runner records an expectation, not a deployment attestation. `revision` identifies the harness checkout.
2. Save a signed-in storage state for a QA account, then `chmod 600` it. Never use a personal account with real data.
3. Prepare fixtures in that account:
   - Two agent threads (A and B) visible in the sidebar, each with a unique sentinel line of text. Thread B should be long (500+ exchanges) to show transcript cost.
   - A start page where neither thread is open (for example `/app/agents`).
   - An idle personal chat with no draft, a send-capable composer, and permission to send synthetic prompts. Requires `PERF_ALLOW_SEND=1` and `PERF_PROMPT`. Sends `PERF_RUNS + 1` messages, including a separate counter run excluded from latency samples. The reply must keep producing text throughout typing. Respect paid-model QA policy.
   - A DM with 1,000+ messages. The runner presses Load older messages until the loaded-message count reaches `PERF_DM_MIN_MESSAGES` (default 1000). Insufficient history fails rather than measuring a short thread.
4. Run:

```sh
PERF_ORIGIN=http://localhost:3000 \
PERF_TARGET_REVISION=<verified-40-character-deployment-sha> \
PERF_STORAGE_STATE=.perf/state.json \
PERF_CHAT_PATH=/app/chat \
PERF_THREAD_START_PATH=/app/agents \
PERF_THREAD_A="Perf QA thread A" PERF_THREAD_A_SENTINEL="perf-sentinel-a" \
PERF_THREAD_B="Perf QA thread B" PERF_THREAD_B_SENTINEL="perf-sentinel-b" \
PERF_STREAM_PATH="/app/chat?id=..." \
PERF_ALLOW_SEND=1 PERF_PROMPT="<approved synthetic prompt>" \
PERF_DM_PATH="/app/chat?..." \
npm run perf:baseline
```

Optional: `PERF_SCENARIOS=cold-start,thread-switch`, `PERF_RUNS=5` (default), `PERF_THROTTLE=fast-4g-cpu4x` (default, Chrome Fast 4G plus 4x CPU slowdown) or `none`, `PERF_OUT_DIR=.perf`.

Additional options: `PERF_TIMEOUT_MS=30000`, `PERF_DM_LOAD_PAGES=40` (maximum pagination operations), `PERF_DM_MIN_MESSAGES=1000`. Positive integer ranges are validated. An empty scenario list is invalid. Supply `PERF_CHAT_SENTINEL` and an existing chat path for cold-start transcript timing; without it that metric is intentionally unavailable.

### Interpretation

DOM visibility and frame callbacks are proxies, not proof of painted pixels. Composer observation includes automation/polling overhead. LCP-at-readiness is not final field LCP. A >34 ms interval is a hitch interval, not a count of dropped frames. Thread switches use the runner clock for both click and observation. Route prefetch may warm code even on a first thread visit, so cold means first application visit to B, not guaranteed cold HTTP/CDN caches.

Live-model typing is exploratory, not a deterministic regression gate. A deterministic streaming fixture and measured runner variance must precede blocking timing gates. Render ratios describe the combined typing/streaming window; a separate stream-only test is needed to establish unrelated-render causation. Missing streaming observations, failed switches (including the intermediate A switch) and insufficient history invalidate the entire scenario, not just individual samples.

Results go to `.perf/perf-baseline-<timestamp>.{json,md}` (git-ignored). Paste the Markdown table into the PR or the baseline note.

## Bundle baseline

```sh
npm run analyze        # existing: analyzer build + /app/chat budget check
npm run perf:bundle    # initial JS for /app/chat, /app/files, /app/agents, /app/notes
```

`perf:bundle` reports sizes and fails if expected route measurements are unavailable. Budgets stay in `scripts/ci/bundle-budgets.json`.

## React Profiler traces

Record these three by hand in a production build with profiling (`next build --profile`) and save the exports next to the baseline note:

1. Switch between threads A and B.
2. Type in the composer while a reply streams.
3. Scroll up through the long DM.

## Safety

- The origin must be a canonical PR Preview (`https://pr-N.preview.getoverlay.io`) or loopback `http://localhost`/`127.0.0.1`. Production is rejected.
- The storage state must be private (mode 600).
- Navigation away from the allowed origin is aborted. Production and third-party destinations must never be supplied as fixtures.
- Runtime errors are replaced with fixed messages, not copied from Playwright exceptions that may contain selectors, content or private URLs. Check fixture preconditions and configuration on failure.
- A failed streaming run may have submitted work. Inspect that synthetic thread before retrying and stop only that test run if necessary.
- Keep custom production interaction timings in capability-gated PostHog. Speed Insights remains the field Web Vitals destination, not a general custom-event API.
