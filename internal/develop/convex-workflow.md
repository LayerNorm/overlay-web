---
title: "Convex Workflow"
description: "How to update Convex safely for Overlay Web changes."
---

Convex owns durable app state, domain mutations, scheduled work, and some webhook processing. The web app depends on Convex for conversations, files, memory, billing state, and related data.

Treat matching web and Convex revisions as one release unit. Local development
uses an engineer-owned backend; feature worktrees never deploy shared environments.
PR previews deploy only their per-PR backend.

Vercel’s native Git integration deploys main to production. Integration verifies
the exact live web SHA, synchronizes customer Convex only for backend changes from
clean current canonical main, and runs proportionate authenticated smoke.
Frontend-only releases need no backend push. Use the production-scoped key through
a private key-only env file; never pass .env.local or use convex:push:all.

Sensitive changes use expanded acceptance on their isolated PR preview. The staging lane is retired.
There is no custom production deployment
workflow or Vercel deployment token requirement. See
[Preview and Production QA](./worktree-staging-qa.md) for recovery.

## Development backend

For ordinary local web work against the development Convex backend, run Next.js without deploying Convex from a feature worktree:

```bash
npm run dev
```

`npm run dev:with-convex` pushes the selected dev backend before starting Next.js. Use it only for an explicitly selected engineer-owned deployment. Native Vercel production deployment does not push Convex.

## Source imports and typechecks

`convex/tsconfig.json` resolves the backend and its transitive shared imports independently
of the root web config. Keep bridge-protocol and API-client source aliases aligned with
the root paths; a clean backend build must not depend on package `dist` artifacts.
Run `npx tsc --noEmit -p convex/tsconfig.json` as well as web typechecking when those
imports change. `scripts/ci/convex-typecheck-contract.test.mjs` checks bridge source
resolution with generated package output unavailable.

## Isolated PR preview backends

Add `needs-preview` when isolated hosted QA is needed; the trusted controller
requests the exact PR SHA. Unlabeled PRs create no backend or build.
`scripts/vercel-build.sh` builds requested PR previews in the `overlay-landing` Vercel project.
New PR heads use `OVERLAY_RELEASE_LANE=preview`; older open PR heads retain
the former `staging` value until those branches update. Both values are accepted
only for Vercel's Preview target. Preview builds require
`OVERLAY_DEPLOYMENT_ENV=preview`, a canonical PR app origin, and a project-scoped
`preview:<team>:<project>|…` deploy key. The script clears conflicting backend
selectors and dev URL overrides, then runs `convex deploy --preview-name
pr-<number>` with internal `dev/seed:init` fixtures. The seed refuses non-preview
deployments and requires the configured sandbox user identity. Do not use
`--preview-create` on ordinary pushes: it destroys an existing preview's data.
The temporary `--env-file` contains only the approved deploy key (mode `0600`)
and is deleted after the build. An empty file also removes Convex authentication
inputs, even when the key exists in the parent process; do not use an empty file.

The trusted PR controller also holds the project preview key as
`CONVEX_PREVIEW_CONTROL_KEY` in the main-only `release-control` environment.
Six-hour reconciliation validates the project, preview type, PR identifier and
reference before extending a labeled open PR backend to four days from now when fewer
than two days remain. This is within Starter's five-day retention entitlement
and preserves data while the PR remains labeled. On PR closure or label removal,
cleanup settles owned builds before deleting the exact `preview/pr-<number>`
backend and synthetic data through the scoped Preview key. It validates project,
Preview type, reference, PR identifier and name, then verifies absence. Unknown
ownership or failed deletion cannot report successful cleanup. Six-hour inventory
includes retained Convex backends so leftovers are retried even without Vercel
resources. Re-adding the label seeds a fresh backend. A missing or
expired backend forces a fresh web build at the same SHA, with fresh seed data;
an old READY frontend cannot be reused just because its SHA matches.

The controller rejects credentials unless their scope is exactly
`preview:divyansh-lalwani-37bb7:overlay` before making API requests. Never replace
this key with a personal/team token or another product's key. Backend ownership
must match project `1649204` and the exact PR reference and identifier; dev,
production and cross-project targets fail closed. `colorful-chickadee-419` is
also denied by name, independently of metadata. Regression tests exercise these
refusals without sending deletion requests. This protects automation, not manual
deletion by an administrator in the Convex dashboard.

