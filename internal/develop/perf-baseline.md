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
2. Save a freshly authenticated storage state for a QA account, then `chmod 600` it. Never use a personal account with real data. Authentication state is not a timeless fixture: replaying an older snapshot can repeatedly reuse an expired access token and rotated refresh credential. Capture it immediately before a series and verify native Convex authentication; do not count a workspace boot gate as readiness. Keep expired-session recovery tests separate from valid-session timings.
3. Prepare fixtures in that account:
   - Two agent threads (A and B) visible in the sidebar, each with a unique sentinel line of text. Thread B should be long (500+ exchanges) to show transcript cost.
   - A start page where neither thread is open (for example `/app/agents`).
   - Prefer the deterministic Preview public-stream fixture below. Alternatively, an idle personal chat with no draft and permission to send synthetic prompts requires `PERF_ALLOW_SEND=1` and `PERF_PROMPT`. That exploratory live-model mode sends `PERF_RUNS + 1` messages, including a separate counter run excluded from latency samples. Respect paid-model QA policy.
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

Additional options: `PERF_TIMEOUT_MS=30000`, `PERF_DM_LOAD_PAGES=40` (maximum pagination operations), `PERF_DM_MIN_MESSAGES=1000`, `PERF_STREAM_MIN_EXCHANGES=25` (fixture history required before replay). Positive integer ranges are validated. An empty scenario list is invalid. Every fresh page must obtain a successful native-token response; fixture replay also requires its selected history to be visible before mutation. Supply `PERF_CHAT_SENTINEL` and an existing chat path for cold-start transcript timing; without it that metric is intentionally unavailable.

### Fixed Preview fixtures, without model calls

Follow the exact-head provenance and narrowly scoped credential procedure in [convex-workflow.md](convex-workflow.md). Only after verifying the PR's isolated backend, explicitly invoke internal mutation `dev/performanceQa:init` with `{}` there. Never deploy from a feature branch to shared development or production. The mutation checks `OVERLAY_DEPLOYMENT_ENV=preview` and takes the synthetic owner from the configured Preview identity, not caller-supplied user/workspace IDs.

It reuses the existing Preview QA Team and creates fixed histories: two personal chats with 25 exchanges each, one agent history with 512 exchanges, a 1,000-message DM with variable-height text and 50 same-origin image attachments, and a 25-exchange streaming fixture. The last exchange replays while 24 settled exchanges remain, so unrelated-row render counts are meaningful. Existing histories are not appended or reset by reseeding. Changed/deleted histories fail validation. The normal Preview QA seeder may create its one-time synthetic allowance if the team was never initialized; it never replenishes an existing allowance.

For personal sidebar switching use names `Performance personal-a` and `Performance personal-b`, with sentinels `Performance personal-a final sentinel` and `Performance personal-b final sentinel`. The returned manifest gives IDs for direct routes and the separate agent/DM history checks. A and B are typical histories, not a claim that the long-agent case has been measured.

For typing, configure the returned stream conversation in `PERF_STREAM_PATH` with its `id` query parameter, and set:

```sh
PERF_STREAM_MODE=fixture
PERF_ALLOW_FIXTURE_MUTATIONS=1
PERF_FIXTURE_BACKEND=<verified-pr-backend-name>
PERF_FIXTURE_DEPLOY_KEY=<securely-bound-scoped-preview-deployment-key>
```

Bind the key through the secret store/environment; never paste a real value into a command, report, browser or commit. The Node runner alone uses it to call the internal fixture mutation. `PERF_ALLOW_SEND` and `PERF_PROMPT` are not used in fixture mode, and no prompt is submitted through the UI.

Each replay updates only the last two-message exchange using native public-stream projection and 80 fixed paragraphs at 150 ms scheduler intervals. It creates no provider request or real workflow/worker. Public delivery/run/segment rows are reused, so transcript/sidebar sizes stay fixed. Only the reserved synthetic stream fixture can be restarted, while idle; generation/sequence fences discard old callbacks. The runner waits for settlement before the next replay. Timing still depends on scheduler and network delivery, so runner variance must be measured before making a timing gate. Do not use fixture Stop/Resume controls as workflow correctness evidence.

### Interpretation

Typing samples accept a retained typed prefix when later characters share the same frame. The runner waits for every frame callback and still rejects removed/replaced text, detached editors, inactive streams and missing observations. Exact whole-input equality would discard slow coalesced keystrokes and bias the result. Frame callbacks remain a presentation proxy, not an exact paint timestamp.

