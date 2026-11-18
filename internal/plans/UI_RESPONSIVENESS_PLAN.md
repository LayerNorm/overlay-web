# UI responsiveness implementation plan

Status: Implementation and acceptance are in progress, not complete. Historical cold-composer and long-DM samples, a DM render profile, and a compiled bundle baseline have been captured privately. Current-head baseline and before/after acceptance remain outstanding. PR #468 has merged; hosted acceptance of its history-load anchor fix remains separately tracked.

## Next interaction pass (approved; T1 implemented locally, T2/T3 production pending mockup approval, T4 lifecycle fix partial)

These proposals address observed interaction boundaries without changing authorization, dispatch, or durable state contracts.

1. **T1. Workspace selection acknowledgement and scope-safe navigation**
   - **Rationale:** Before T1, `src/features/workspaces/components/WorkspaceSwitcher.tsx:70-84` waited for `switchWorkspace()` before route navigation and `src/contexts/WorkspaceContext.tsx:274-299` awaited active-workspace activation. The content boundary hides pending source content and keys the destination scope (`src/features/workspaces/components/WorkspaceScopedContentBoundary.tsx:185-206`).
   - **Status:** Implemented locally in the feature worktree. Focused provider and switcher tests cover delayed activation, immediate route pushes, A-to-B-to-A before pathname changes, serialized writes, Back/Forward including same-path cancellation, source refresh and live-directory updates before a route commit, stale handle resolution, denied access, and stale activation results. Directory tests cover superseded opens; the boundary test covers hiding source content until the destination route resolves. T1 remains unaccepted pending exact-head Preview and browser route verification.
   - **Proposal:** Close the picker and acknowledge the destination immediately in the existing shell. Start canonical scoped navigation without waiting for active-workspace preference persistence where the server scope contract allows. Never publish the new active data scope under the old route or display old-tenant data.
   - **Correctness:** Use latest-selection generations so late activation responses cannot win. Serialize or reconcile activation preference writes so they converge on the latest selection. Cover failed access, Back/Forward, refresh, rapid repeated selections, and late responses. Existing boundary tests cover preserving source state on rejection; focused provider/switcher tests now cover selection races and immediate route push, but not hosted end-to-end navigation timing (`src/features/workspaces/components/WorkspaceScopedContentBoundary.test.tsx`, `src/contexts/WorkspaceContext.test.tsx`, `src/features/workspaces/components/WorkspaceSwitcher.test.tsx`).

2. **T2. Task assignment and assigned-task creation feedback**
   - **Rationale:** `src/features/work/components/WorkDataProvider.tsx:103-120` routes assigned create/update through the server client instead of the optimistic Convex commands; `src/features/work/components/WorkRow.tsx:108-118`, `src/features/work/components/WorkPeek.tsx:149-163`, and `src/features/work/components/WorkPickers.tsx:132-137` have no shared pending assignment projection. `src/server/work/WorkService.ts:65-135` saves before dispatch and admission.
   - **Status:** Production implementation is pending approval of the T2/T3 production-shell mockup. No T2 production code has been implemented.
   - **Proposal:** Add a shared pending projection for list, board, and peek, keyed by stable client operation IDs. Show the selected assignee and saving state immediately. Keep server dispatch/admission unchanged. Distinguish saving, saved and waiting on dependencies, starting, running, and failed or unknown start.
   - **Correctness:** Do not blindly roll back or auto-retry ambiguous start errors. Reconcile from live state; prevent older failures from overwriting newer edits. Preserve create drafts on failure and deduplicate submissions. Do not assume server idempotency without verifying its contract. Existing `src/server/work/WorkService.test.ts` covers dispatch edge cases and `src/features/work/lib/work-state.test.ts` covers patching, but UI pending, out-of-order, and create-failure recovery are not covered.