Convex injects the preview URL into the web build. `deploymentEnv()` keeps
server configuration on the same captured URL as the browser; generic runtime
`process.env` lookups must not recover an old shared dashboard URL. Preview
crons register the same schedule as production on the first deployment; no
second deployment or background-job opt-in is needed. Outbound boundaries
require the isolated provider, exact PR callback configuration and hosting access.
Workflow event projection reads SDK state through the deployment-secret web bridge and persists paged events/cursors atomically; Convex must not import the web-host SDK runtime. Email and webhook delivery require exact test-recipient and HTTPS-origin lists
(`OVERLAY_PREVIEW_EMAIL_RECIPIENTS`, `OVERLAY_PREVIEW_WEBHOOK_ORIGINS`); unlisted
destinations fail delivery and retain retry diagnostics. Webhooks cannot redirect. Project preview defaults contain matching internal API/service secrets,
the sandbox client ID and seed identity; passwords stay on the web app only.

Provider credentials are configured once in `overlay-landing`'s unscoped Preview settings
and this project's **preview** defaults. New backends inherit the defaults;
the build wrapper synchronizes its approved backend settings after deployment
and before fixture repair. Existing backends need a successful rebuild after rotation;
controller reuse of an existing READY build does not synchronize settings. Update
both defaults and each still-open backend or rebuild it. Reuse verified development
credentials from `.env.local` through an explicit allowlist, mapping test
`DEV_STRIPE_*` values to the runtime names as well. Never import the file wholesale:
it also contains live Stripe, a production OpenRouter key, and shared-dev backend
selectors. Keep per-lane session/internal secrets and the build-injected backend
URL. Cloudflare bucket permissions and model budgets need separate verification.

`Preview QA Recovery` on trusted main provides a credential-free VM entry point
for `dev/qa:recover`. It checks the current READY web revision and pinned backend
ownership before obtaining that backend's existing authorization and invoking
only the named fixture recovery. It rejects production, dev, foreign/ambiguous
backends and closed/unlabeled PRs. The project Preview key stays in
`release-control`; mutation results and diagnostics never print credentials.
The backend's own Preview/synthetic-fixture guards remain authoritative.

`dev/qa:recoverRoute` is an internal Preview-only, audited route-quarantine
recovery operation. Supply the inspected reason and a unique request ID; it
preserves provider receipts, rejects unsettled leases/nonzero pricing, and
expires catalog/canary eligibility so the ordinary refresh must verify the route
again. Replaying the same request cannot clear a subsequent failure.

Pair a `none` integration, sandbox or web-search provider with its
`OVERLAY_FEATURE_*` flag set to `false`. Provider selection alone does not change
capabilities. Release builds reject the mismatch before deploying functions;
otherwise chat can try to load the disabled integration provider and fail before
calling its model. Shared defaults must enable the isolated providers accepted for Preview. Interactive browsing uses the configured Computer provider and its paid-workspace admission, not a separate browser provider.
Preview and Production variables have separate Vercel targets, and the
corresponding Convex preview defaults remain separate from customer Production.

## Expand, migrate, then contract

Web and Convex deploy independently. The incoming web must work with the old
backend, and the incoming backend must work with the old web, including retained
rollback revisions. Never remove an old field or require a new field in the same
release that first introduces its replacement.

Worked example: rename `files.name` to `displayName` (illustrative; this migration
does not change the current schema).

1. **Expand.** Add `displayName: v.optional(v.string())`; retain required `name`.
   Keep `name` authoritative during the overlap. Existing create/rename handlers
   accept the existing request shape and write both values. The incoming web
   keeps sending `name`, so production's previous backend still accepts it.
2. **Backfill.** Use an internal mutation that advances through bounded pages,
   copying each current `name` into missing `displayName`. Save the returned
   cursor, repeat until `isDone`, and count missing fields. Do not export customer
   data into preview fixtures. Rehearse against synthetic PR preview data first.
3. **Switch reads.** In a later compatible revision, read
   `displayName ?? name` only once every active and retained rollback backend
   dual-writes. Until then read `name`: an older backend can rename a file while
   leaving its backfilled `displayName` stale. Keep legacy request arguments. Verify
   old/new web against old/new backend and exercise web-first production
   deployment plus rollback before accepting it.
4. **Contract.** Remove `name` only after backfill is complete, old callers are
   no longer supported, and the oldest retained rollback web/backend also uses
   the new shape. Record that minimum rollback revision. Until then, retaining
   the alias is cheaper than making rollback unsafe.

The backfill pattern is bounded and restartable:

```ts
export const backfillDisplayNames = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('files').paginate({ cursor, numItems: 100 })
    for (const row of page.page) {
      if (row.displayName === undefined) await ctx.db.patch(row._id, { displayName: row.name })
    }
    return { cursor: page.continueCursor, isDone: page.isDone }
  },
})
```

The example needs the expanded schema before it can compile. Backfill only the
target deployment, verify counts/readback, and retain compatibility until the
contract gate is satisfied. For large deployments, schedule the next bounded
batch rather than running one unbounded mutation.

