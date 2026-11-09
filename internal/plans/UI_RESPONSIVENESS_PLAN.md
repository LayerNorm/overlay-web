# UI responsiveness implementation plan

Status: Approved for implementation. Baseline tooling exists in PR #448 but has not yet produced an accepted live baseline. Implementation and acceptance are tracked separately below.

## Goal and constraints

Make navigation acknowledge input immediately, keep typing and scrolling smooth during streaming, and shorten cold startup without weakening authorization or realtime correctness. No framework rewrite, speculative dependency replacement, production fixture writes, or permission caching across requests.

Use cohesive main-targeted PRs. Keep authorization changes, virtualization, and any new streaming store independently reviewable and reversible. Do not merge without release authority. Update this plan and CHANGELOG with each implementation slice. Measurements and recordings belong in PR evidence/private artifacts, not committed reports or customer data.

## Progress

| Phase | Implementation | Acceptance |
| --- | --- | --- |
| 0. Baseline | PR #448 safeguards implemented: strict observations, explicit history loading, active-stream validation, separate counter runs | Baseline tests, script syntax checks and targeted ESLint passed. `npm run typecheck` is blocked by the uninitialized `overlay-desktop` submodule in its transcript-boundary check; live measurements and deterministic streaming fixture remain outstanding |
| 1. Navigation | DM/channel destination-side resolution and existing pending agent route implemented | 44 focused navigation/sidebar tests and targeted ESLint passed; exact-head Preview QA pending |
| 2. Transcript loading/cache | Not started | Not tested |
| 3. Render isolation | Directory context split from transcript/execution; sidebar, archived views and scope router migrated | Directory-boundary test, targeted ESLint and shared-isomorphic check passed; profiling and broader row/composer work pending |
| 4. Bootstrap | Ambient session reads use request-scoped React cache; explicit/refresh reads stay uncached. Chat instant-navigation documentation corrected. Workspace bootstrap reuse and role-provisioning changes remain pending | 11 focused session/refresh/desktop tests and targeted ESLint passed; Preview authentication QA and remaining bootstrap/provisioning work pending; no cross-request session or permission cache |
| 5. Long histories | Measurement-gated | Not tested |
| 6A. Routine actions | Not started | Not tested |
| 6B. Bundles/startup | Analyzer-gated | Not tested |
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

1. Enter the DM/channel view before room lookup completes; resolve the selected conversation inside that view.
2. Keep the existing live-agent-thread fast path. Where resolution is necessary, open an existing-pattern pending agent view before resolving/creating the main thread. Never create a placeholder server resource.
3. Preserve back/forward, deep links, modified clicks, canonical URLs and scope. Late responses cannot override newer navigation. Prevent duplicate creation on remount/retry.
4. Tie navigation completion to destination readiness. Delay showing busy feedback on fast transitions rather than keeping it visible after completion.
5. Preserve shell continuity during ordinary navigation without displaying another workspace's protected content. New visual surfaces require a mockup before implementation.

Implementation notes: room subview clicks push immediately with a transient `select=recent` intent. The mounted destination validates the current workspace, reads the authorized room list and replaces that same history entry. Cleanup and an exact current-URL check suppress late results and errors. Agent clicks use the existing no-thread route when live thread data is absent; its existing destination resolver retains backend idempotency and error/retry UI. No new visual surface is introduced. The standalone navigation-progress provider currently has no `begin` consumers outside its own module, so changing its timers would not improve an observed navigation path; readiness integration remains open pending profiling.

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