3. **T3. Agent creation acknowledgement and separate computer provisioning**
   - **Rationale:** `src/features/agents/components/NewAgentDialog.tsx:294-377` waits for agent creation and optional computer provisioning before `onCreated`; `/app/agents/new` uses `src/features/agents/components/use-agent-editor-actions.ts:79-115` with the same sequential wait. `src/features/agents/components/NewAgentDialog.test.tsx` primarily covers fields and defaults, not async reconciliation.
   - **Status:** Production implementation is pending approval of the T2/T3 production-shell mockup. No T3 production code has been implemented.
   - **Proposal:** Show a local pending agent row/editor from the submitted snapshot immediately. Never use a temporary ID in server queries or claim the agent is saved or ready. Reconcile to the durable ID once, then provision an optional computer separately so the durable agent can be used without waiting for provisioning.
   - **Correctness:** Preserve permissions and gates for computer-dependent actions. On create failure retain a recoverable draft; retry with idempotency only after verifying server support. Computer failures retry only computer provisioning. Handle navigation and workspace switches without losing or showing a foreign draft. Cover both the dialog and `/app/agents/new` paths.

4. **T4. Streaming lifecycle and measured cadence**
   - **Rationale:** `src/features/chat/components/chat/useChatRuntimes.ts:13-16,114-120` throttles React updates at 66 ms. Separately, `src/server/harness/public-stream-publisher.ts:10-17,315-318` has a 75 ms flush timer, an 8 KiB batch limit, and `PublicTextProjector` filtering. These are separate layers: do not add 75 ms and 66 ms or assume both apply to the same path. A source-confirmed web chat lifecycle bug was also found: `src/features/chat/components/ChatMessageList.tsx:234-254` supplies active loading without `getResponseRuntime`; `src/features/chat/components/chat/toChatTranscriptView.ts:117-126` could infer a visible generating response as completed, and `packages/overlay-chat-react/src/components/transcript/ChatExchange.tsx:436-445` honors that explicit status over its loading fallback. Other surfaces and reconnect behavior remain unverified.
   - **Status:** Partial lifecycle implementation: the adapter fallback remains live after visible text appears, without reactivating prior response variants or historical generating rows. No cadence tuning was made. Producer, persistence, subscription, render, Markdown, and scroll measurement plus exact-head Preview and browser acceptance remain outstanding.
   - **Proposal:** Make one existing indicator per surface represent the run lifecycle from submission through first token, tool-only periods, pauses/reconnect, and actual terminal state. Keep Stop available. Do not add a duplicate spinner, "Thinking" text, or fake percent/progress. Inspect durable Convex delivery/projection separately from the AI SDK throttle. Profile producer cadence, persistence, subscription, render/Markdown, and scroll independently. Preserve complete formatted chunks, stable rows, and the local composer; tune batching only after measurement.

**Acceptance for T1-T4:** Add explicit delayed, rejected, and out-of-order tests for each interaction. In a declared lab profile, target acknowledgement within 100 ms and typing within 50 ms; these are targets, not measured claims. Record exact-head isolated Preview before/after results without production fixture writes. Cover reduced motion, keyboard use, dark and light themes, and narrow layouts. Any new visual pending/error surface requires an approved production-shell HTML mockup before implementation.

**Recommendation:** Implement these interaction contracts in one cohesive main-targeted PR. Defer cache rewrite, auth rewrite, virtualization, and general bundle work unless evidence warrants separate scope. Keep the historical acceptance above as historical evidence, not current-head speed evidence.

## Goal and constraints

Make navigation acknowledge input immediately, keep typing and scrolling smooth during streaming, and shorten cold startup without weakening authorization or realtime correctness. No framework rewrite, speculative dependency replacement, production fixture writes, or permission caching across requests.

Use cohesive main-targeted PRs. Keep authorization changes, virtualization, and any new streaming store independently reviewable and reversible. Do not merge without release authority. Update this plan and CHANGELOG with each implementation slice. Measurements and recordings belong in PR evidence/private artifacts, not committed reports or customer data.

## Progress