## Customer production backend

Use the production script only from the clean canonical `main` worktree after the matching main web deployment is live:

```bash
npm run convex:push:prod
```

For Preview and Production checks, see [Preview and Production QA](./worktree-staging-qa.md).

## Runtime inventory during release changes

`check:on-prem-convex-boundaries` compares routes, runtime imports, cron jobs,
and scheduler sites with `config/on-prem-convex-runtime-baseline.json`. Review
the reported delta before updating it. The release-preview foundation records
the new preview-login route alongside previously landed permanent-agent deletion,
workspace auto-top-up, usage/database imports, and pending top-up reconciliation.
Preview registers the production cron schedule. Outbound delivery requires the
configured test destinations; app callbacks additionally require the exact PR
origin and its existing hosting-access credential.

## Import boundary

Convex code may import browser-safe shared modules from `src/shared`. Convex must not import `src/server`, because server-only modules can break Convex bundling.

## Overlay Harness storage

### Personal workflow integration

`src/server/workflows/personal-harness.ts` composes `runOverlayHarness` with personal
authorization, model billing, tool reconstruction, durable waits and transcript
delivery. Eligible personal Chat requests use this workflow when the backend
reports the Harness capability. A successful readiness response from an older
backend selects the existing durable `personal-chat-work` workflow instead.
Readiness errors fail closed. In-flight runs and internal service or automation
execution remain on their retained runners. Other surfaces and hosted parity QA
remain pending.
`mode: 'automate'` alone remains a configuration chat; only the automation
execution flags keep a request on the legacy path.

Native Harness room turns are available only behind the default-off
`OVERLAY_NATIVE_HARNESS=1` server flag and only for overlay Harness agents;
remote and external turns remain on legacy runners. App traffic intentionally
stays on the old runners until routing/media/artifact parity is finished.
Native Harness named-agent asks/posts use H2 shared-root dispatch; the HTTP
route continues to refuse Harness callers. Delivery owners persist bounded
tool-invocation snapshots while tools run, and finalization replaces those
snapshots with the authoritative transcript parts. Anonymous child deliveries
do not write tool progress into the parent's room.
Native tool steps persist tool results before returning, allowing a
tool that finishes during Stop to retain its evidence; the workflow event hook
skips evidence already recorded by the step.
Native Harness roots require a durable plan when their effective tool set
includes a write-capable tool. Action milestones require tool-result evidence.
Each action milestone declares `evidenceTools`; only results from those tools
can support it, and a tool result can support only one action milestone.
Read-only runs can answer without action milestones by using one answer-only
milestone. Native descendants derive the same policy from their admitted tools.
Personal Chat roots and descendants remain plan-optional.
When OpenRouter cost confirmation proves an interrupted free-route stream cost
zero, the Harness records a durable `route_interrupted` receipt and immediately
retries the same model. It permits two such retries per run; a third interruption
fails the run.
Tool-result evidence includes a SHA-256 digest over the tool name and
recursively key-sorted input. Personal and
native Harness runs reject an identical successful repeat of create_note,
create_task, create_automation, create_folder or create_agent and direct the
model to cite the existing evidence; failed creates and other tools are not
blocked by this guard.

The workflow claims the harness before attaching root delivery or executing model
calls. Each run registers its wake hook before launching children. Child IDs are
deterministic per delegation call, admission reserves their budget atomically,
and duplicate workflow starts cannot claim an already-owned child. Child briefs
exclude parent conversation history and limit tools to their admitted subset.

Completion persists `resultSummary` separately from the compacted `workingSummary`.
Parent settlement reads that bounded result. Root delivery uses existing assistant
transcript persistence without charging the aggregate usage again. Raw model-stream
closure produces the UI finish event through the SDK transform.

The default personal policy caps paid Overlay model and summary inference at $1 and
expires 24 hours after the stable AgentRun creation time. `harnessBudget` can set a
provider-cost cap from $0 to $100 and a duration from 30 seconds to seven days.
Free accounts and BYOK have no Overlay-funded provider spend. Each model call still
rechecks account authorization and reserves billing independently. This cap does
not include media or tool charges, or external BYOK bills.

The route resolves the stable turn ID before conversation creation. When neither a
conversation ID nor client ID is supplied, it creates a conversation using a
bounded client ID derived from the actor, workspace and turn. Personal requests
bind the root to one queued AgentRun during admission; the workflow alone claims
and attaches it. Legacy unscoped personal conversations can bind only to the
owner's active personal workspace in the same admission transaction. Scoped
conversations must match the policy workspace, and organization workspaces cannot
claim an unscoped personal conversation.

