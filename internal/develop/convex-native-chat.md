---
title: "Convex-native personal chat"
description: "Reproducible realtime baselines, retained consumers, and migration security requirements."
---

## CN-01 baseline protocol

This harness measures the existing behavior, not a fix. A remote convergence
failure must remain a failing sample. Do not change an assertion to make the
baseline pass. CN-02 through CN-06 migrate auth, authorization, lists, canonical
history, and streaming respectively; none is implemented by the harness.

Use the isolated current-head PR Preview. Follow [Preview QA](./worktree-staging-qa.md)
to verify the READY deployment SHA and its exact PR-scoped Convex backend before
running. The SHA argument records that independently verified revision; the
harness does not verify the hosting control plane. Never use production or shared
development. The runner rejects noncanonical Preview origins.

1. Sign into the Preview with the existing sandbox credentials. Verify a paid-ready
   workspace and selected supported paid model before the send sample. A send is
   one real, billable QA inference. Do not change the model or retry a stalled run.
2. Create a disposable **personal** chat titled `CN01 QA <unique suffix>`, not an
   agent thread, DM, channel, or temporary chat. Complete its initial run first.
3. Save authenticated Playwright storage state outside the checkout with mode
   `0600`. This is a credential, never an attachment or committed fixture.
4. Run each scenario on a fresh disposable chat. Record the browser version,
   selected model, network conditions and cold/warm navigation separately. The
   runner creates two independent browser contexts with the same sandbox identity.

```bash
CN01_PREVIEW_ORIGIN=https://pr-123.preview.getoverlay.io \
CN01_PREVIEW_SHA=<verified-full-head-sha> \
CN01_STORAGE_STATE=<private-storage-state-path> \
CN01_CHAT_PATH=<relative-personal-chat-url> \
CN01_CHAT_TITLE='CN01 QA <unique suffix>' \
CN01_SCENARIO=send \
node scripts/qa/personal-chat-realtime.mjs
```

Repeat with `CN01_SCENARIO=rename` and `CN01_SCENARIO=archive` on separate fixtures.
Rename changes the disposable title; archive removes it from the active list.
Neither scenario automatically retries or cleans up, which would obscure the
measurement. Restore/archive these synthetic fixtures manually after inspection.
Set `PLAYWRIGHT_EXECUTABLE_PATH` only if using an existing Chromium installation.
The runner does not export cookies, prompt text, titles, IDs, headers, response
bodies, raw errors, screenshots, or traces. Its JSON is safe numeric/status evidence.

### What the numbers mean

| Field | Measurement | Limitation |
| --- | --- | --- |
| `queryReadyFromNavigationMs` | Navigation start to the personal Convex message query's first non-undefined result, including an empty array | Includes auth, navigation and automation overhead. Not a send acknowledgement or transcript paint. |
| `localFeedback.ms` | Before the Playwright click/key action to the expected local DOM visibility change | Includes actionability and automation overhead, not an exact hardware click or paint timestamp. |
| `mutationAcknowledged.ms` | Same start to a successful matching HTTP response for rename/archive | Client-observed acknowledgement, not isolated server execution time. Unavailable for send: streaming response headers do not prove persistence. Replace this observer when these mutations move to Convex. |
| `remoteVisible.ms` | Same start to the expected remote DOM visibility change without reload/refetch | Must be observed in the second independent context. The sender's optimistic row is insufficient. |

Each observer is armed before the action. All interaction elapsed times use one
runner monotonic clock, so clocks from different clients are never subtracted.
Unavailable/failed observations have `null`, never zero. The 30-second convergence
window is a timeout, not a performance SLO. Do not report a p95 from one run or
combine failures with successful latency samples. Run repeated samples explicitly
when percentile evidence is needed; preserve failures separately.

The query marker is bounded to the latest entry and exists only after the runner
installs `overlay:baseline:enabled`. It sends no telemetry. The observer is allowed
to receive a query result while still failing to display the remote user message:
that distinction is the original personal-chat defect. The send scenario waits
up to five minutes for the sender to leave generation and does not cancel/retry.
Terminal correctness and reconnect/duplicate-run tests belong to CN-06.

Opening files and detailed chat navigation/paint timings are not covered by this
personal-chat runner. Measure those surfaces independently before their migration;
do not present the query-ready timing as proof of a fast file viewer or paint.

## Retained consumer and policy inventory

| Current path | Consumers / responsibility | Migration constraint |
| --- | --- | --- |
| `ConvexAuthProvider`, `convex-token-broker`, `/api/auth/convex-token` | Personal chat controller, DirectMessageExperience, CollaborationRealtimeProvider | Explicit HS256 query token is not a native Convex identity token. Preserve legacy consumers while introducing native auth. |
| `convex/auth.config.ts` | WorkOS custom JWT verification | Native provider config currently covers WorkOS, not every supported Overlay auth mode. |
| `src/server/auth/providers` and `bootstrap.ts` | WorkOS, OIDC, Better Auth; NoOp is unauthenticated | Preserve application user IDs and supported private deployments. Preview's sandbox login and native session handoff must be tested, not assumed to yield a WorkOS JWT. |
| `ChatInlinePanel.tsx` | HTTP list, title PATCH, participant archive/restore, local invalidation | Move ordinary personal browser ownership to typed Convex queries/mutations. Keep collaboration behavior until its own migration. |
| `useLiveConversationSync.ts`, `live-message-patching.ts` | 200-row tail subscription and assistant-only runtime patching; HTTP fallback | CN-05 must own pagination/history and accept remote user turns; adding a subscription alone is not sufficient. |
| `packages/overlay-api-client/src/chat/conversations-client.ts` | Shared public HTTP client, including native/external consumers | Do not delete public endpoints or the package when one web caller migrates. |
| `src/server/app-api` and `convex/chat` | Existing session, scope, admission, persistence and run orchestration boundaries | Port authorization and transactional policy, not just transport. Execution/provider calls need not move into Convex. |

Before any endpoint deletion, search every call site again, including desktop,
mobile, agents, scheduled execution and public SDK consumers. This is the pilot
inventory, not proof that an endpoint is unused externally.

Native functions must derive the viewer from verified identity. Test another
user's resource IDs, missing/revoked membership, workspace switch, logout/account
switch, roles and participant scope. Preserve billing/admission, rate limits,
idempotency, audit attribution and operator/customer separation. No browser
function may receive a server secret or trust a supplied actor ID as authority.

## Local checks

```bash
node --test scripts/qa/realtime-baseline.test.mjs
npx eslint scripts/qa/realtime-baseline.mjs scripts/qa/realtime-baseline.test.mjs scripts/qa/personal-chat-realtime.mjs src/features/chat/lib/realtime-baseline.ts src/features/chat/components/chat/useLiveConversationSync.ts
npm run typecheck
```

Unit tests validate timing semantics, privacy-safe failures, origin guards and
context isolation. They are not evidence that live multi-client synchronization
passes. Attach actual Preview results and distinguish expected baseline failures
from later migration acceptance.