DOM visibility and frame callbacks are proxies, not proof of painted pixels. Composer observation includes automation/polling overhead. LCP-at-readiness is not final field LCP. A >34 ms interval is a hitch interval, not a count of dropped frames. Thread switches use the runner clock for both click and observation. Route prefetch may warm code even on a first thread visit, so cold means first application visit to B, not guaranteed cold HTTP/CDN caches.

Live-model typing is exploratory, not a deterministic regression gate. The fixed public-stream workload removes provider variance, but measured runner variance must still precede blocking timing gates. Render ratios describe the combined typing/streaming window; a separate stream-only test is needed to establish unrelated-render causation. Missing streaming observations, failed switches (including the intermediate A switch) and insufficient history invalidate the entire scenario, not just individual samples.

Results go to `.perf/perf-baseline-<timestamp>.{json,md}` (git-ignored). Paste the Markdown table into the PR or the baseline note.

## Bundle baseline

```sh
npm run analyze        # existing: analyzer build + /app/chat budget check
npm run perf:bundle    # initial JS for /app/chat, /app/files, /app/agents, /app/notes
```

For a local compilation without service credentials, use the same non-production fixture configuration as the repository's production-compilation CI job:

```sh
OVERLAY_DEPLOYMENT_ENV=test \
NEXT_PUBLIC_CONVEX_URL=https://fixture.convex.cloud \
INTERNAL_API_SECRET=test-internal-secret \
NODE_OPTIONS=--max-old-space-size=12288 npm run analyze
```

This produces bundle artifacts, not an authenticated app for browser measurements. The 12 GiB heap completed the analyzer in the QA VM; 4 and 6 GiB heaps failed. Use sufficient machine memory rather than removing analysis or raising budgets. A successful compilation followed by a failed budget check is not a passing budget. Keep the emitted analyzer and entrypoint files together with the exact source revision and configuration used.

Both scripts read `analyze/entrypoints.json`, emitted from the actual client Webpack compilation. They do not import removed Next.js internal size helpers. Route-only JS excludes the runtime and ancestor layouts; entry JS is the deduplicated union of page, ancestor layouts, `main-app` and (when separately emitted) `app-pages-internals` JS. Raw sizes come from emitted files and gzip sizes compress each file independently. Async imports, CSS, RSC/HTML payloads and browser/CDN transfer effects are not included. This is a static entrypoint budget, not an observed network-transfer measurement or a count of modules executed during startup.

`perf:bundle` reports sizes and fails if expected route measurements are unavailable. Missing or ambiguous routes, unsupported manifests and missing files fail closed. Both `--dist-dir=value` and `--dist-dir value` are supported. Budgets stay in `scripts/ci/bundle-budgets.json`; thresholds are not silently raised by the compatibility repair. Use the analyzer's import graph to justify splitting and validate the affected first-use UI separately. Turbopack analysis is not a substitute for this app's production Webpack build.

## Provider-free syntax first-use fixture

On an explicitly verified, isolated Preview backend, the internal `dev/performanceQa:initCode` mutation creates one separate personal conversation with two completed messages for the configured QA owner. It requires the existing active QA workspace and owner membership; it does not bootstrap or repair them. The fixed assistant text includes JavaScript, Python, unsupported-language and plaintext fences with punctuation/indentation sentinels for rendering and Copy checks.

The fixture is opt-in and idempotent. Changed content is rejected rather than overwritten. It neither modifies the measured histories nor schedules work, starts execution records, calls providers, changes roles or adjusts funds. Use the existing scoped Preview credential procedure, never an ambient shared backend or production key. A static completed fixture does not establish streaming or Workflow acceptance.

### Provider-free personal pagination fixture

On an explicitly verified isolated Preview backend, internal mutation `dev/performanceQa:initPagination` creates a separate personal conversation titled `Performance pagination` with 120 deterministic completed text messages. It returns `{ workspaceId, conversationId }`. Call it with `{}` for the configured Preview QA workspace, or with `{ workspaceId }` for another existing workspace whose ID is `preview-*-${PREVIEW_LOGIN_USER_ID}` and where that configured QA user is already an active human owner. The mutation never creates or repairs a workspace or membership; the workspace selector is only a scope, not authority.

The fixture has a workspace-specific stable client ID and is idempotent. It writes only its conversation and messages, leaves the personal-A/B, stream and DM baselines unchanged, and fails closed if the fixture is edited, soft-deleted or has the wrong scope. It does not use message append APIs, schedule reindexing, create execution or Workflow records, call a provider/model, or change workspace roles, resources or billing. Remove it only through the configured QA owner's normal conversation controls on isolated Preview; there is no fixture cleanup mutation. Do not rerun after cleanup or after unexpected changes. This fixture enables pagination QA but is not hosted acceptance evidence.

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