The local production build passed with the checked-in CI fixture environment:
`INTERNAL_API_SECRET=test-internal-secret`,
`NEXT_PUBLIC_CONVEX_URL=https://fixture.convex.cloud` and
`OVERLAY_DEPLOYMENT_ENV=test`. It compiled 95 steps across six workflows, passed
TypeScript checking and completed static-page generation. This does not establish
hosted Workflow/Convex execution. Exact-SHA isolated Preview smoke and browser QA
remain required, and production Context/Plan/Queue UI remains gated on mockup
approval.
The Workflow compiler regenerates `src/app/.well-known/workflow/` during builds;
its compiled route files are generated output and should not be committed.

Personal root admission binds exactly one queued personal delivery AgentRun to the
root in the same Convex transaction. Stop cancels that delivery and the bound
root in one transaction. For native Harness runs, Stop also cancels each active,
same-user local descendant deepest-first before its matched parent, preserving
active-descendant counts while leaving terminal runs and unrelated trees untouched.
The durable terminal root fences descendants that are not represented by a
conversation AgentRun. Pending model holds remain until their matching late
receipt settles them. The server may subsequently perform best-effort SDK
Workflow cancellation for every returned claimed run; that cleanup is physical
resource cleanup only and cannot promise to abort provider work already dispatched.
Admission and cancellation bindings are additive, so legacy generic harness
admissions remain unchanged. Existing in-flight Work runs and internal automation
continue on their legacy runner until that traffic is migrated.

New personal AgentRuns use canonical `mode: 'chat'`. Harness runs carry the
immutable optional `executionEngine: 'overlay_harness'` discriminator; the
older-backend personal workflow keeps its existing workflow identity without an
engine marker. Existing rows, including historical `mode: 'work'` runs and their
engine ownership, remain unchanged and readable. Replaying `startAgentRun`
returns the existing row without changing its engine, and personal Harness
admission and delivery ownership reject unmarked rows. Legacy stop and cleanup
authorization remains compatible with in-flight runs.

Canonical `AgentRun` status includes active `waiting_for_input` and
`waiting_for_children` states. Each can resume to `running` or end as failed or
cancelled; terminal states cannot reopen. The `harnessWaits` ledger retains
immutable, workflow-owned input and approval requests. A root can read its
descendants' pending requests, but a child cannot read sibling requests.

The personal wait adapter commits hook registration before publishing a request.
Children notify ancestors without directly changing the conversation projection;
the root selects pending human attention when joining its children. Notifications
only trigger authoritative state reads, never execution or settlement themselves.
`POST /api/v1/conversations/run/input` accepts bounded text from the owner of the
exact waiting personal run. It resumes existing work rather than creating a new
conversation turn. The workflow hook durably retains the full reply and the
harness stores a bounded user-input evidence summary. Model/tool authorization is
rechecked after resumption. Delivery transitions can be fenced by workflow ID.

The canonical personal workflow connects this adapter with child launch,
finalization and transcript delivery for authenticated personal Chat.
Input controls and the Context/Plan/Queue presentation still require mockup approval.

Personal workflow inputs may carry an admitted ordered model candidate list, with
at most five distinct models. Every selected candidate is prepared and authorized
again, including its context capacity, cost forecast and current ZDR requirements.
BYOK never falls back to an Overlay-funded model. Only a declined account budget
before dispatch or a typed Gateway model-not-found response (404 without a
generation ID, before receiving a stream) produces a zero-usage rejection receipt.
The next candidate uses a new receipt identity, not a replayed provider dispatch.
Network timeouts, 5xx, rate limits, partial streams and unknown failures retain
their holds and fail closed instead of risking a duplicate paid call. The root
streams the existing fallback notice and retains it in the final transcript.

The canonical controller is `src/server/harness/runner.ts`. It runs inside a
surface workflow and delegates model/tool iteration to `WorkflowAgent`, using
`isLoopFinished()` with semantic suspension conditions rather than a tool-call
limit. Surface IO ports supply authorization, context preparation, receipts,
evidence, authenticated waits and child lifecycle operations, not another loop.
`state-steps.ts` binds state IO to Convex through registered durable steps.

Every run claims one immutable `workflowRunId` before dispatch. Duplicate starts
cannot create a second worker. A child-only wait has a persisted status and can
resume without recreating the children. Tool execution rechecks access after
approval; returned SDK system messages are not replayed as conversation input.
Instructions and current durable context are rebuilt on continuation instead.
An output-token limit continues the partial response instead of completing the
task. Filtered, errored or otherwise unfinished provider returns cannot be
reported as successful completion; usage is still settled.