| Phase | Implementation | Acceptance |
| --- | --- | --- |
| 0. Baseline | [PR #448](https://github.com/LayerNorm/overlay-web/pull/448) adds strict observations, authenticated navigation, stage diagnostics, explicit fixture/history/active-stream validation, separate counter runs, Preview-only histories and provider-free streaming. Coalesced keystrokes retain their observed prefix instead of being discarded. Replaces removed Next bundle internals with emitted entrypoint measurements | Historical seven-run cold-composer and long-DM series accepted, not a current-head speedup. DM profile captured. Full production analyzer compilation completed under CI fixture configuration; existing bundle budgets fail. Fixture-library tests 13/13, Convex fixtures 5/5 and bundle helpers 5/5 passed. QA Team history/composer preconditions and a typing-observer smoke pass succeeded; repeated current-head timing suite and before/after comparisons remain pending |
| 1. Navigation | [PR #451](https://github.com/LayerNorm/overlay-web/pull/451) opens agents before main-thread resolution. Removed the speculative DM/channel resolver after caller tracing and browser QA showed visible room rows already navigate directly; legacy compatibility behavior preserved | Focused scoped navigation, directory-context, agent and transcript tests plus sidebar Vitest, targeted ESLint, shared-isomorphic and on-prem boundary checks passed. Accepted on tested SHA `10ec637f2485` (isolated Preview): directory isolation across 20 transcript updates (0 sidebar renders), main-thread resolver success/error fencing (1 request, 0 on revisit), rapid selection, Back/Forward, personal/DM/channel/archive navigation, workspace switching (129 samples, 0 stale) and the 390px drawer. PR indicators, first-ever thread creation and current-head rename/read actions untested. No latency speedup claimed |
| 2. Transcript loading/cache | [PR #453](https://github.com/LayerNorm/overlay-web/pull/453) starts summary and message reads together behind a backend revision marker; cache/prefetch and scroll restoration remain pending | Accepted on tested SHA `7e1367d0f88891e4144d63871d5eb1b32f2d7a1f`: concurrent reads, delayed-summary masking, rapid switching, populated-workspace isolation, personal pagination 50→100→120, offline reconnect, and provider-free stream/execution identity; zero foreign sampled rows or execution. Non-owner same-workspace and capability browser cases remain untested (Convex-covered). Cache/prefetch/restoration remain pending; no speedup claimed |
| 3. Render isolation | Directory context split from transcript/execution; sidebar, archived views and scope router migrated. Native message projection now preserves unchanged immutable live-row identities within the current scope. Stable event handlers forward to current committed actions, and run-plan context is selected before the expensive row boundary | Current-head typing baseline accepted seven runs, 105 keystrokes (279.9 ms median, 318.6 ms p75). Separate mixed typing/streaming profile showed 672 completed-exchange renders and 31 streaming-row renders. Local render/action tests passed 2/2, transcript/render regressions passed 39/39, targeted ESLint passed, and root typecheck passed with the installed TypeScript fallback (Bun 1.4.4 unavailable). Hosted before/after measurement and browser acceptance remain pending; composer isolation is not yet accepted. No dedicated streaming store introduced |
| 4. Bootstrap | [PR #452](https://github.com/LayerNorm/overlay-web/pull/452) deduplicates ambient session reads within each React request; explicit requests/refreshes stay uncached. [PR #460](https://github.com/LayerNorm/overlay-web/pull/460) fixes chat identity recovery after browser authentication. Workspace bootstrap/provisioning work remains pending | Hosted session-dedup/auth acceptance passed on tested app head 98e9ca97… (login/logout/relogin, concurrent owner/guest contexts, populated QA Team/Personal isolation, refresh, reload and core navigation). Two console-only 404s were unreproduced, with no visible user failure. Bootstrap/provisioning remains pending; two-real-user browser coverage and actual expired renewal are untested. Copied-session revocation remains a separate, unchanged security gap |
| 5. Long histories | [PR #459](https://github.com/LayerNorm/overlay-web/pull/459) reuses the timestamp formatter. [PR #468 (merged)](https://github.com/LayerNorm/overlay-web/pull/468) skips off-screen row layout/paint with CSS while retaining DOM content; linked-message navigation fences bottom pinning and corrects late row layout. Older-history loads restore the reader's position from the top visible row's measured offset and hold it while prepended rows settle. Any JavaScript virtualization remains measurement-gated | Historical 1,000-row DM: about 58,400 transcript DOM nodes and 1.72 median FPS under 4x CPU slowdown. Profile recorded 7,000 row renders during six scroll inputs; it does not attribute every render exclusively to scroll. PR #468 jump, anchor and row tests pass 31/31 with targeted ESLint and typecheck. Hosted acceptance of the history-load anchor fix is pending. No formatter speedup or virtualization acceptance claimed |
| 6A. Routine actions | Audited existing optimistic personal rename/read/preferences/archive and room reactions/pins/saved-message/thread-follow paths; preserve them. Note creation still waits for a server ID | Local editable drafts, safe remaining optimistic gaps and failure/reconciliation acceptance remain pending |
| 6B. Bundles/startup | Next 16-compatible entrypoint measurement implemented. Syntax-highlighter core and regex engine now load on first supported code-block use through the existing asynchronous API. Analytics and Markdown/math remain analyzer-supported candidates | Baseline production build completed using CI fixture configuration and 12 GiB heap. Chat entry JS was 1,138.0 KiB gzip versus the unchanged 680 KiB limit. Highlighter regression checks, before/after bundle measurements and first-use browser acceptance remain pending; no UI speedup claimed |
| 6C. Workflow stream reliability | [PR #455](https://github.com/LayerNorm/overlay-web/pull/455) upgrades the Workflow runtime, retains loopback HTTP retry/no-replay coverage and adds a bounded provider-free Preview probe | **Implemented; the narrow mitigation is hosted-accepted, not the whole plan.** Tested app SHA `88ea1f605b7bcc4011cb3e6e8f878d1ed13394fa`, Preview `dpl_hTRWYGJXg5sUWuvVbTgdDaq17U5E` / backend `ardent-avocet-910` (controller `43320324518`). Synthetic run `wrun_41M78Z4TR80GZWQ6B9MXC4RQD6` completed with 16 ordered chunks, expected return value and one successful step attempt. UI compatibility passed: owner login (5 native 200s), 50-message history reload, rapid A/B/back-forward (815 samples, 0 foreign rows), visible agent/chat composers, unsent-draft type/clear, dark/light restore, and a 390px drawer without overflow. UI QA used no prompts/models or Workflow runs; the separate synthetic probe was the single run. Scoped key revoked; benign fixtures retained. Favicon 404 and four CSP/Vercel feedback reports remain, with no page exceptions. The original timeout, late write and `MODEL_OUTCOME_UNKNOWN` remain unresolved; live-provider cause and effective stream protocol are unverified. Branch `codex/model-outcome-unknown-fix` (not yet merged) settles an interrupted call at zero usage and retries it, classifies the real provider cause first, and logs diagnostic IDs; the underlying stream drop is not fixed by it. Not merged or production-deployed. |
| 7. Regression protection | Baseline instruments under review | Timing gates not enabled |


## Phase 0: Establish trustworthy measurements

1. Review and extend existing navigation/realtime baseline helpers and PR #448. Update obsolete HTTP assumptions for native Convex. Reject failed/missing observations rather than publishing success-shaped samples.
2. Use synthetic fixtures on an isolated current-head PR Preview: ordinary personal chat, two agent threads including 500+ exchanges, and a DM with 1,000+ messages and variable-height content. Verify which history is actually loaded before claiming a long-history result.
3. Measure click to acknowledgement, click to correct visible transcript, cold navigation to usable composer, typing latency during deterministic streaming, frame intervals/long tasks during scrolling, and DOM growth.
4. Separate first visits from previously opened threads. Declare browser-cache and application-cache state separately. Validate destination-specific readiness, not stale marks or incidental sidebar text.
5. Use production builds, fixed CPU/network profiles, repeat samples and percentiles. Run React profiling separately from timing runs. Separate model/network latency from rendering latency.
6. Record Chat and Files initial bundle sizes. Reuse existing render counters and analyzer infrastructure.
7. Custom interaction durations use PostHog with capability/consent gating and no content/private URLs. Speed Insights remains the field Web Vitals source.

Exit: reproducible commands, valid raw samples, summarized results, and ranked bottlenecks. Reorder subsequent work based on evidence. Instrumentation alone does not complete this phase.

## Phase 1: Immediate navigation

1. Audit reachable DM/channel navigation before changing it. Current visible rows already navigate directly and headers collapse lists; preserve that behavior. Do not add a recent-room resolver to an unused path.
2. Keep the existing live-agent-thread fast path. Where resolution is necessary, open an existing-pattern pending agent view before resolving/creating the main thread. Never create a placeholder server resource.
3. Preserve back/forward, deep links, modified clicks, canonical URLs and scope. Late responses cannot override newer navigation. Prevent duplicate creation on remount/retry.
4. Tie navigation completion to destination readiness. Delay showing busy feedback on fast transitions rather than keeping it visible after completion.
5. Preserve shell continuity during ordinary navigation without displaying another workspace's protected content. New visual surfaces require a mockup before implementation.

Acceptance: immediate feedback, correct latest-click destination, recoverable errors, correct history, no duplicate creation, and no stale workspace content.

## Phase 2: Coordinated transcript loading and cache

1. Remove the personal-chat summary-to-messages waterfall through parallel authorized reads or a suitable bootstrap query. Backend permissions remain mandatory; unavailable/deleted chats are handled without taking down the shell.
2. Implement hover/focus prefetch and recent-thread restoration as one coordinated data path. Start with a short intent delay and bounded concurrency; never mutate on hover or leave hover-triggered live subscriptions running.
3. Prefetched data must populate the cache actually consumed by the destination, including pagination metadata. Do not assume a one-shot Convex query seeds the paginated hook.
4. Bound entries, retained messages, and bytes. Key by user, workspace, conversation, and relevant scope/query variants.
5. Restore eligible cached transcript and scroll position immediately, then reconcile with authorized live data without duplicates or jumps.
6. Discard late results after identity changes. Clear on logout/workspace switch and evict known inaccessible/deleted resources. Cached content never authorizes actions.

Acceptance: demonstrable prefetch reuse, bounded memory, correct pagination/live reconciliation, reconnect behavior, and identity/access invalidation. Depends on settled Phase 1 route semantics.

## Phase 3: Isolate streaming from typing and navigation

1. Separate list, selection and command consumers from active transcript/execution state.
2. Preserve identities of unchanged exchanges, callbacks and presentation objects before memoizing rows. Profile to select useful memo boundaries.
3. Keep composer input locally owned. Leave existing Markdown memoization alone unless measurements identify a defect.
4. Add deterministic tests proving stream-only updates do not cause unrelated completed-exchange/composer/sidebar renders. Separately test legitimate updates to avoid stale actions, sources, permissions and status.
5. Only if these changes are insufficient, introduce an active-stream subscription/store with explicit completion, cancellation, retry, reconnect and conversation-switch tests.

Acceptance: lower typing latency and unrelated render counts with correct live behavior. A new store is optional, not an automatic deliverable.

## Phase 4: Safe cold-start bootstrap

1. Deduplicate ambient server-component session reads using request-scoped React cache. Preserve explicit-request and refresh semantics; never share authentication results between requests/users.
2. Reuse authorized bootstrap/workspace-handle information rather than independently resolving it on server and client where feasible.
3. Render non-sensitive shell structure early while protected content remains behind authorization.
4. Remove routine default-role mutation from rendering only with equivalent idempotent provisioning/repair across supported auth entry points. Backend provisioning remains authoritative.
5. Preserve direct custom assignments, compatibility-only assignments, group-derived roles, and archived/missing-role behavior. A resolved nonempty role list is NOT equivalent to the existing direct-assignment initialization predicate. Include new-user and existing-user repair coverage and prove no privilege expansion.
6. Reconcile instant=false documentation with actual route configuration. Do not assume removing the opt-out improves performance; heed existing hydration constraints.

Acceptance: fewer repeated operations in server traces, improved composer-ready time, and unchanged authorization. Keep auth changes separate from session/bootstrap optimizations.

## Phase 5: Long-history performance, measurement-gated

1. Audit actual scroller coverage; the main chat already uses content-visibility through scrollItems. Do not duplicate it.
2. Stabilize and memoize DM rows where useful.
3. Introduce variable-height DM virtualization only if representative measurements still justify it. Full agent/personal transcript virtualization needs its own evidence.
4. Verify prepend anchoring, follow-at-bottom without dragging history readers, unread/deep-link jumps, dividers/grouping, expanding content and media dimensions.
5. Verify focus and screen-reader behavior, selection and browser find. ARIA attributes alone are not accessibility acceptance.

Acceptance: improved frame delivery, bounded DOM for virtualized views, no anchoring regressions. Check Chrome/Firefox/Safari and desktop webview compatibility on available appropriate environments; explicitly report unavailable platforms rather than implying coverage.

## Phase 6A: Remaining optimistic actions

Inventory rename/archive/favorite/pin/mute/title/settings/create actions. Preserve existing optimistic paths and convert only safe server-waiting gaps. Failure of an older mutation must not erase newer changes. Provide explicit retry/error feedback.

Allow an immediately editable local note draft with honest saving/failure state and server-ID reconciliation. Billing, permissions, membership, invitations, auth and security remain server-authoritative with pending feedback. New visual behavior requires approved mockups where applicable.

Acceptance: acknowledgement within the agreed budget, correct persistence/rollback, no lost drafts, no fake saved resources.

## Phase 6B: Bundle and startup work, analyzer-gated

Split only dependencies actually found in initial chunks. Evaluate optional editors/exporters/viewers, scoped math CSS, and startup catalog/analytics work using the analyzer and traces. Avoid replacing libraries or deferring code solely because their names look expensive.

Acceptance: smaller relevant initial payload or reduced first-input contention without first-use failures, flashes or missing styles.

## Phase 7: Regression protection and rollout

1. Run focused scenarios for relevant chat, shared UI, provider, routing and shell changes. Keep stable render-count tests and existing bundle budgets as deterministic gates.
2. Report timing regressions as warnings initially. Enable blocking thresholds only after runner variance is established, using relative AND absolute tolerances and repeatable fixtures.
3. Use exact-head isolated PR Preview acceptance, targeted lint/unit/integration checks and project typechecking. Do not claim production acceptance from local tests or a green build.
4. Preserve rollback boundaries for auth, cache, store and virtualization changes. Remove complexity that fails to produce benefit.
5. Observe field metrics after normal release using sufficient samples and device/route segmentation. Use custom durations for SPA transitions instead of assuming LCP measures them.

## Provisional targets

| Metric | Goal, not measured current behavior |
| --- | --- |
| Visible acknowledgement | <=100 ms |
| Warm cached transcript | Aim <=100 ms, baseline-dependent |
| Cold transcript | Aim <=500 ms under defined network/CPU profile |
| Typing during streaming | <=50 ms in agreed lab profile |
| Cold composer usability | Aim 30% improvement where baseline supports it |
| Field INP | p75 <=200 ms |
| Field LCP | p75 <=2.5 s |
| Long-history scrolling | Smooth frame delivery, no anchoring regressions |

## Delivery sequence

Baseline review/correction and acceptance first; then navigation, coordinated loading/cache, render isolation, safe bootstrap, measured long-history/actions/bundle changes, and ongoing regression enforcement. Independent action/bundle fixes may move earlier when justified. Keep authorization and conditional architectural changes in separate reviewable slices. Do not turn missing evidence into a claim that a phase is complete.