Model dispatch holds a durable `reserve_model` authorization with the same ID as
its eventual usage receipt. Child admission cannot spend that held amount while
the SDK executes returned tools, before `onStepEnd` supplies usage. Only the
matching receipt replaces the hold with actual spend; cancellation does not
erase an unresolved liability. Ambiguous provider failures require reconciliation
before another call or child-budget release. Automatic SDK model retries are
disabled so one authorization cannot silently fund multiple uncertain attempts.
The adapter must reserve an upper bound for the dispatched prompt and output,
not an average predicted cost. These holds enforce the run budget; billing-account
reservations and settlement remain separate adapter responsibilities.

`captureHarnessModelUsage` allowlists token counts and routing references before
usage crosses a durable step boundary. `resolveHarnessModelUsage` resolves Gateway
generation receipts using the existing server credential resolver; delayed
ingestion retries the lookup, never inference. Without a generation reference,
catalog-derived costs are explicitly marked estimates. Unknown pricing requires
reconciliation. BYOK contributes no Overlay-funded inference cost but records
external cost as unknown, not zero. Known external cost and unpriced external
calls roll up separately through child joins. The run's spending authorization
bounds Overlay-funded inference, not the user's external provider account.

`admitHarnessRequestUsage` consumes the root's request allowance with a stable
operation ID before inference. Child runs do not consume another request; Auto
and BYOK retain their existing exemptions. Internal model receipts set the
server-only `countAsRequest: false` while retaining all cost and token accounting.
Durable accounting binds the workspace explicitly so a tab switch cannot move
usage to another workspace. `requireRecorded: true` prevents a caller from
advancing after a failed write or a reservation that still needs reconciliation.

`personal-tools.ts` reconstructs personal Chat tools inside authorized durable
steps. `personal-access.ts` refreshes workspace membership, principal identity,
conversation and delivery-run access, API key validity, model policy, entitlements
and catalog grants at execution time. Admission grants are an upper bound, not a
cached permission decision. Each child namespaces its tool effects by harness run
ID while retaining the delivery AgentRun ID. The personal adapter requires
interactive approval policy and cannot stand in for an agent or automation
principal. These adapters are not yet connected to production entrypoints.

Before provider dispatch, `bind_model_dispatch` associates the held model call
with its selected model and billing reservation (explicitly `null` for calls
without an account hold). That identity is immutable and survives cancellation.
It is a settlement reference, not evidence that a provider was called or finished.
Only the matching usage receipt clears the model hold; dispatch binding does not
release any budget or authorize automatic provider retries.

`settleHarnessModelUsage` orchestrates separate durable receipt-lookup, account
settlement, and harness-receipt steps. Call it from workflow orchestration, not
inside another step: replay must retain the resolved provider receipt or catalog
quote even if the account write succeeds before the harness write fails. Billing
uses the persisted dispatch binding and original workspace, accepts late usage
after cancellation, and never counts internal calls as additional requests. BYOK
writes a token audit with unknown external cost, without an Overlay charge. A
failed account write leaves the harness hold unresolved. Production entrypoint
wiring remains pending.

Personal `HarnessLanguageModel` references can carry an allowlisted dispatch
reference, without credentials or persisted entitlements. Inside the provider
step it refreshes access, checks prepared token limits and a fresh conservative
catalog forecast, reserves account funds, atomically claims dispatch, and marks
the account hold started. A replayed claim cannot redispatch even for free/BYOK
calls. Provider failures retain the hold for reconciliation. Routing fallbacks
must be selected and authorized during preparation, not hidden in provider
options. Provider-executed tools and unpriced cache configurations fail closed.
Text input estimates include byte/protocol overhead; media uses the known model
context limit. These are spending forecasts, not provider token measurements.
Personal permission refresh uses `gateModelPolicy`, which checks the current
subscription and ZDR policy without topping up or requiring unreserved funds.
A model hold must not disable authorized tools while the SDK executes them.
Each model or billable tool operation still reserves its own spend before use.

`createPersonalHarnessExecutionPorts` connects state ownership, root request
admission, tool reauthorization, model preparation and usage settlement. Surface
adapters still supply authenticated waits, child lifecycle and tool observations.
Preparation receives stable JSON function schemas and trusted instruction context,
then returns the exact instructions and settings used for the quoted prompt.
This prevents a later working-state rebuild from changing the authorized input.
The default 32k working-context policy is not reported as provider capacity:
catalog capacity remains nullable in receipts. Explicit output limits and fresh
ZDR routing are enforced during preparation and again at dispatch.

Compaction summaries use the same secure model and `WorkflowAgent`, with separate
`summary:<main-receipt>:<chunk>` holds and receipts. Each summary is settled before
checkpointing or quoting the main call, without consuming another root request.
Failed or truncated summaries preserve the original history and stop preparation;
an unresolved summary billing hold cannot be followed by another paid call.
Hosted execution validation and migration of the remaining legacy runners are
still pending.

`compactHarnessPrompt` extends the existing chat compaction policy for SDK
provider prompts. It preserves the latest user request and complete tool
transactions, carries a rolling summary, and counts caller-supplied instruction,
tool-schema and working-state overhead. Its summarizer must be authorized and
metered by the caller. A failed summary retains the original history; an
oversized prompt returns `fitsBudget: false` rather than silently losing evidence.
Persist a successful summary before dispatch and reject an unfit prompt. The
controller reloads working state after preparation and retains that summary at
continuation checkpoints.

Harness billing adapters can supply `cachedInputTokens`, `cacheWriteTokens` and
an exact, server-validated `providerCostUsd` to `recordFinishedUsage`. A receipt
takes precedence over catalog estimates, including a verified zero-cost receipt.
Without one, pricing separates uncached input, cache reads, cache writes and
output. Missing cache-write pricing remains unknown and triggers reservation
reconciliation rather than a fabricated zero-cost charge. Existing callers keep
their uncached behavior until they supply these fields; BYOK external charges
must not be inferred from Overlay's zero billing for user-owned credentials.

Authenticated personal Chat uses the shared controller when the backend publishes
its Harness capability marker. After a successful readiness response from an older
backend, all eligible personal calls use the existing durable
`personal-chat-work` workflow instead. Readiness failures remain fail-closed; they
do not fall back to a direct tool loop. Native agents additionally require the
default-off server setting `OVERLAY_NATIVE_HARNESS=1`. Automations, messaging and
notebook loops remain on their retained implementations until adapter parity.
Its focused QA uses
the real SDK with a mock provider, including more than twenty calls, natural early
return, input suspension, approval/denial, revoked authorization, cancellation,
budget refusal and no-progress recovery:

```sh
npx vitest run --config vitest.unit.config.mts src/server/harness/runner.test.ts
npx vitest run --config vitest.unit.config.mts src/server/harness/prompt-compaction.test.ts
npx vitest run --config vitest.unit.config.mts src/server/harness/usage-billing.test.ts
node --import tsx --test src/server/ai/gateway/model-pricing.test.ts
npx vitest run --config vitest.config.mts convex/harnessRuns.convex.test.ts
npx tsx --test packages/overlay-agent-runtime/src/harness-state.test.ts
```

Hosted acceptance requires an isolated Preview with the exact PR SHA.

The standalone Overlay Harness state foundation is stored by `convex/harness/runs.ts` and
`src/server/harness/ConvexHarnessRepository.ts`. The Convex handlers require the internal
server secret and recheck the source resource's current access on every call. The BFF
authenticates the caller before using this server-only repository; these are not direct
browser APIs.

### Harness web-first rollout

Before creating a personal AgentRun, the web reads the server-owned
`harnessRevision` marker from the existing authenticated
`platform/uiSettings:getByServer` query. It is deployment metadata, not a stored
or writable preference. A successful old-backend response without the marker
keeps new turns on the retained durable personal-chat workflow. Authentication, transport,
unexpected revision and other runtime failures fail closed; they never select
another engine. No failed admission, model call or tool effect is replayed.
The check is fresh per admission, so atomic publication of the matching Convex
functions switches new turns to Harness without another web deployment.
Existing turns retain their immutable engine ownership.
Harness room deliveries carry no legacy liveness lease. The legacy sweep
excludes Harness-owned rows, including older rows with a lease, and uses an
indexed positive-lease range so lease-free durable runs cannot hide expired
legacy work. Harness approval/input/child waits retain their durable deadline.
Do not infer readiness from missing-function error text: production Convex
redacts that text to a generic server error.

Release in the normal order: merge, verify matching native Git web is live,
deploy Convex from clean current canonical main, then smoke personal Chat.
Keep Harness tables/functions and legacy handlers through rollback and draining.
Stop acknowledges an already-terminal Workflow only after SDK status readback;
an active or unreadable run still reports cancellation failure for investigation.
Personal and native tool adapters recheck approval requirements at execution.
Only the controller's single-use marker from the authenticated wait authorizes
an approval-required effect; transcript parts and tool arguments cannot grant it.
WorkflowAgent approval pauses can return a model step without invoking
`onStepEnd`. The Harness settles returned steps in `onEnd` before publishing
the wait, deduplicating ordinary step callbacks. Approval resumption must not
reuse that model receipt or carry its reservation into compaction.

Harness run metadata stays compact. Plans, plan revisions, evidence, receipts, child
reservations, operations and checkpoints use separate indexed rows; receipt identity is
deduplicated in the same transaction as usage aggregation. Child runs have independent
state and usage. Unique receipts propagate through their ancestors atomically, including
late billing reconciliation; settlement does not charge that usage again. Keep these rows
additive and do not deploy a feature-worktree schema to shared or customer backends.

## Browser auth for reactive queries

Convex **queries and mutations cannot call `fetch()`**. WorkOS / Better Auth JWKS verification therefore cannot run inside `watchRoomMessages` or other browser `useQuery` handlers.

Browser→Convex subscriptions must use short-lived **HS256** tokens:

1. Next BFF `GET /api/auth/convex-token` mints a token with `INTERNAL_API_SECRET` (`mintBrowserConvexAccessToken`).
2. `ConvexAuthProvider` refreshes the token; consumers pass it explicitly as the
   `accessToken` query argument. Keep the ordinary `ConvexProvider` transport.
3. Convex `requireAccessToken` verifies HS256 with `crypto.subtle` only (`verifyBrowserConvexAccessToken`).

`INTERNAL_API_SECRET` must match between the Next app env and the Convex deployment. Do not send the raw WorkOS access token into reactive queries.

The standalone admin console (`apps/admin`) uses a separate secret, `ADMIN_API_SECRET`, plus `convex/auth.config.ts` WorkOS `customJwt` providers: `admin/console:*` functions call `requireAdminSecret` (constant-time compare, fails closed when unset) then `requireOperator` (native `ctx.auth` identity + active `administrativePrincipals` role). Set it per deployment with `npx convex env set ADMIN_API_SECRET <value>`; preview provisioning does not set it. Break-glass grants run via `npx convex run admin/breakGlass:grantFirstAdmin`. See `internal/develop/admin-console.md`.

Do not call the client's native `setAuth` with these handler tokens. Convex's
platform verifier expects a configured native identity provider; it rejects the
internal HMAC token and interrupts subscriptions. Handler authorization still
verifies signature, expiry and the requested user's identity. Release smoke must
read a real subscription for the signed-in synthetic user, deny a different user
with the same token, and fail on browser runtime or authentication errors.

Collaboration realtime is native Convex when `appDataCapabilities.provider === 'convex'`:

- `watchRoomMessages` owns room transcript updates.
- `watchConversationListVersion` provides a metadata-free invalidation signal for the sidebar.
- `watchNotifications` is the single app-level notification subscription.

Do not run `/api/v1/conversations/events` long-polls alongside those subscriptions. That endpoint is a non-realtime fallback; polling it against the Convex repository multiplies one browser connection into repeated Convex queries and authorization calls.

## Harness model step registration

`harness_read_child` returns a parent-owned `evidenceRef` for a completed child
result. It is an observed tool result, not independent verification; milestones
requiring verification still need a separate passing verification receipt.
Running, failed, cancelled or unrelated children cannot supply this completion
evidence. Original child evidence IDs remain scoped to their child run.
System-owned `ask:<toolCallId>:<agentId>` milestones settle from the joined
child's terminal status: completion marks them done, while failure or
cancellation skips them with the child's reason. Other delegated milestones
still require the parent to complete them with evidence.
Children inherit the parent's `requiresPlan` policy. Optional planning stays
optional for a trivial delegated reply; an explicit plan requirement cannot be
weakened through delegation. The parent still needs a milestone to delegate.

`HarnessLanguageModel` delegates to named `streamHarnessModel` and
`generateHarnessModel` steps with `maxRetries = 0`. Do not assign retry metadata
to class prototype methods marked `use step`: the Workflow compiler removes
those methods and registers proxies after module initialization, so assigning
metadata can crash the workflow before it claims its durable root. Provider
resolution and fresh dispatch authorization remain inside the named steps.
The compiler regression test evaluates the transformed adapter, not just its
untransformed TypeScript implementation.

## Bounded maintenance and list queries

Maintenance jobs and user-facing lists must advance through indexed, bounded pages. `runEmptyConversationCleanup` persists its pagination cursor in `maintenanceCursors`, and `files/files:listPage` is the cursor-based file listing source. Keep legacy list functions bounded during web/Convex deployment overlap; never restore a growing-table `.collect()` for compatibility.

## Chat-delta retirement migration

Removing `conversationMessageDeltas` requires a two-revision Convex rollout.
On the explicitly selected deployment, deploy the compatible migration revision and
run `internal.chat.conversations.collapseLegacyConversationPersistence` once.
Its scheduled batches fold every remaining delta into its assistant message and
mark generating messages without an active AgentRun as interrupted. Confirm the
scheduled chain has finished before deploying the following phase-5 cleanup
revision, which removes the table, queries, and crons. Never skip directly to
the cleanup revision on a deployment that may still contain delta rows.

### Expected errors on production-type deployments

Use `ConvexError` data for expected revision conflicts. Production-type Convex redacts ordinary developer error messages. The
server HTTP adapter preserves application `errorData`, so stale note edits return
HTTP 409 in all lanes. Generic internal failures remain redacted and fail closed.


### Interrupted preview build recovery

The installed Convex CLI executes `--preview-run` only for newly claimed preview
backends. An interrupted first build can leave a reused backend without fixtures.
After every successful preview deploy, the hosted build therefore explicitly runs
`dev/seed:init` against `preview/pr-<number>` using the preview-scoped key. This
idempotent repair preserves edited fixture data and reuses any existing personal
workspace; it does not recreate the backend or deploy shared development/production.
A failed deploy never runs the repair, and a failed repair fails the hosted build.

### Generated type output after production deploy

The Convex CLI may regenerate `convex/_generated/api.d.ts` during a production push. The accepted release added only type entries for existing preview/staging helper modules. Preserve that generated output in ignored release evidence, inspect its diff, and restore only the deploy-generated changes to the accepted tracked version before the clean-main rollback drill. Preserve all pre-existing edits separately. No second backend deployment is needed for that local type-file restoration.

After Stage 3d, legacy customer-secret operator reads/writes are removed. The web shell uses the additive fixed-member initializer deployed in Stage 2; remaining authorization reads and operational audit append do not grant operator access. Deploy the contracted backend only after the switched web revision is live.

## Operator backend cutover

The standalone admin console uses a dedicated operator secret and WorkOS identity. Customer-web default member provisioning moves to `authorization/defaults:ensureDefaultUserRoleByServer`, which accepts only a user id and creates the fixed non-operator member role. This additive endpoint must be deployed before switching the web shell caller; only after the switched web revision is live may the legacy operator mutations be removed. Ordinary authorization reads and append-only operational audit remain available to the web app.

### Preview callbacks and recovery

Every successful Preview build binds `NEXT_PUBLIC_APP_URL`, `OVERLAY_BFF_URL`,
`AUTOMATION_RUNNER_BASE_URL` and `OVERLAY_AGENT_PUBLIC_URL` to its canonical PR
origin, using an ephemeral mode-0600 file removed after success or failure. The scoped
`env set --from-file` uses `--force` only for this explicit allowlist, so rebuilds
and rotations replace stale values without touching other backend settings.
Only approved backend-owned settings are transferred; session secrets, login
passwords and deployment selectors are excluded. Per-backend Stripe webhook
secrets are deliberately excluded and belong to endpoint provisioning. Live
Stripe keys are refused.

Scheduled BFF calls use `fetchAppCallback`: Preview requires its canonical origin
and the existing `VERCEL_AUTOMATION_BYPASS_SECRET`, retains application service
authentication, refuses cross-PR/production targets and redirects, and times out.
Production callbacks do not acquire Preview hosting credentials. Missing callback
configuration fails visibly rather than sending Preview work to production.

Internal `dev/qa:recover` supports explicit configured-identity fixture recovery.
`personal` resets only recent QA free-turn/transcription counters; paid and Computer
fixtures accept a bounded synthetic available-credit target. Refill preserves
consumed spend, reservations, purchased funding and usage operations, accepts only
active `preview-fixture` subscriptions, and records an idempotent audit event.
It cannot repair real Stripe subscriptions or replenish provider account budgets.

### Isolated Stripe test endpoints

Billing-enabled Preview builds run `preview-payments-build.mjs` after synchronizing
runtime settings and before seeding. The helper requires the pinned project
Preview credential, verifies the exact PR backend, and uses only a Stripe test
key. One owned `/stripe/webhook` endpoint carries the PR, project and backend
metadata. Its signing secret and endpoint ID persist only on that backend.
Rebuilds reuse the endpoint and repair missing event subscriptions. A lost
creation/persistence response can recover the original secret by replaying the
exact idempotent request; expired recovery fails visibly and removes only its
new duplicate, preserving the original endpoint for inspection.

The trusted controller reuses the existing Preview-only Stripe credential via
its existing Vercel access. It removes and reads back the owned test endpoints
before deleting their backend. Live endpoints, foreign projects, wrong backend
URLs and unverified ownership are refused. A failed payment cleanup preserves
the backend for recovery and cannot report successful cleanup. Six-hour inventory
includes tagged Stripe endpoints; a missing backend is reported on that PR's
cleanup rather than silently deleting an ambiguous resource. No package install,
PR checkout or additional deployment credential is needed by the controller.
